import { describe, expect, it } from "vitest";
import {
  buildFlashcardRequestBody,
  extractArtifactId,
  fetchNotebookLMDeck,
  isNotebookLMUrl,
  parseCsvCards,
  parseFlashcardResponse,
  parsePastedCards,
} from "../src/shared/notebooklm";

const notebookId = "11111111-1111-4111-8111-111111111111";
const artifactId = "22222222-2222-4222-8222-222222222222";
const artifactUrl = `https://notebook.google.com/notebook/${notebookId}/artifact/${artifactId}`;
const sourceUrl = "https://notebooklm.link.google/synthetic-test";
const flashcards = [["Apple", "蘋果"], ["Pear", "梨"], ["Orange", "橘子"]].map(([front, back]) => ({
  f: { flashcardContentBlock: [{ type: "text", content: front }] },
  b: { flashcardContentBlock: [{ type: "text", content: back }] },
}));
const appData = JSON.stringify({ flashcards, topics: { covered: ["Fruits"] } }).replaceAll('"', "&quot;");
const artifact = [artifactId, "Synthetic deck", null, null, null, null, null, null, null, [`<div data-app-data="${appData}"></div>`]];
const fixture = ")]}'\n\n" + JSON.stringify([["wrb.fr", "v9rmvd", JSON.stringify([artifact])]]) + "\n";

describe("NotebookLM 字卡解析", () => {
  it("解析 batchexecute 回應", () => {
    const deck = parseFlashcardResponse(fixture);
    expect(deck.artifactId).toBe(artifactId);
    expect(deck.title).toBe("Synthetic deck");
    expect(deck.cards).toHaveLength(3);
    expect(deck.cards[0]).toEqual({ front: "Apple", back: "蘋果" });
    expect(deck.topics?.covered?.length).toBeGreaterThan(0);
  });

  it("格式改變時丟出 format_changed", () => {
    expect(() => parseFlashcardResponse(")]}'\n\n[]")).toThrowError(/改版|無效/);
  });

  it("網址判斷與 artifact id", () => {
    expect(isNotebookLMUrl(sourceUrl)).toBe(true);
    expect(isNotebookLMUrl("https://outside.example.com/notebook")).toBe(false);
    expect(isNotebookLMUrl("http://notebooklm.link.google/x")).toBe(false);
    expect(
      extractArtifactId(`${artifactUrl}?x=1`),
    ).toBe(artifactId);
  });

  it("請求內容包含 artifact id 並拒絕非法 id", () => {
    const body = new URLSearchParams(buildFlashcardRequestBody(artifactId));
    expect(body.get("f.req")).toContain(artifactId);
    expect(() => buildFlashcardRequestBody('x"]')).toThrow();
  });

  it("追蹤短網址 redirect 並拒絕導向外部網域", async () => {
    const calls: string[] = [];
    const fake = (async (input: string | URL | Request) => {
      const url = String(input);
      calls.push(url);
      if (url.startsWith("https://notebooklm.link.google/"))
        return new Response(null, {
          status: 301,
          headers: { location: artifactUrl },
        });
      return new Response(fixture);
    }) as typeof fetch;
    const deck = await fetchNotebookLMDeck(sourceUrl, fake);
    expect(deck.cards).toHaveLength(3);
    expect(calls[1]).toContain("batchexecute");

    const evil = (async () => new Response(null, { status: 301, headers: { location: "https://outside.example.com/" } })) as typeof fetch;
    await expect(fetchNotebookLMDeck(sourceUrl, evil)).rejects.toThrow(/非 NotebookLM/);
  });

  it("手動貼上與 CSV", () => {
    expect(parsePastedCards("apple\t蘋果\nbanana :: 香蕉\n\n無分隔")).toEqual([
      { front: "apple", back: "蘋果" },
      { front: "banana", back: "香蕉" },
    ]);
    expect(parsePastedCards("Q1 line\n===\nA1\n---\nQ2\n===\nA2 $x^2$")).toEqual([
      { front: "Q1 line", back: "A1" },
      { front: "Q2", back: "A2 $x^2$" },
    ]);
    expect(parseCsvCards('front,back\n"a, b","line1\nline2"\nc,d')).toEqual([
      { front: "a, b", back: "line1\nline2" },
      { front: "c", back: "d" },
    ]);
  });
});
