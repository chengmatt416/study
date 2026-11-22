// 即時協作房間（每份文件一個 Durable Object）。
// - 與 y-websocket 用戶端相容（messageSync=0、messageAwareness=1）
// - 使用 WebSocket Hibernation：閒置時不計 duration 費用
// - Y.Doc 狀態存在 DO 的 SQLite storage；閒置 30 秒自動存成 D1 修訂（source=autosave）
import { DurableObject } from "cloudflare:workers";
import * as Y from "yjs";
import * as syncProtocol from "y-protocols/sync";
import * as awarenessProtocol from "y-protocols/awareness";
import * as encoding from "lib0/encoding";
import * as decoding from "lib0/decoding";
import { requireDocumentAccess, requireDocumentWrite } from "./lib/access";
import type { SessionUser } from "./lib/types";

const MSG_SYNC = 0;
const MSG_AWARENESS = 1;
const MSG_QUERY_AWARENESS = 3;
const AUTOSAVE_IDLE_MS = 30_000;

interface Attachment {
  userId: string;
  name: string;
  /** 此連線擁有的 awareness clientID（存在 attachment，休眠喚醒後仍在） */
  clientIds: number[];
}

export class DocRoom extends DurableObject<Env> {
  private doc: Y.Doc | null = null;
  private awareness: awarenessProtocol.Awareness | null = null;
  private docId: string | null = null;
  private loading: Promise<void> | null = null;

  private async load(docIdHint?: string) {
    if (this.doc) return;
    if (!this.loading) {
      this.loading = (async () => {
        const doc = new Y.Doc();
        const stored = await this.ctx.storage.get<Uint8Array>("state");
        this.docId = (await this.ctx.storage.get<string>("docId")) ?? docIdHint ?? null;
        if (docIdHint && !this.docId) this.docId = docIdHint;
        if (stored) Y.applyUpdate(doc, new Uint8Array(stored));
        else if (this.docId) {
          // 第一次開啟：以 D1 目前版本初始化
          const row = await this.env.DB.prepare(
            "SELECT r.id, r.body_md FROM documents d JOIN revisions r ON r.id = d.current_revision_id WHERE d.id = ?",
          )
            .bind(this.docId)
            .first<{ id: string; body_md: string }>();
          doc.getText("md").insert(0, row?.body_md ?? "");
          await this.ctx.storage.put({ state: Y.encodeStateAsUpdate(doc), docId: this.docId, savedBody: row?.body_md ?? "" });
        }
        doc.on("update", (update: Uint8Array, origin: unknown) => this.onUpdate(update, origin));
        this.awareness = new awarenessProtocol.Awareness(doc);
        this.awareness.setLocalState(null);
        this.awareness.on("update", ({ added, updated, removed }: { added: number[]; updated: number[]; removed: number[] }, origin: unknown) => {
          const changed = [...added, ...updated, ...removed];
          if (origin instanceof WebSocket && added.length) {
            const att = origin.deserializeAttachment() as Attachment;
            origin.serializeAttachment({ ...att, clientIds: [...new Set([...(att.clientIds ?? []), ...added])] });
          }
          const enc = encoding.createEncoder();
          encoding.writeVarUint(enc, MSG_AWARENESS);
          encoding.writeVarUint8Array(enc, awarenessProtocol.encodeAwarenessUpdate(this.awareness!, changed));
          this.ctx.waitUntil(this.broadcast(encoding.toUint8Array(enc), origin as WebSocket | undefined));
        });
        this.doc = doc;
      })();
    }
    await this.loading;
  }

  private onUpdate(update: Uint8Array, origin: unknown) {
    const enc = encoding.createEncoder();
    encoding.writeVarUint(enc, MSG_SYNC);
    syncProtocol.writeUpdate(enc, update);
    this.ctx.waitUntil(this.broadcast(encoding.toUint8Array(enc), origin instanceof WebSocket ? origin : undefined));
    // 持久化與自動儲存排程
    this.ctx.waitUntil(
      (async () => {
        await this.ctx.storage.put("state", Y.encodeStateAsUpdate(this.doc!));
        if (origin instanceof WebSocket) {
          const att = origin.deserializeAttachment() as Attachment | null;
          if (att) {
            const contributors = new Set((await this.ctx.storage.get<string[]>("contributors")) ?? []);
            contributors.add(att.userId);
            await this.ctx.storage.put({ contributors: [...contributors], lastEditor: att.userId });
          }
        }
        await this.ctx.storage.setAlarm(Date.now() + AUTOSAVE_IDLE_MS);
      })(),
    );
  }

  private async authorized(ws: WebSocket, write = false): Promise<boolean> {
    const att = ws.deserializeAttachment() as Attachment | null;
    const user = att ? await this.env.DB.prepare("SELECT u.id,u.email,u.name,u.avatar_url,a.role FROM users u JOIN allowlist a ON a.email=u.email WHERE u.id=?").bind(att.userId).first<SessionUser>() : null;
    if (user && this.docId && await (write ? requireDocumentWrite : requireDocumentAccess)(this.env, user, this.docId)) return true;
    ws.close(1008, "Content access revoked");
    return false;
  }

  private async broadcast(msg: Uint8Array, except?: WebSocket) {
    for (const ws of this.ctx.getWebSockets()) {
      if (ws === except) continue;
      try {
        if (await this.authorized(ws)) ws.send(msg);
      } catch {
        /* 已斷線 */
      }
    }
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/connect") {
      const docId = request.headers.get("x-doc-id")!;
      await this.load(docId);
      const pair = new WebSocketPair();
      const [client, server] = Object.values(pair);
      const att: Attachment = { userId: request.headers.get("x-user-id")!, name: decodeURIComponent(request.headers.get("x-user-name") ?? ""), clientIds: [] };
      this.ctx.acceptWebSocket(server, [att.userId]);
      server.serializeAttachment(att);
      if (!await this.authorized(server, true)) return new Response(null, { status: 101, webSocket: client });
      // 送出 sync step 1 與目前所有人的游標
      const enc = encoding.createEncoder();
      encoding.writeVarUint(enc, MSG_SYNC);
      syncProtocol.writeSyncStep1(enc, this.doc!);
      server.send(encoding.toUint8Array(enc));
      const states = this.awareness!.getStates();
      if (states.size) {
        const aw = encoding.createEncoder();
        encoding.writeVarUint(aw, MSG_AWARENESS);
        encoding.writeVarUint8Array(aw, awarenessProtocol.encodeAwarenessUpdate(this.awareness!, [...states.keys()]));
        server.send(encoding.toUint8Array(aw));
      }
      return new Response(null, { status: 101, webSocket: client });
    }
    if (url.pathname === "/reset" && request.method === "POST") {
      // 外部改動（回復版本）：以新內容取代並廣播
      const { body } = (await request.json()) as { body: string; revisionId: string };
      await this.load();
      const text = this.doc!.getText("md");
      this.doc!.transact(() => {
        text.delete(0, text.length);
        text.insert(0, body);
      }, "reset");
      await this.ctx.storage.put({ state: Y.encodeStateAsUpdate(this.doc!), savedBody: body, contributors: [] });
      await this.ctx.storage.deleteAlarm();
      return new Response("ok");
    }
    if (url.pathname === "/saved" && request.method === "POST") {
      // REST 已存成修訂：更新「已儲存」基準，避免自動儲存重複
      const { body } = (await request.json()) as { body: string };
      await this.ctx.storage.put({ savedBody: body, contributors: [] });
      return new Response("ok");
    }
    return new Response("not found", { status: 404 });
  }

  async webSocketMessage(ws: WebSocket, message: ArrayBuffer | string) {
    if (typeof message === "string") return;
    await this.load();
    if (!await this.authorized(ws, true)) return;
    try {
      const dec = decoding.createDecoder(new Uint8Array(message));
      const type = decoding.readVarUint(dec);
      if (type === MSG_SYNC) {
        const enc = encoding.createEncoder();
        encoding.writeVarUint(enc, MSG_SYNC);
        syncProtocol.readSyncMessage(dec, enc, this.doc!, ws);
        if (encoding.length(enc) > 1) ws.send(encoding.toUint8Array(enc));
      } else if (type === MSG_AWARENESS) {
        awarenessProtocol.applyAwarenessUpdate(this.awareness!, decoding.readVarUint8Array(dec), ws);
      } else if (type === MSG_QUERY_AWARENESS) {
        const enc = encoding.createEncoder();
        encoding.writeVarUint(enc, MSG_AWARENESS);
        encoding.writeVarUint8Array(enc, awarenessProtocol.encodeAwarenessUpdate(this.awareness!, [...this.awareness!.getStates().keys()]));
        ws.send(encoding.toUint8Array(enc));
      }
    } catch (e) {
      console.error("collab message error", e);
    }
  }

  async webSocketClose(ws: WebSocket) {
    this.cleanupAwareness(ws);
    if (this.ctx.getWebSockets().length <= 1) {
      // 最後一人離開：立即自動儲存
      await this.ctx.storage.setAlarm(Date.now() + 1000);
    }
  }

  async webSocketError(ws: WebSocket) {
    this.cleanupAwareness(ws);
  }

  private cleanupAwareness(ws: WebSocket) {
    if (!this.awareness) return;
    const att = ws.deserializeAttachment() as Attachment | null;
    const remove = (att?.clientIds ?? []).filter((id) => this.awareness!.getStates().has(id));
    if (remove.length) awarenessProtocol.removeAwarenessStates(this.awareness, remove, "close");
  }

  /** 自動儲存：內容與上次儲存不同 → 寫入 D1 修訂 */
  async alarm() {
    await this.load();
    const body = this.doc!.getText("md").toString();
    const saved = (await this.ctx.storage.get<string>("savedBody")) ?? "";
    if (body === saved || !this.docId) return;
    const contributors = (await this.ctx.storage.get<string[]>("contributors")) ?? [];
    const lastEditor = (await this.ctx.storage.get<string>("lastEditor")) ?? contributors[0] ?? null;
    const doc = await this.env.DB.prepare("SELECT id, current_revision_id FROM documents WHERE id = ?").bind(this.docId).first<{ id: string; current_revision_id: string | null }>();
    if (!doc) return;
    const id = crypto.randomUUID();
    const t = Date.now();
    await this.env.DB.batch([
      this.env.DB.prepare(
        "INSERT INTO revisions (id, document_id, parent_id, body_md, author_id, contributors, message, source, created_at) VALUES (?,?,?,?,?,?,?, 'autosave', ?)",
      ).bind(id, doc.id, doc.current_revision_id, body, lastEditor, JSON.stringify(contributors), "自動儲存", t),
      this.env.DB.prepare("UPDATE documents SET current_revision_id = ?, baseline_revision_id=CASE WHEN visibility='private' THEN ? ELSE baseline_revision_id END, updated_at = ? WHERE id = ?").bind(id, id, t, doc.id),
    ]);
    await this.ctx.storage.put({ savedBody: body, contributors: [] });
  }
}
