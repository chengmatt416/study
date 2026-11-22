// 極簡 IndexedDB key-value（離線複習佇列、作答暫存）。
const DB_NAME = "study";
const STORE = "kv";
let dbp: Promise<IDBDatabase> | null = null;

function db(): Promise<IDBDatabase> {
  if (!dbp)
    dbp = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  return dbp;
}

async function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const d = await db();
  return new Promise((resolve, reject) => {
    const r = fn(d.transaction(STORE, mode).objectStore(STORE));
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

export const idb = {
  get: <T>(key: string) => tx<T | undefined>("readonly", (s) => s.get(key) as IDBRequest<T | undefined>).catch(() => undefined),
  set: (key: string, value: unknown) => tx("readwrite", (s) => s.put(value, key)).catch(() => undefined),
  update: async <T>(key: string, update: (value: T | undefined) => T): Promise<T> => {
    const d = await db();
    return new Promise((resolve, reject) => {
      const transaction = d.transaction(STORE, "readwrite");
      const store = transaction.objectStore(STORE);
      let value: T;
      const request = store.get(key);
      request.onsuccess = () => {
        try { value = update(request.result as T | undefined); store.put(value, key); }
        catch { transaction.abort(); }
      };
      transaction.oncomplete = () => resolve(value);
      transaction.onabort = transaction.onerror = () => reject(transaction.error ?? new Error("無法儲存複習紀錄，請確認瀏覽器允許本機儲存"));
    });
  },
  del: (key: string) => tx("readwrite", (s) => s.delete(key)).catch(() => undefined),
};
