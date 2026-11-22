import { afterEach, describe, expect, it, vi } from "vitest";
import { COOKIE, guardStudyRequest } from "./auth";
import { signOpenMaicTicket } from "./protocol";
const secret = "study-test-secret-32-characters-minimum";
afterEach(() => vi.unstubAllEnvs());
describe("STUDY identity boundary around the full core", () => {
  it("requires service scope for MCP and limits classroom sessions to their course", async () => {
    vi.stubEnv("STUDY_MCP_SECRET", secret);
    const ticket = await signOpenMaicTicket(
      {
        sub: "study:learner",
        aud: "study-openmaic",
        scope: "classroom",
        classroom_id: "course-a",
        exp: Date.now() + 60000,
      },
      secret,
    );
    const request = (path: string) =>
      new Request(`https://core.test${path}`, {
        headers: { cookie: `${COOKIE}=${ticket}` },
      });
    expect(
      await guardStudyRequest(request("/classroom/course-a")),
    ).toBeUndefined();
    expect(
      (await guardStudyRequest(request("/classroom/course-b")))?.status,
    ).toBe(403);
    expect(
      (await guardStudyRequest(request("/api/study-mcp/tasks")))?.status,
    ).toBe(403);
    expect(
      (
        await guardStudyRequest(
          new Request("https://core.test/classroom/course-a"),
        )
      )?.status,
    ).toBe(401);
    const service = await signOpenMaicTicket(
      {
        sub: "study:learner",
        aud: "study-openmaic",
        scope: "api",
        exp: Date.now() + 60000,
      },
      secret,
    );
    expect(
      await guardStudyRequest(
        new Request("https://core.test/api/study-mcp/tasks", {
          headers: { authorization: `Bearer ${service}` },
        }),
      ),
    ).toBeUndefined();
    expect(
      (
        await guardStudyRequest(
          new Request("https://core.test/api/model-config", {
            method: "PUT",
            headers: { authorization: `Bearer ${service}` },
          }),
        )
      )?.status,
    ).toBe(403);
  });
});
