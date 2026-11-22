import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/client";
import { InMemoryTransport } from "@modelcontextprotocol/server";
import { callApi } from "../src/worker/mcp/internal";
import { buildServer, WRITE_TOOLS } from "../src/worker/mcp/server";
import { testDatabase } from "./helpers/d1";

const user = { id: "owner", email: "owner@test.example", name: "Owner", avatar_url: null, role: "member" as const };
const other = { ...user, id: "other", email: "other@test.example" };
const ctx = { waitUntil: () => undefined } as ExecutionContext;

describe("MCP 刪除內容", () => {
  let fixture: ReturnType<typeof testDatabase>;
  let env: Env;
  const api = <T = Record<string, any>>(method: string, path: string, body?: unknown, who = user) => callApi<T>(env, ctx, who, method, path, body);
  beforeEach(() => {
    fixture = testDatabase();
    fixture.db.exec("INSERT INTO allowlist(email,role,created_at) VALUES ('owner@test.example','member',1),('other@test.example','member',1)");
    fixture.db.exec("INSERT INTO users(id,email,created_at) VALUES ('owner','owner@test.example',1),('other','other@test.example',1)");
    env = { DB: fixture.DB } as Env;
  });
  afterEach(() => fixture.db.close());

  it("刪除重點整理（移到垃圾桶或永久刪除）、單張字卡與整組字卡", async () => {
    const trash = await api<{ slug: string }>("POST", "/api/documents", { kind: "note", title: "Trash me", body_md: "# A", visibility: "private" });
    const purge = await api<{ slug: string }>("POST", "/api/documents", { kind: "note", title: "Purge me", body_md: "# B", visibility: "private" });
    const deck = await api<{ id: string }>("POST", "/api/decks", { title: "Private deck", visibility: "private" });
    await api("POST", `/api/decks/${deck.id}/cards`, { front: "Q1", back: "A1" });
    await api("POST", `/api/decks/${deck.id}/cards`, { front: "Q2", back: "A2" });
    const [first, second] = fixture.db.prepare("SELECT id FROM cards WHERE deck_id = ? ORDER BY ord").all(deck.id) as { id: string }[];

    const server = buildServer({ env, ctx, user, scopes: ["study:read", "study:write"], origin: "https://study.test" });
    const client = new Client({ name: "delete-test", version: "1" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
    const call = async (name: string, args: Record<string, unknown>) => {
      const r = await client.callTool({ name, arguments: args });
      const t = r.content[0].type === "text" ? r.content[0].text : "";
      return { error: r.isError === true, data: r.isError ? t : JSON.parse(t) };
    };
    try {
      expect(await call("delete_document", { slug: trash.slug })).toMatchObject({ error: false, data: { deleted: true, permanent: false } });
      expect(fixture.db.prepare("SELECT status FROM documents WHERE slug = ?").get(trash.slug)).toEqual({ status: "archived" });

      expect(await call("delete_document", { slug: purge.slug, permanent: true })).toMatchObject({ error: false, data: { deleted: true, permanent: true } });
      expect(fixture.db.prepare("SELECT COUNT(*) AS n FROM documents WHERE slug = ?").get(purge.slug)).toEqual({ n: 0 });

      expect(await call("delete_card", { card_id: first.id })).toMatchObject({ error: false, data: { deleted: true, card_id: first.id } });
      expect(fixture.db.prepare("SELECT deleted_at IS NOT NULL AS gone FROM cards WHERE id = ?").get(first.id)).toEqual({ gone: 1 });
      expect(fixture.db.prepare("SELECT deleted_at IS NOT NULL AS gone FROM cards WHERE id = ?").get(second.id)).toEqual({ gone: 0 });

      expect(await call("delete_deck", { deck_id: deck.id })).toMatchObject({ error: false, data: { deleted: true, deck_id: deck.id } });
      expect(fixture.db.prepare("SELECT COUNT(*) AS n FROM decks WHERE id = ?").get(deck.id)).toEqual({ n: 0 });
      expect(fixture.db.prepare("SELECT COUNT(*) AS n FROM cards WHERE deck_id = ?").get(deck.id)).toEqual({ n: 0 });
    } finally {
      await client.close();
      await server.close();
    }
  });

  it("唯讀授權不能刪除，非建立者也不能刪除", async () => {
    const note = await api<{ slug: string }>("POST", "/api/documents", { kind: "note", title: "Mine", body_md: "# A", visibility: "private" });
    const deck = await api<{ id: string }>("POST", "/api/decks", { title: "Mine too", visibility: "private" });
    await api("POST", `/api/decks/${deck.id}/cards`, { front: "Q", back: "A" });
    const cardId = (fixture.db.prepare("SELECT id FROM cards WHERE deck_id = ?").get(deck.id) as { id: string }).id;

    await expect(api("DELETE", `/api/documents/${note.slug}`, undefined, other)).rejects.toMatchObject({ status: 404 });
    await expect(api("DELETE", `/api/decks/${deck.id}`, undefined, other)).rejects.toMatchObject({ status: 404 });

    const readOnly = buildServer({ env, ctx, user, scopes: ["study:read"], origin: "https://study.test" });
    const client = new Client({ name: "delete-ro", version: "1" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([readOnly.connect(serverTransport), client.connect(clientTransport)]);
    try {
      for (const [name, args] of [["delete_document", { slug: note.slug }], ["delete_deck", { deck_id: deck.id }], ["delete_card", { card_id: cardId }]] as const) {
        const r = await client.callTool({ name, arguments: args });
        expect(r.isError).toBe(true);
      }
    } finally {
      await client.close();
      await readOnly.close();
    }
    expect(fixture.db.prepare("SELECT status FROM documents WHERE slug = ?").get(note.slug)).toEqual({ status: "published" });
    expect(fixture.db.prepare("SELECT COUNT(*) AS n FROM decks WHERE id = ?").get(deck.id)).toEqual({ n: 1 });
    expect(fixture.db.prepare("SELECT deleted_at FROM cards WHERE id = ?").get(cardId)).toEqual({ deleted_at: null });
    for (const name of ["delete_document", "delete_deck", "delete_card"]) expect(WRITE_TOOLS.has(name)).toBe(true);
  });
});
