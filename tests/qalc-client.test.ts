import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { QalcClient, type QalcReply } from "../src/web/features/tools/qalc-client";

class Port {
  onmessage: ((event: MessageEvent<QalcReply>) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  onmessageerror: ((event: MessageEvent) => void) | null = null;
  sent: { id: number; type: string; expr?: string }[] = [];
  terminate = vi.fn();
  postMessage(value: unknown) { this.sent.push(value as typeof this.sent[number]); }
  reply(index: number, reply: Omit<QalcReply, "id">) { this.onmessage?.({ data: { id: this.sent[index].id, ...reply } } as MessageEvent<QalcReply>); }
}

describe("calculator worker lifecycle", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());
  it("routes out-of-order replies to the matching calculation", async () => {
    const port = new Port(), client = new QalcClient(() => port);
    const first = client.call("owner", "calc", "1+1"), second = client.call("owner", "calc", "2+2");
    port.reply(1, { ok: true, output: "4" }); port.reply(0, { ok: true, output: "2" });
    expect((await first).output).toBe("2"); expect((await second).output).toBe("4"); client.reset();
  });
  it("rejects a hung worker and can start a new worker for an explicit retry", async () => {
    const ports = [new Port(), new Port()]; let index = 0;
    const create = vi.fn(() => ports[index++]), client = new QalcClient(create, 100, 50);
    const init = client.call("owner", "init"), rejected = expect(init).rejects.toThrow("逾時");
    await vi.advanceTimersByTimeAsync(100); await rejected; expect(ports[0].terminate).toHaveBeenCalledOnce();
    const retry = client.call("owner", "init"); ports[1].reply(0, { ok: true }); expect((await retry).ok).toBe(true); client.reset();
  });
  it("cancels old-account calculations instead of exposing the worker's retained answers", async () => {
    let port = new Port(); const client = new QalcClient(() => port), old = client.call("first", "calc", "private"), rejected = expect(old).rejects.toThrow("帳號已變更");
    const previous = port; port = new Port(); const current = client.call("second", "init");
    await rejected; expect(previous.terminate).toHaveBeenCalledOnce(); port.reply(0, { ok: true }); expect((await current).ok).toBe(true); client.reset();
  });
  it("settles startup failures instead of leaving the loading spinner indefinitely", async () => {
    const port = new Port(), client = new QalcClient(() => port), init = client.call("owner", "init"), rejected = expect(init).rejects.toThrow("連線中斷");
    port.onerror?.(new Event("error") as ErrorEvent); await rejected;
    expect(port.terminate).toHaveBeenCalledOnce();
    await expect(new QalcClient(() => { throw Error("blocked"); }).call("owner", "init")).rejects.toThrow("無法啟動");
  });
  it("rejects a malformed success response instead of showing an empty answer", async () => {
    const port = new Port(), client = new QalcClient(() => port), answer = client.call("owner", "calc", "2+2"), rejected = expect(answer).rejects.toThrow("不完整");
    port.reply(0, { ok: true }); await rejected; client.reset();
  });
  it("does not accept a native calculator error just because the worker returned successfully", async () => {
    const port = new Port(), client = new QalcClient(() => port), answer = client.call("owner", "calc", "@");
    port.reply(0, { ok: true, output: "0", messages: 'Error: "@" is not a valid variable/function/unit.\n' });
    expect(await answer).toMatchObject({ ok: false, output: "0", messages: expect.stringContaining("Error:") });
    client.reset();
  });
});
