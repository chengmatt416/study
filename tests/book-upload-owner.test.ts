import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import type { AppEnv, SessionUser } from "../src/worker/lib/types";
import books from "../src/worker/routes/books";
import { testDatabase } from "./helpers/d1";

const user: SessionUser = { id: "current", email: "current@test.example", name: "Current", avatar_url: null, role: "member" };

describe("upload initialization account ownership", () => {
  let fixture: ReturnType<typeof testDatabase>;
  let env: Env;
  const multipart = vi.fn(async () => ({ uploadId: "upload" }));
  const request = (body: Record<string, unknown>, who = user) => {
    const app = new Hono<AppEnv>();
    app.use("*", async (c, next) => { c.set("user", who); await next(); });
    app.route("/api/books", books);
    app.onError(error => error instanceof HTTPException ? error.getResponse() : new Response("error", { status: 500 }));
    return app.request("/api/books/uploads", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }, env);
  };

  beforeEach(() => {
    fixture = testDatabase();
    fixture.db.prepare("INSERT INTO users(id,email,created_at) VALUES (?,?,1)").run(user.id, user.email);
    multipart.mockClear();
    env = { DB: fixture.DB, BUCKET: { createMultipartUpload: multipart } } as Env;
  });
  afterEach(() => fixture.db.close());

  it.each([false, true])("rejects stale-account uploads before any D1 or R2 access (replacement: %s)", async replacement => {
    const prepare = vi.spyOn(fixture.DB, "prepare");
    const response = await request({ owner_id: "previous", title: "Delayed upload", size: 30, kind: "booklet", ...(replacement ? { book_id: "existing" } : {}) }, replacement ? { ...user, role: "admin" } : user);
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: expect.stringContaining("另一個帳號") });
    expect(prepare).not.toHaveBeenCalled();
    expect(multipart).not.toHaveBeenCalled();
    expect(fixture.db.prepare("SELECT COUNT(*) AS n FROM books").get()).toEqual({ n: 0 });
    expect(fixture.db.prepare("SELECT COUNT(*) AS n FROM uploads").get()).toEqual({ n: 0 });
  });

  it.each([true, false])("accepts the current owner and keeps older clients compatible (owner supplied: %s)", async supplied => {
    const response = await request({ title: "Formula booklet", size: 30, kind: "booklet", ...(supplied ? { owner_id: user.id } : {}) });
    expect(response.status).toBe(200);
    const result = await response.json() as { bookId: string; uploadId: string };
    expect(result.uploadId).toBe("upload");
    expect(multipart).toHaveBeenCalledOnce();
    expect(fixture.db.prepare("SELECT uploaded_by,status FROM books WHERE id=?").get(result.bookId)).toEqual({ uploaded_by: user.id, status: "uploading" });
    expect(fixture.db.prepare("SELECT created_by FROM uploads WHERE id=?").get(result.uploadId)).toEqual({ created_by: user.id });
  });
});
