import { describe, expect, it } from "vitest";
import { moduleDraftProblems, narrationDraftProblems, narrationOf, outlineScenes, parseDraft, quizDraftProblems, requestUserText, turnScene } from "../src/shared/draft-checks";

describe("a draft is read the way the official parser reads it", () => {
  const outline = { outlines: [{ type: "slide", title: "週期" }] };
  it("finds the JSON however the chatbot wrapped it, so no wrapping skips the checks", () => {
    const json = JSON.stringify(outline);
    for (const text of [json, "```json\n" + json + "\n```", "以下是大綱：\n```json\n" + json + "\n```\n請確認。", "Here is the outline: " + json + " Done.", "<think>plan [1]</think>\n" + json]) {
      expect(outlineScenes(parseDraft(text))).toEqual(outline.outlines);
    }
    expect(parseDraft('prefix {"a":"brace } in a string","b":[1,2]} suffix')).toEqual({ a: "brace } in a string", b: [1, 2] });
  });
  it("returns null when there is no JSON to read", () => {
    expect(parseDraft("<div>not json</div>")).toBeNull();
    expect(parseDraft('{"outlines": [')).toBeNull();
  });
});

describe("which scene a model turn is for", () => {
  const request = (user: string) => ({ prompt: [{ role: "system", content: "Title: not this one" }, { role: "user", content: [{ type: "text", text: user }] }] });
  it("reads the title and kind from the official prompt", () => {
    expect(turnScene(requestUserText(request("Title: 先測：週期\nDescription: d\nQuestion Count: 6, Difficulty: medium")))).toEqual({ title: "先測：週期", kind: "quiz" });
    expect(turnScene(requestUserText(request("Title: 週期｜動手做\nConcept: c\nWidget Type: simulation")))).toEqual({ title: "週期｜動手做", kind: "module" });
    expect(turnScene(requestUserText(request("Elements: []\nTitle: 週期\nKey Points: k")))).toEqual({ title: "週期", kind: "slide" });
    expect(turnScene(requestUserText({ prompt: [{ role: "user", content: "no title here" }] }))).toBeNull();
    expect(requestUserText({})).toBe("");
  });
});

describe("a drafted quiz", () => {
  const options = [{ label: "2 s", value: "A" }, { label: "4 s", value: "B" }, { label: "8 s", value: "C" }, { label: "16 s", value: "D" }];
  const question = (id: string, extra: Record<string, unknown> = {}) => ({ id, type: "single", question: "質量變 4 倍，週期變幾倍？", options, answer: ["A"], analysis: "T 與 √m 成正比，所以變 2 倍；選 4 倍是忘了開根號。", points: 10, ...extra });
  const pretest = () => ["q1__d1", "q2__d2", "q3__d2", "q4__d3__m_forgot-root", "q5__d3"].map((id) => question(id));

  it("accepts a pretest with the three difficulties and a checkpoint with a transfer question", () => {
    expect(quizDraftProblems("先測：週期", pretest())).toEqual({ errors: [], warnings: [] });
    expect(quizDraftProblems("檢核：週期", [question("k1__d2"), question("k2__d2"), question("k3__d3")])).toEqual({ errors: [], warnings: [] });
  });
  it("refuses a pretest the router would misread", () => {
    const untagged = quizDraftProblems("先測：週期", pretest().map((q, index) => ({ ...q, id: `q${index}` })));
    expect(untagged.errors.join()).toContain("沒有難度標記");
    const noHard = quizDraftProblems("先測：週期", ["a__d1", "b__d2", "c__d2", "d__d2", "e__d1"].map((id) => question(id)));
    expect(noHard.errors.join()).toContain("難題（__d3）要 2 題");
    expect(quizDraftProblems("先測：週期", pretest().slice(0, 3)).errors.join()).toContain("先測每章 5 到 6 題");
    expect(quizDraftProblems("檢核：週期", [question("k1__d2"), question("k2__d2"), question("k3__d1")]).errors).toEqual(["「檢核：週期」沒有遷移難題（__d3）：檢核至少一題"]);
    expect(quizDraftProblems("先測：週期", []).errors.join()).toContain("沒有題目");
  });
  it("refuses questions a learner could not be graded on or learn from", () => {
    const errors = (patch: Record<string, unknown>) => quizDraftProblems("週期｜隨堂測驗", [question("q1", patch), question("q2")]).errors.join();
    expect(errors({ answer: ["E"] })).toContain("不是任何選項的 value");
    expect(errors({ answer: [] })).toContain("沒有正解");
    expect(errors({ answer: ["A", "B"] })).toContain("單選題");
    expect(errors({ type: "multiple", answer: ["A"] })).toContain("複選題");
    expect(errors({ analysis: "" })).toContain("沒有解析");
    expect(errors({ id: "q2" })).toContain("id 重複");
    expect(errors({ options: [...options, { label: "我不會", value: "E" }] })).toContain("我不會");
    expect(errors({ id: "q1__m_Wrong Id" })).toContain("迷思標記不合規則");
    expect(errors({ options: options.map((option) => ({ ...option, label: "same" })) })).toContain("重複的選項");
  });
  it("leaves an in-lesson quiz untagged and leaves formats the official parser repairs alone", () => {
    expect(quizDraftProblems("週期｜隨堂測驗", [question("q1"), question("q2")])).toEqual({ errors: [], warnings: [] });
    expect(quizDraftProblems("", [question("q1", { options: ["2 s", "4 s", "8 s"], answer: "A" })]).errors).toEqual([]);
    expect(quizDraftProblems("先測：週期", [...pretest().slice(0, 4), { id: "q5__d3", type: "short_answer", question: "說明原因", analysis: "參考答案：週期只與質量及彈力常數有關。" }]).warnings.join()).toContain("簡答題");
  });
});

describe("a drafted interactive module", () => {
  const page = (body: string, head = '<meta name="viewport" content="width=device-width,initial-scale=1">') => `<!doctype html><html><head>${head}</head><body>${body}</body></html>`;
  const lab = '<sk-module heading="排水法"><sk-lab heading="桌"><sk-item kind="cylinder" id="cy"></sk-item></sk-lab><sk-choice id="q"><sk-option value="a" correct>對</sk-option><sk-option value="b" misconception="level-not-volume" feedback="這是水位">錯</sk-option><sk-explain>解說</sk-explain></sk-choice></sk-module>';
  it("accepts a kit module a learner operates", () => {
    expect(moduleDraftProblems("週期｜動手做", page(lab))).toEqual({ errors: [], warnings: [] });
  });
  it("refuses an explanation page, hand-written controls and a page a phone would shrink", () => {
    expect(moduleDraftProblems("週期｜動手做", page('<sk-module heading="說明"><sk-callout kind="note">只有文字</sk-callout><sk-figure label="圖"><svg></svg></sk-figure><sk-reveal label="詳解">…</sk-reveal></sk-module>')).errors.join()).toContain("只是說明頁");
    expect(moduleDraftProblems("週期｜動手做", page('<input type="range"><button>開始</button><script>const tag = "<sk-lab>";</script>')).errors.join()).toContain("沒有使用 <sk-*> 元件庫");
    expect(moduleDraftProblems("週期｜動手做", page(lab, "")).errors.join()).toContain("viewport");
  });
  it("advises when nothing checks the learner or a wrong option carries no misconception", () => {
    const untagged = lab.replace(' misconception="level-not-volume" feedback="這是水位"', "");
    expect(moduleDraftProblems("週期｜動手做", page(untagged)).warnings.join()).toContain("misconception");
    expect(moduleDraftProblems("週期｜動手做", page('<sk-module heading="桌"><sk-lab><sk-item kind="balance" id="b"></sk-item></sk-lab></sk-module>')).warnings.join()).toContain("沒有即時檢核");
  });
  it("leaves the closing scene and non-HTML turns alone", () => {
    expect(moduleDraftProblems("課後：字卡與模考", page("<p>回到 App</p>"))).toEqual({ errors: [], warnings: [] });
    expect(moduleDraftProblems("週期｜動手做", '{"plan":"not html"}')).toEqual({ errors: [], warnings: [] });
  });
});

describe("drafted narration", () => {
  const say = (content: string) => ({ type: "text", content });
  const act = (name: string) => ({ type: "action", name, params: {} });
  const check = (kind: "slide" | "module", title: string, items: unknown[]) => narrationDraftProblems({ kind, title }, narrationOf(items)!);
  it("requires a module to be walked through and pointed at", () => {
    expect(check("module", "週期｜動手做", [act("widget_highlight"), say("把砝碼掛上彈簧。")])).toEqual({ errors: [], warnings: [] });
    expect(check("module", "週期｜動手做", [say("自己試試看這個模擬。")]).errors.join()).toContain("沒有指出操作目標");
    expect(check("module", "週期｜動手做", [act("widget_highlight")]).errors.join()).toContain("沒有對話導覽");
    expect(check("module", "課後：字卡與模考", [act("widget_highlight")]).errors).toEqual([]);
  });
  it("refuses a teacher who hands the slide to the learner, and advises on lines too long for a phone", () => {
    expect(check("slide", "週期", [act("spotlight"), say("換你算：質量 4 倍時週期是多少？")]).errors.join()).toContain("教師講述要學生作答");
    expect(check("slide", "週期", [act("spotlight"), say("為什麼週期變長？因為質量越大，加速度越小。")]).errors).toEqual([]);
    expect(check("slide", "週期", []).errors.join()).toContain("沒有教師講述");
    expect(check("slide", "週期", [say("長".repeat(81))]).warnings.join()).toContain("超過 80 字");
  });
  it("only reads actions arrays", () => {
    expect(narrationOf([{ id: "q1", type: "single" }])).toBeNull();
    expect(narrationOf({ elements: [] })).toBeNull();
  });
});
