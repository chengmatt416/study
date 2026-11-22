import { BaseFilesystem, ERRNO_CODES, type FsStats } from "@electric-sql/pglite/basefs";

interface Cursor<T> { toArray(): T[] }
export interface SqliteStorage {
  exec<T = Record<string, unknown>>(sql: string, ...bindings: (string | number | null | ArrayBuffer | Uint8Array)[]): Cursor<T>;
}
interface Node {
  id: number; path: string | null; parent: number | null; name: string;
  mode: number; size: number; atime: number; mtime: number; ctime: number;
}
const ROOT = "/tmp/pglite/base";
const PAGE_SIZE = 65536;
const DIRECTORY = 0o040000;
const FILE = 0o100000;
type Code = keyof typeof ERRNO_CODES;
function fail(code: Code): never {
  throw Object.assign(new Error(code), { code: ERRNO_CODES[code] });
}
function bytes(value: ArrayBuffer | Uint8Array): Uint8Array {
  return value instanceof Uint8Array ? value : new Uint8Array(value);
}

/** PostgreSQL's synchronous file operations persist directly in DO SQLite pages. */
export class SqliteFilesystem extends BaseFilesystem {
  private readonly descriptors = new Map<number, number>();
  private nextDescriptor = 1;
  private depth = 0;
  constructor(private readonly sql: SqliteStorage, private readonly transaction: <T>(callback: () => T) => T) {
    super();
    sql.exec("CREATE TABLE IF NOT EXISTS pgfs_nodes (id INTEGER PRIMARY KEY, path TEXT UNIQUE, parent INTEGER REFERENCES pgfs_nodes(id), name TEXT NOT NULL, mode INTEGER NOT NULL, size INTEGER NOT NULL DEFAULT 0, atime REAL NOT NULL, mtime REAL NOT NULL, ctime REAL NOT NULL)");
    sql.exec("CREATE INDEX IF NOT EXISTS pgfs_parent ON pgfs_nodes(parent)");
    sql.exec("CREATE TABLE IF NOT EXISTS pgfs_pages (node_id INTEGER NOT NULL REFERENCES pgfs_nodes(id) ON DELETE CASCADE, page INTEGER NOT NULL, data BLOB NOT NULL, PRIMARY KEY(node_id,page))");
    sql.exec("DELETE FROM pgfs_nodes WHERE path IS NULL");
    const time = Date.now();
    sql.exec("INSERT OR IGNORE INTO pgfs_nodes(path,parent,name,mode,atime,mtime,ctime) VALUES (?,NULL,'',?,?,?,?)", ROOT, DIRECTORY | 0o700, time, time, time);
  }
  private atomic<T>(callback: () => T): T {
    if (this.depth) return callback();
    return this.transaction(() => { this.depth++; try { return callback(); } finally { this.depth--; } });
  }
  private normalize(path: string): string {
    if (path === ROOT) return ROOT;
    if (path.startsWith(ROOT + "/")) path = path.slice(ROOT.length);
    const parts: string[] = [];
    for (const part of path.split("/")) {
      if (!part || part === ".") continue;
      if (part === "..") { if (!parts.length) fail("EINVAL"); parts.pop(); } else parts.push(part);
    }
    return ROOT + (parts.length ? "/" + parts.join("/") : "");
  }
  private find(path: string): Node | undefined {
    return this.sql.exec<Node>("SELECT * FROM pgfs_nodes WHERE path=?", this.normalize(path)).toArray()[0];
  }
  private node(path: string): Node { return this.find(path) ?? fail("ENOENT"); }
  private descriptor(fd: number): Node {
    const id = this.descriptors.get(fd);
    if (id === undefined) fail("EBADF");
    return this.sql.exec<Node>("SELECT * FROM pgfs_nodes WHERE id=?", id).toArray()[0] ?? fail("EBADF");
  }
  private directory(path: string): Node {
    const node = this.node(path);
    if (!(node.mode & DIRECTORY)) fail("ENOTDIR");
    return node;
  }
  private parent(path: string): Node { return this.directory(path.slice(0, path.lastIndexOf("/"))); }
  private stats(node: Node): FsStats {
    return { dev: 0, ino: node.id, mode: node.mode, nlink: node.path === null ? 0 : 1, uid: 0, gid: 0, rdev: 0, size: node.size, blksize: PAGE_SIZE, blocks: Math.ceil(node.size / 512), atime: node.atime, mtime: node.mtime, ctime: node.ctime };
  }
  chmod(path: string, mode: number): void {
    const node = this.node(path);
    this.sql.exec("UPDATE pgfs_nodes SET mode=?,ctime=? WHERE id=?", (node.mode & 0o170000) | (mode & 0o7777), Date.now(), node.id);
  }
  close(fd: number): void {
    const node = this.descriptor(fd);
    this.descriptors.delete(fd);
    if (node.path === null && ![...this.descriptors.values()].includes(node.id)) this.sql.exec("DELETE FROM pgfs_nodes WHERE id=?", node.id);
  }
  fstat(fd: number): FsStats { return this.stats(this.descriptor(fd)); }
  lstat(path: string): FsStats { return this.stats(this.node(path)); }
  mkdir(path: string, options: { recursive?: boolean; mode?: number } = {}): void {
    this.atomic(() => {
      path = this.normalize(path);
      const existing = this.find(path);
      if (existing) {
        if (!options.recursive) fail("EEXIST");
        if (!(existing.mode & DIRECTORY)) fail("ENOTDIR");
        return;
      }
      const parentPath = path.slice(0, path.lastIndexOf("/"));
      if (options.recursive && !this.find(parentPath)) this.mkdir(parentPath, options);
      const parent = this.parent(path), time = Date.now();
      this.sql.exec("INSERT INTO pgfs_nodes(path,parent,name,mode,atime,mtime,ctime) VALUES (?,?,?,?,?,?,?)", path, parent.id, path.slice(path.lastIndexOf("/") + 1), DIRECTORY | ((options.mode ?? 0o700) & 0o7777), time, time, time);
    });
  }
  open(path: string, flags = "r", mode = 0o600): number {
    return this.atomic(() => {
      path = this.normalize(path);
      let node = this.find(path);
      if (flags.includes("x") && node) fail("EEXIST");
      if (!node) {
        if (!/[wa]/.test(flags)) fail("ENOENT");
        const parent = this.parent(path), time = Date.now();
        this.sql.exec("INSERT INTO pgfs_nodes(path,parent,name,mode,atime,mtime,ctime) VALUES (?,?,?,?,?,?,?)", path, parent.id, path.slice(path.lastIndexOf("/") + 1), FILE | (mode & 0o7777), time, time, time);
        node = this.node(path);
      }
      if (node.mode & DIRECTORY) fail("EISDIR");
      if (flags.includes("w")) this.truncate(path, 0);
      const fd = this.nextDescriptor++; this.descriptors.set(fd, node.id); return fd;
    });
  }
  readdir(path: string): string[] {
    const node = this.directory(path);
    return this.sql.exec<{ name: string }>("SELECT name FROM pgfs_nodes WHERE parent=? AND path IS NOT NULL ORDER BY name", node.id).toArray().map((row) => row.name);
  }
  read(fd: number, buffer: Uint8Array, offset: number, length: number, position: number): number {
    const node = this.descriptor(fd);
    if (position < 0 || offset < 0 || length < 0 || offset + length > buffer.length) fail("EINVAL");
    const size = Math.max(0, Math.min(length, node.size - position));
    buffer.fill(0, offset, offset + size);
    if (!size) return 0;
    const pages = this.sql.exec<{ page: number; data: ArrayBuffer | Uint8Array }>("SELECT page,data FROM pgfs_pages WHERE node_id=? AND page BETWEEN ? AND ? ORDER BY page", node.id, Math.floor(position / PAGE_SIZE), Math.floor((position + size - 1) / PAGE_SIZE)).toArray();
    for (const page of pages) {
      const start = Math.max(position, page.page * PAGE_SIZE), end = Math.min(position + size, (page.page + 1) * PAGE_SIZE);
      buffer.set(bytes(page.data).subarray(start - page.page * PAGE_SIZE, end - page.page * PAGE_SIZE), offset + start - position);
    }
    return size;
  }
  private remove(node: Node): void {
    if ([...this.descriptors.values()].includes(node.id)) this.sql.exec("UPDATE pgfs_nodes SET path=NULL,parent=NULL WHERE id=?", node.id);
    else this.sql.exec("DELETE FROM pgfs_nodes WHERE id=?", node.id);
  }
  rename(oldPath: string, newPath: string): void {
    this.atomic(() => {
      oldPath = this.normalize(oldPath); newPath = this.normalize(newPath);
      if (oldPath === newPath) return;
      const node = this.node(oldPath), parent = this.parent(newPath), destination = this.find(newPath);
      if (oldPath === ROOT || newPath.startsWith(oldPath + "/")) fail("EINVAL");
      if (destination) {
        if ((destination.mode & DIRECTORY) !== (node.mode & DIRECTORY)) fail("EINVAL");
        if (destination.mode & DIRECTORY) this.rmdir(newPath); else this.remove(destination);
      }
      this.sql.exec("UPDATE pgfs_nodes SET path=? || substr(path,?),ctime=? WHERE path=? OR substr(path,1,?)=?", newPath, oldPath.length + 1, Date.now(), oldPath, oldPath.length + 1, oldPath + "/");
      this.sql.exec("UPDATE pgfs_nodes SET parent=?,name=? WHERE id=?", parent.id, newPath.slice(newPath.lastIndexOf("/") + 1), node.id);
    });
  }
  rmdir(path: string): void {
    this.atomic(() => {
      const node = this.directory(path);
      if (node.path === ROOT) fail("EINVAL");
      if (this.sql.exec("SELECT 1 FROM pgfs_nodes WHERE parent=? LIMIT 1", node.id).toArray().length) fail("ENOTEMPTY");
      this.sql.exec("DELETE FROM pgfs_nodes WHERE id=?", node.id);
    });
  }
  truncate(path: string, size: number): void {
    this.atomic(() => {
      if (!Number.isSafeInteger(size) || size < 0) fail("EINVAL");
      const node = this.node(path);
      if (node.mode & DIRECTORY) fail("EISDIR");
      if (size < node.size) {
        this.sql.exec("DELETE FROM pgfs_pages WHERE node_id=? AND page>=?", node.id, Math.ceil(size / PAGE_SIZE));
        if (size % PAGE_SIZE) {
          const page = Math.floor(size / PAGE_SIZE), row = this.sql.exec<{ data: ArrayBuffer | Uint8Array }>("SELECT data FROM pgfs_pages WHERE node_id=? AND page=?", node.id, page).toArray()[0];
          if (row) { const data = bytes(row.data).slice(); data.fill(0, size % PAGE_SIZE); this.sql.exec("UPDATE pgfs_pages SET data=? WHERE node_id=? AND page=?", data, node.id, page); }
        }
      }
      this.sql.exec("UPDATE pgfs_nodes SET size=?,mtime=?,ctime=? WHERE id=?", size, Date.now(), Date.now(), node.id);
    });
  }
  unlink(path: string): void {
    this.atomic(() => { const node = this.node(path); if (node.mode & DIRECTORY) fail("EISDIR"); this.remove(node); });
  }
  utimes(path: string, atime: number, mtime: number): void {
    this.sql.exec("UPDATE pgfs_nodes SET atime=?,mtime=?,ctime=? WHERE id=?", Number(atime), Number(mtime), Date.now(), this.node(path).id);
  }
  writeFile(path: string, value: string | Uint8Array, options: { encoding?: string; mode?: number; flag?: string } = {}): void {
    this.atomic(() => {
      const data = typeof value === "string" ? new TextEncoder().encode(value) : value;
      const fd = this.open(path, options.flag ?? "w", options.mode);
      try { this.write(fd, data, 0, data.byteLength, options.flag?.includes("a") ? this.fstat(fd).size : 0); } finally { this.close(fd); }
    });
  }
  write(fd: number, source: Uint8Array | ArrayBuffer, offset: number, length: number, position: number): number {
    return this.atomic(() => {
      const node = this.descriptor(fd), buffer = bytes(source);
      if (position < 0 || offset < 0 || length < 0 || offset + length > buffer.length) fail("EINVAL");
      if (!length) return 0;
      for (let written = 0; written < length;) {
        const page = Math.floor((position + written) / PAGE_SIZE), start = (position + written) % PAGE_SIZE, count = Math.min(length - written, PAGE_SIZE - start);
        const data = new Uint8Array(PAGE_SIZE);
        if (start || count !== PAGE_SIZE) {
          const row = this.sql.exec<{ data: ArrayBuffer | Uint8Array }>("SELECT data FROM pgfs_pages WHERE node_id=? AND page=?", node.id, page).toArray()[0];
          if (row) data.set(bytes(row.data));
        }
        data.set(buffer.subarray(offset + written, offset + written + count), start);
        if (data.some((byte) => byte !== 0)) this.sql.exec("INSERT INTO pgfs_pages(node_id,page,data) VALUES (?,?,?) ON CONFLICT(node_id,page) DO UPDATE SET data=excluded.data", node.id, page, data);
        else this.sql.exec("DELETE FROM pgfs_pages WHERE node_id=? AND page=?", node.id, page);
        written += count;
      }
      this.sql.exec("UPDATE pgfs_nodes SET size=max(size,?),mtime=?,ctime=? WHERE id=?", position + length, Date.now(), Date.now(), node.id);
      return length;
    });
  }
}
