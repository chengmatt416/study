import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { testDatabase } from "./helpers/d1";
import { readableBookFile } from "../src/worker/lib/access";

const member = { id: "m", email: "member@test.example", name: "M", avatar_url: null, role: "member" as const };
const admin = { ...member, id: "a", email: "admin@test.example", role: "admin" as const };

// pdf.js reads a book as many range requests; their fast access check must apply the same group rules as every other route.
describe("PDF range access fast path", () => {
  let fixture: ReturnType<typeof testDatabase>;
  let env: Env;
  beforeEach(() => {
    fixture = testDatabase();
    fixture.db.exec(`INSERT INTO books(id,title,kind,status,r2_key,created_at,updated_at) VALUES
      ('book','Chemistry','book','ready','books/book.pdf',1,1),('booklet','Data','booklet','ready','books/data.pdf',1,1),('uploading','New','book','uploading','books/new.pdf',1,1);
      INSERT INTO allowlist(email,role,created_at) VALUES ('member@test.example','member',1),('admin@test.example','admin',1);
      INSERT INTO access_groups(id,name,created_at) VALUES ('g','Students',1);
      INSERT INTO access_group_members(group_id,email) VALUES ('g','member@test.example');`);
    env = { DB: fixture.DB } as unknown as Env;
  });
  afterEach(() => fixture.db.close());

  it("serves ready books, hides unfinished uploads and unknown ids", async () => {
    expect(await readableBookFile(env, member, "book")).toBe("books/book.pdf");
    expect(await readableBookFile(env, member, "uploading")).toBeNull();
    expect(await readableBookFile(env, member, "nope")).toBeNull();
    expect(await readableBookFile(env, admin, "book")).toBe("books/book.pdf");
  });
  it("refuses a book whose feature or the book itself is blocked for the user's group, and allows a book-level exception", async () => {
    fixture.db.exec("INSERT INTO access_rules(group_id,resource_type,resource_id,allowed) VALUES ('g','feature','ebooks',0)");
    await expect(readableBookFile(env, member, "book")).rejects.toMatchObject({ status: 403 });
    expect(await readableBookFile(env, member, "booklet")).toBe("books/data.pdf");
    fixture.db.exec("INSERT INTO access_rules(group_id,resource_type,resource_id,allowed) VALUES ('g','book','book',1)");
    expect(await readableBookFile(env, member, "book")).toBe("books/book.pdf");
    fixture.db.exec("INSERT INTO access_rules(group_id,resource_type,resource_id,allowed) VALUES ('g','book','booklet',0)");
    await expect(readableBookFile(env, member, "booklet")).rejects.toMatchObject({ status: 403 });
    expect(await readableBookFile(env, admin, "booklet")).toBe("books/data.pdf");
  });
});
