import { passClassroomReview, startFromBlueprint } from "./helpers/blueprint-draft";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Client } from "@modelcontextprotocol/client";
import { InMemoryTransport } from "@modelcontextprotocol/server";
import { buildServer } from "../src/worker/mcp/server";
import { testDatabase } from "./helpers/d1";
import { blueprint } from "./helpers/blueprint";
import { callApi } from "../src/worker/mcp/internal";
import type { OpenMaicCoreEnv } from "../src/worker/lib/openmaic-core";
import {
  BLUEPRINT_GUIDE, EXAM_ALIGNMENT_GUIDE, MAX_NEW_CONCEPTS, blueprintRequirement, checkClassroomAgainstBlueprint, checkOutlineAgainstBlueprint, checkSources, validateBlueprint, validateExamAlignment,
  type AvailableSource, type CourseBlueprint,
} from "../src/shared/course-blueprint";

const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value));
const errorsOf = (change: (bp: ReturnType<typeof blueprint>) => void, base = blueprint()) => { const bp = clone(base); change(bp); return validateBlueprint(bp).errors.join("\n"); };

describe("course blueprint: plan structure and learning curve", () => {
  it("accepts a sound plan and carries it into the generation requirement", () => {
    const report = validateBlueprint(blueprint());
    expect(report.ok).toBe(true);
    const text = blueprintRequirement(report.value!);
    for (const part of ["週期", "頻率", "f = 1/T", "define", "1.2", "先備：週期", "照此"]) expect(text, part).toContain(part);
  });

  it("teaches prerequisites first, one new idea at a time, rising one step at a time", () => {
    expect(errorsOf((bp) => { bp.chapters[0].prerequisites = ["頻率"]; })).toContain("先備章節「頻率」必須是排在前面的章節");
    expect(errorsOf((bp) => { bp.chapters[0].new_concepts = Array.from({ length: MAX_NEW_CONCEPTS + 1 }, (_, i) => ({ name: "概念" + i, kind: "concept" })); })).toContain("一章最多引入");
    expect(errorsOf((bp) => { bp.chapters[0].difficulty = 3; })).toContain("第一章難度不可是 3");
    expect(errorsOf((bp) => { bp.chapters[0].difficulty = 1; bp.chapters[1].difficulty = 3; })).toContain("難度從 1 直接跳到 3");
    expect(errorsOf((bp) => { bp.chapters[0].minutes = 90; })).toContain("minutes");
    expect(errorsOf((bp) => { bp.chapters = [bp.chapters[0]]; })).toContain("2 到 12 章");
    expect(errorsOf((bp) => { bp.chapters[1].new_concepts = []; })).toContain("new_concepts 至少");
    expect(errorsOf((bp) => { bp.chapters[1].objectives.unshift({ id: "late", text: "分析一個陌生情境", command_term: "analyse", syllabus_ref: "1.2", bloom: "analyze" }); })).toContain("由淺到深");
  });

  it("ties every objective to the syllabus, an IB command term and the pages that support it", () => {
    expect(errorsOf((bp) => { bp.chapters[0].objectives[0].syllabus_ref = ""; })).toContain("syllabus_ref");
    const ib = (bp: ReturnType<typeof blueprint>) => { bp.level = "SL"; };
    expect(errorsOf((bp) => { ib(bp); bp.chapters[0].objectives[0].command_term = "know"; })).toContain("不是 IB 指令詞");
    expect(errorsOf((bp) => { bp.chapters[0].objectives[0].command_term = "know"; })).not.toContain("指令詞");
    const withBook = (bp: ReturnType<typeof blueprint>) => { bp.sources = [{ kind: "ebook", book_id: "bk", title: "課本", pages: "10-20", used_for: "例題取自課本第一章" } as never]; };
    expect(errorsOf((bp) => { withBook(bp); })).toContain("source_pages");
    expect(errorsOf((bp) => { withBook(bp); bp.sources[0].pages = ""; })).toContain("讀過的頁碼");
    expect(errorsOf((bp) => { bp.sources = [{ kind: "ebook", title: "課本", pages: "1", used_for: "例題取自課本第一章" } as never]; })).toContain("book_id");
  });

  it("refuses entries it would otherwise drop without a word", () => {
    expect(errorsOf((bp) => { (bp.chapters[0] as { misconceptions: string[] }).misconceptions = ["把溫度當成熱量"]; })).toContain("必須是迷思 id");
    expect(errorsOf((bp) => { (bp.chapters[0] as { new_concepts: unknown[] }).new_concepts.push({ name: "阻尼", kind: "idea" }); })).toContain("new_concepts[");
  });
  it("keeps chapter names usable as scene titles and the plan a sensible size", () => {
    expect(errorsOf((bp) => { bp.chapters[0].key = "先測：週期"; })).toContain("冒號");
    expect(errorsOf((bp) => { bp.chapters[0].key = "週期｜基礎"; })).toContain("｜");
    expect(errorsOf((bp) => { bp.chapters[1].key = "週期"; })).toContain("重複");
    expect(validateBlueprint({ ...blueprint(), schema: "other" }).errors.join()).toContain("schema");
    expect(validateBlueprint(null).ok).toBe(false);
    expect(errorsOf((bp) => { bp.assessment.pretest_plan = "短"; })).toContain("pretest_plan");
    expect(validateBlueprint({ ...blueprint(), learner: "" }).errors.join()).toContain("learner");
    expect(BLUEPRINT_GUIDE).toContain("validate_course_blueprint");
    expect(BLUEPRINT_GUIDE).toContain("course-blueprint/v1");
  });
});

describe("cited documents must be real, readable, for this subject and at the right level", () => {
  const available: AvailableSource[] = [
    { id: "syl", title: "Syllabus", kind: "ib_syllabus", ib_level: "SL" }, { id: "ms", title: "Mark scheme", kind: "ib_markscheme", ib_level: "both" },
    { id: "bk", title: "課本", kind: "ebook", ib_level: null }, { id: "sch", title: "課綱", kind: "school_syllabus", ib_level: null },
  ];
  const cite = (kind: string, book_id: string) => ({ kind, book_id, title: "t", pages: "1", used_for: "決定範圍與例題" }) as never;
  it("rejects invented, wrong-kind and wrong-level documents", () => {
    expect(checkSources([cite("ebook", "nope")], [], "SL", available).errors.join()).toContain("不是你可存取");
    expect(checkSources([cite("ebook", "syl")], [], "SL", available).errors.join()).toContain("實際是 ib_syllabus");
    expect(checkSources([cite("ib_syllabus", "syl")], [], "HL", available).errors.join()).toContain("與 HL 層級不符");
  });
  it("requires the subject's ebook and syllabus, and at least one IB document (not one of each), unless the plan says why not", () => {
    const all = [cite("ib_syllabus", "syl"), cite("ib_markscheme", "ms"), cite("ebook", "bk"), cite("school_syllabus", "sch")];
    expect(checkSources(all, [], "SL", available).errors).toEqual([]);
    const missing = checkSources(all.slice(0, 2), [], "SL", available).errors.join();
    expect(missing).toContain("電子書"); expect(missing).toContain("學校課綱");
    expect(checkSources(all.slice(0, 2), [{ kind: "ebook" }, { kind: "school_syllabus" }], "SL", available).errors).toEqual([]);
    expect(checkSources([cite("ib_syllabus", "syl"), cite("ebook", "bk"), cite("school_syllabus", "sch")], [], "SL", available).errors).toEqual([]);
    const noIb = checkSources([cite("ebook", "bk"), cite("school_syllabus", "sch")], [], "SL", available).errors.join();
    expect(noIb).toContain("IB 參考文件");
    expect(checkSources([cite("ebook", "bk"), cite("school_syllabus", "sch")], [{ kind: "ib_syllabus" }], "SL", available).errors).toEqual([]);
    expect(checkSources([], [], "none", []).errors).toEqual([]);
  });
});

describe("a finished classroom must follow its blueprint", () => {
  const bp = validateBlueprint(blueprint()).value as CourseBlueprint;
  const quiz = (title: string, ids: string[]) => ({ id: title, type: "quiz", title, content: { questions: ids.map((id) => ({ id })) }, quizConfig: { questionCount: Math.max(ids.length, 3) } });
  const lesson = (title: string) => ({ id: title, type: "slide", title });
  const complete = () => [
    quiz("先測：週期", ["a__d1", "b__d2", "c__d2", "d__d3", "e__d3", "f__d1"]), quiz("先測：頻率", ["a__d1", "b__d2", "c__d2", "d__d3", "e__d3"]),
    lesson("週期"), lesson("週期〔補強〕"), lesson("週期〔精簡〕"), quiz("檢核：週期", ["k__d3"]), lesson("頻率"), lesson("頻率〔補強〕"), lesson("頻率〔精簡〕"), quiz("檢核：頻率", ["k__d3"]),
    lesson("課後：字卡與模考"),
  ];
  it("passes a complete classroom without warnings", () => {
    expect(checkClassroomAgainstBlueprint(bp, complete())).toEqual({ ok: true, errors: [], warnings: [] });
  });
  it("blocks a missing chapter, pretest or checkpoint, and a chapter taught out of order", () => {
    const missing = checkClassroomAgainstBlueprint(bp, complete().filter((scene) => scene.title !== "檢核：頻率" && scene.title !== "先測：週期"));
    expect(missing.ok).toBe(false);
    expect(missing.errors).toEqual(["缺少前測場景「先測：週期」", "缺少檢核場景「檢核：頻率」"]);
    const swapped = complete(); [swapped[2], swapped[6]] = [swapped[6], swapped[2]];
    expect(checkClassroomAgainstBlueprint(bp, swapped).errors).toContain("章節教學場景的順序和藍圖不同：先備知識必須先教");
  });
  it("accepts a chapter taught over several scenes and keeps their order", () => {
    const pages = complete(); pages.splice(3, 0, lesson("週期｜例題"), { id: "週期互動", type: "interactive", title: "週期｜動手做" });
    expect(checkClassroomAgainstBlueprint(bp, pages)).toEqual({ ok: true, errors: [], warnings: [] });
    const onlySections = complete().map((scene) => scene.title === "週期" ? { ...scene, title: "週期｜導入" } : scene);
    expect(checkClassroomAgainstBlueprint(bp, onlySections).ok).toBe(true);
    const variants = complete(); variants.splice(4, 0, lesson("週期〔補強〕｜再練一次"));
    expect(checkClassroomAgainstBlueprint(bp, variants)).toEqual({ ok: true, errors: [], warnings: [] });
  });
  it("names a scene the learner can never reach, as advice on a finished classroom and as an error on an outline", () => {
    const pages = complete(); pages.splice(6, 0, lesson("單元補充"));
    const finished = checkClassroomAgainstBlueprint(bp, pages);
    expect(finished.ok).toBe(true); expect(finished.warnings.join()).toContain("單元補充");
    const outline = checkOutlineAgainstBlueprint(bp, pages);
    expect(outline.ok).toBe(false); expect(outline.errors.join()).toContain("單元補充"); expect(outline.warnings.join()).not.toContain("單元補充");
    const between = complete(); between.splice(3, 0, lesson("這頁沒有照命名規則"));
    expect(checkOutlineAgainstBlueprint(bp, between)).toMatchObject({ ok: true, errors: [] });
    expect(checkOutlineAgainstBlueprint(bp, complete())).toEqual({ ok: true, errors: [], warnings: [] });
  });
  it("holds an outline to everything a finished classroom is only advised about", () => {
    const without = (title: string) => complete().filter((scene) => scene.title !== title);
    expect(checkClassroomAgainstBlueprint(bp, without("頻率〔補強〕"))).toMatchObject({ ok: true, warnings: ["「頻率」缺少〔補強〕補強版場景"] });
    expect(checkOutlineAgainstBlueprint(bp, without("頻率〔補強〕")).errors).toEqual(["「頻率」缺少〔補強〕補強版場景"]);
    expect(checkOutlineAgainstBlueprint(bp, without("週期〔精簡〕")).errors).toEqual(["「週期」缺少〔精簡〕精簡版場景"]);
    expect(checkOutlineAgainstBlueprint(bp, without("課後：字卡與模考")).errors).toEqual(["缺少最後的「課後：字卡與模考」場景"]);
    const extra = [...complete().slice(0, -1), quiz("先測：共振", ["a__d1"]), lesson("共振"), quiz("檢核：共振", ["k__d3"]), lesson("課後：字卡與模考")];
    expect(checkOutlineAgainstBlueprint(bp, extra).errors.join()).toContain("場景「共振」不在藍圖的章節裡");
    const twice = complete(); twice.splice(3, 0, lesson("週期"));
    expect(checkOutlineAgainstBlueprint(bp, twice).errors.join()).toContain("場景標題「週期」重複 2 次");
    const retest = complete(); retest.splice(4, 0, quiz("週期〔補強〕｜復測", ["r__d2"]));
    expect(checkOutlineAgainstBlueprint(bp, retest).errors.join()).toContain("要用 interactive 場景");
  });
  it("refuses an outline whose quiz counts contradict the pretest and checkpoint rules", () => {
    const counted = (title: string, questionCount?: number) => complete().map((scene) => scene.title === title ? { ...scene, quizConfig: questionCount === undefined ? undefined : { questionCount } } : scene);
    expect(checkOutlineAgainstBlueprint(bp, counted("先測：週期", 3)).errors).toEqual(["「先測：週期」的 quizConfig.questionCount 是 3：先測每章 5 到 6 題"]);
    expect(checkOutlineAgainstBlueprint(bp, counted("先測：週期")).errors.join()).toContain("先測每章 5 到 6 題");
    expect(checkOutlineAgainstBlueprint(bp, counted("檢核：頻率", 8)).errors).toEqual(["「檢核：頻率」的 quizConfig.questionCount 是 8：檢核每章 3 到 5 題"]);
  });
  it("blocks a finished pretest or checkpoint with no questions and advises on a checkpoint without a transfer question", () => {
    const emptied = complete().map((scene) => scene.title === "先測：週期" || scene.title === "檢核：頻率" ? quiz(scene.title, []) : scene);
    expect(checkClassroomAgainstBlueprint(bp, emptied).errors).toEqual(["「先測：週期」沒有任何題目", "「檢核：頻率」沒有任何題目"]);
    const easy = complete().map((scene) => scene.title === "檢核：週期" ? quiz(scene.title, ["a__d1", "k__d2"]) : scene);
    expect(checkClassroomAgainstBlueprint(bp, easy)).toMatchObject({ ok: true, warnings: ["「檢核：週期」沒有遷移難題（__d3）", "「檢核：週期」與先測用了相同的題目 id（a__d1）：檢核題要和先測不同"] });
  });
  it("refuses an outline the official core would cut at 100 scenes", () => {
    const pages = complete(); pages.splice(3, 0, ...Array.from({ length: 95 }, (_, index) => lesson(`週期｜第${index}頁`)));
    expect(checkOutlineAgainstBlueprint(bp, pages).errors.join()).toContain("官方只保留前 100 個");
  });
  it("warns when the pretest cannot tell a hard-question miss from missing basics", () => {
    const flat = complete(); flat[0] = quiz("先測：週期", ["q1", "q2", "q3", "q4", "q5"]); flat[1] = quiz("先測：頻率", ["q1__d1", "q2__d2", "q3__d2", "q4__d2"]);
    const report = checkClassroomAgainstBlueprint(bp, flat);
    expect(report.ok).toBe(true);
    expect(report.warnings.join("\n")).toContain("沒有 __d1／__d2／__d3 難度標記");
    expect(report.warnings.join("\n")).toContain("沒有難題（__d3）");
    const thin = complete(); thin[1] = quiz("先測：頻率", ["a__d3", "b__d1"]);
    expect(checkClassroomAgainstBlueprint(bp, thin).warnings.join("\n")).toContain("只有 2 題");
    expect(checkClassroomAgainstBlueprint(bp, complete().filter((scene) => !scene.title.includes("〔") && scene.title !== "課後：字卡與模考")).warnings).toEqual(expect.arrayContaining(["「週期」缺少〔補強〕補強版場景", "「頻率」缺少〔精簡〕精簡版場景", "缺少最後的「課後：字卡與模考」場景"]));
    const late = complete(); late.push(quiz("先測：頻率", ["a"]));
    expect(checkClassroomAgainstBlueprint(bp, late).warnings).toContain("先測沒有全部放在課程最前面");
  });
});

describe("mock exam alignment: syllabus, command terms, mark scheme and difficulty curve", () => {
  const answers = ["q1", "q2", "q3", "q4", "q5", "q6"].map((id, i) => ({ id, points: i < 3 ? 1 : 2 }));
  const rows = () => answers.map((a, i) => ({ question: a.id, syllabus_ref: "B1." + (i + 1), command_term: i % 2 ? "Calculate" : "State", marks: a.points, difficulty: i < 2 ? 1 : i < 5 ? 2 : 3 }));
  const exam = (change: (value: { questions: Record<string, unknown>[] } & Record<string, unknown>) => void = () => undefined) => {
    const value = { schema: "exam-alignment/v1", level: "SL", paper: "Paper 1A（練習卷）", sources: [], source_exemptions: [], mark_scheme_note: "依 mark scheme 的給分點：State 1 分，Calculate 依步驟給分", questions: rows() } as { questions: Record<string, unknown>[] } & Record<string, unknown>;
    change(value); return validateExamAlignment(value, answers);
  };
  it("accepts a paper whose marks match the answer file and whose difficulty rises", () => {
    const report = exam();
    expect(report.ok).toBe(true);
    expect(report.warnings).toEqual([]);
  });
  it("rejects marks that differ from the answer file, unknown or missing questions, and a non-IB command term", () => {
    expect(exam((v) => { v.questions[0].marks = 3; }).errors.join()).toContain("與答案 JSON 的配分 1 不同");
    expect(exam((v) => { v.questions.pop(); }).errors.join()).toContain("答案 JSON 的題 q6 沒有對應");
    expect(exam((v) => { v.questions[1].question = "q99"; }).errors.join()).toContain("不在答案 JSON 裡");
    expect(exam((v) => { v.questions[2].command_term = "think about"; }).errors.join()).toContain("不是 IB 指令詞");
    expect(exam((v) => { v.questions[2].syllabus_ref = ""; }).errors.join()).toContain("syllabus_ref");
    expect(exam((v) => { v.mark_scheme_note = ""; }).errors.join()).toContain("mark_scheme_note");
  });
  it("wants an easy start and a hard finish, and a believable mix", () => {
    expect(exam((v) => { v.questions.forEach((q, i) => { q.difficulty = i < 3 ? 3 : 1; }); }).errors.join()).toContain("沒有由易到難");
    expect(exam((v) => { v.questions.forEach((q) => { q.difficulty = 2; }); }).warnings.join()).toContain("基礎題");
    expect(exam((v) => { v.questions.forEach((q, i) => { q.difficulty = i < 2 ? 1 : 2; }); }).warnings.join()).toContain("難題（difficulty 3）不到 10%");
    expect(exam((v) => { v.questions.forEach((q, i) => { q.difficulty = i < 1 ? 1 : 3; }); }).warnings.join()).toContain("難題超過 40%");
    expect(EXAM_ALIGNMENT_GUIDE).toContain("exam-alignment/v1");
    expect(EXAM_ALIGNMENT_GUIDE).toContain("由易到難");
  });
});

describe("alignment with the real database and routes", () => {
  let fixture: ReturnType<typeof testDatabase>; let env: OpenMaicCoreEnv;
  const user = { id: "learner", email: "learner@test.example", name: "Learner", avatar_url: null, role: "member" as const };
  const ctx = { waitUntil: () => undefined } as ExecutionContext;
  const api = <T = Record<string, unknown>>(method: string, path: string, body?: unknown) => callApi<T>(env, ctx, user, method, path, body);
  const book = (id: string, kind: string, extra = "NULL,NULL", subject = "phys", status = "ready") => fixture.db.prepare(`INSERT INTO books(id,title,kind,status,subject_id,ib_document_type,ib_level,size_bytes,created_at,updated_at) VALUES (?,?,?,?,?,${extra.split(",").map(() => "?").join(",")},0,1,1)`).run(id, "doc " + id, kind, status, subject, ...extra.split(",").map((v) => v === "NULL" ? null : v));
  const cited = (kind: string, id: string) => ({ kind, book_id: id, title: "doc " + id, pages: "3-9", used_for: "決定範圍、術語與例題" });
  const scenes = (bp: CourseBlueprint) => [
    ...bp.chapters.map((c) => ({ id: "p" + c.key, type: "quiz", title: `先測：${c.key}`, content: { questions: ["a__d1", "b__d2", "c__d2", "d__d3", "e__d3"].map((id) => ({ id })) } })),
    ...bp.chapters.flatMap((c) => [{ id: "l" + c.key, type: "slide", title: c.key }, { id: "k" + c.key, type: "quiz", title: `檢核：${c.key}`, content: { questions: [{ id: "k__d3" }] } }]),
  ];
  beforeEach(() => {
    fixture = testDatabase();
    fixture.db.exec("INSERT INTO users(id,email,created_at) VALUES ('learner','learner@test.example',1)");
    fixture.db.exec("INSERT INTO subjects(id,slug,name,sort) VALUES ('phys','qa-align-phys','Physics',1),('chem','qa-align-chem','Chemistry',2)");
    fixture.db.exec("INSERT INTO documents(id,kind,slug,title,status,created_by,created_at,updated_at,subject_id) VALUES ('note','note','phys-note','熱物理','published','learner',1,1,'phys')");
    fixture.db.exec("INSERT INTO revisions(id,document_id,body_md,source,created_at) VALUES ('r1','note','# 熱物理','import',1)");
    fixture.db.exec("UPDATE documents SET current_revision_id='r1' WHERE id='note'");
    env = { DB: fixture.DB, OPENMAIC_CORE_URL: "https://core.example.test", OPENMAIC_MCP_SECRET: "unit-test-transport-secret-32-characters-only" } as OpenMaicCoreEnv;
    vi.stubGlobal("fetch", vi.fn(async (url: URL, init: RequestInit) => {
      const path = new URL(url).pathname;
      if (path === "/api/materials") return Response.json({ materialId: "m" });
      if (path === "/api/generation-runs") { (globalThis as { __sent?: unknown }).__sent = JSON.parse(String(init.body)); return Response.json({ run: { id: "run-1" } }); }
      if (path === "/api/generate-classroom/run-1") return Response.json({ status: "succeeded", result: { classroomId: "room" } });
      if (path === "/api/stages/room") return Response.json({ scenes: (globalThis as { __scenes?: unknown[] }).__scenes ?? [] });
      return Response.json({});
    }));
  });
  afterEach(() => { vi.unstubAllGlobals(); fixture.db.close(); });

  it("refuses to start from a plan that cites documents that do not exist for the subject", async () => {
    book("syl", "syllabus", "syllabus,both"); book("other", "book", "NULL,NULL", "chem");
    const bp = { ...blueprint(), level: "SL", sources: [cited("ebook", "other")], chapters: blueprint().chapters.map((c) => ({ ...c, objectives: c.objectives.map((o) => ({ ...o, source_pages: "1" })) })) };
    const failure = await startFromBlueprint(api, { note_slug: "phys-note", topic: "熱", blueprint: bp }).catch((error) => error);
    expect(failure.status).toBe(422);
    expect(failure.details.join()).toContain("不是你可存取");
    expect(fixture.db.prepare("SELECT COUNT(*) AS n FROM openmaic_core_runs").get()).toEqual({ n: 0 });
  });

  it("lets a course cite any IB document, whatever subject it was filed under", async () => {
    book("guide", "syllabus", "guideline,both", "chem");
    const check = await api<{ ok: boolean; errors: string[] }>("POST", "/api/openmaic/blueprint-check", { note_slug: "phys-note", blueprint: { ...blueprint(), level: "SL", sources: [cited("ib_guide", "guide")], chapters: blueprint().chapters.map((c) => ({ ...c, objectives: c.objectives.map((o) => ({ ...o, source_pages: "3-9" })) })) } });
    expect(check.errors.join()).not.toContain("不是你可存取");
  });

  it("requires the subject's ebook, then passes, stores the plan and puts it in the generation requirement", async () => {
    book("syl", "syllabus", "syllabus,both"); book("ms", "syllabus", "mark_scheme,SL"); book("bk", "book");
    const withPages = (bp: ReturnType<typeof blueprint>) => ({ ...bp, chapters: bp.chapters.map((c) => ({ ...c, objectives: c.objectives.map((o) => ({ ...o, source_pages: "5-6" })) })) });
    const base = { ...withPages(blueprint()), level: "SL" };
    const only = { ...base, sources: [cited("ib_syllabus", "syl")] };
    const check = await api<{ ok: boolean; errors: string[] }>("POST", "/api/openmaic/blueprint-check", { note_slug: "phys-note", blueprint: only });
    expect(check.ok).toBe(false);
    expect(check.errors.join("\n")).not.toContain("mark scheme"); expect(check.errors.join("\n")).toContain("電子書");
    const full = { ...base, sources: [cited("ib_syllabus", "syl"), cited("ib_markscheme", "ms"), cited("ebook", "bk")] };
    const started = await startFromBlueprint<{ generation_id: string }>(api, { note_slug: "phys-note", topic: "熱", blueprint: full });
    expect(started.generation_id).toBe("run-1");
    const sent = (globalThis as { __sent?: { requirement: string } }).__sent!;
    expect(sent.requirement).toContain("課程藍圖"); expect(sent.requirement).toContain("頻率"); expect(sent.requirement).toContain("p.3-9");
    expect(JSON.parse(fixture.db.prepare("SELECT blueprint_json FROM openmaic_core_runs").get()!.blueprint_json as string).chapters).toHaveLength(2);
  });

  it("blocks publishing a classroom that drops a chapter of its plan, and reports advice without blocking", async () => {
    await startFromBlueprint(api, { note_slug: "phys-note", topic: "熱", blueprint: blueprint() });
    const bp = validateBlueprint(blueprint()).value as CourseBlueprint;
    (globalThis as { __scenes?: unknown[] }).__scenes = scenes(bp).filter((scene) => scene.title !== "檢核：頻率");
    const check = await api<{ ok: boolean; errors: string[] }>("GET", "/api/openmaic/generations/run-1/alignment-check");
    expect(check).toMatchObject({ ok: false, errors: ["缺少檢核場景「檢核：頻率」"] });
    await expect(api("POST", "/api/openmaic/generations/run-1/publish", {})).rejects.toMatchObject({ status: 422 });
    expect(fixture.db.prepare("SELECT COUNT(*) AS n FROM note_courses").get()).toEqual({ n: 0 });
    (globalThis as { __scenes?: unknown[] }).__scenes = scenes(bp);
    const ok = await api<{ ok: boolean; warnings: string[] }>("GET", "/api/openmaic/generations/run-1/alignment-check");
    expect(ok.ok).toBe(true); expect(ok.warnings.join()).toContain("〔補強〕");
    await passClassroomReview(api, "run-1", blueprint());
    expect(await api("POST", "/api/openmaic/generations/run-1/publish", {})).toMatchObject({ classroom_id: "room", alignment_warnings: expect.any(Array) });
  });

  it("a run started before blueprints existed publishes as before", async () => {
    await startFromBlueprint(api, { note_slug: "phys-note", topic: "熱", blueprint: blueprint() });
    fixture.db.exec("UPDATE openmaic_core_runs SET blueprint_json=NULL,blueprint_draft_id=NULL");
    (globalThis as { __scenes?: unknown[] }).__scenes = [];
    expect(await api("GET", "/api/openmaic/generations/run-1/alignment-check")).toMatchObject({ ok: true });
    expect(await api("POST", "/api/openmaic/generations/run-1/publish", {})).toHaveProperty("classroom_id", "room");
  });

  describe("mock exams", () => {
    const answers = { schema: "exam-answers/v1", questions: [{ id: "q1", type: "numeric", answer: 1, points: 1 }, { id: "q2", type: "numeric", answer: 2, points: 1 }, { id: "q3", type: "numeric", answer: 2, points: 2 }, { id: "q4", type: "numeric", answer: 3, points: 2 }, { id: "q5", type: "numeric", answer: 4, points: 3 }] };
    const rows = [["q1", 1, 1], ["q2", 1, 1], ["q3", 2, 2], ["q4", 2, 2], ["q5", 3, 3]].map(([question, marks, difficulty], i) => ({ question, syllabus_ref: "B" + (i + 1), command_term: "State", marks, difficulty }));
    const alignment = (sources: unknown[] = []) => ({ schema: "exam-alignment/v1", level: "SL", paper: "Paper 1A（練習卷）", sources, source_exemptions: [], mark_scheme_note: "依 mark scheme 給分：State 一分，Calculate 依步驟給分", questions: rows });
    it("a subject without any documents may leave the table out, with a warning", async () => {
      expect(await api("POST", "/api/exams/alignment-check", { subject_id: "chem", answers, alignment: undefined })).toMatchObject({ ok: true, required: false });
    });
    it("a subject that has documents must attach the table and cite them", async () => {
      book("syl", "syllabus", "syllabus,both"); book("bk", "book");
      expect(await api("POST", "/api/exams/alignment-check", { subject_id: "phys", answers })).toMatchObject({ ok: false, required: true });
      const missing = await api<{ ok: boolean; errors: string[] }>("POST", "/api/exams/alignment-check", { subject_id: "phys", answers, alignment: alignment([cited("ib_syllabus", "syl")]) });
      expect(missing.ok).toBe(false); expect(missing.errors.join()).toContain("電子書");
      expect(await api("POST", "/api/exams/alignment-check", { subject_id: "phys", answers, alignment: alignment([cited("ib_syllabus", "syl"), cited("ebook", "bk")]) })).toMatchObject({ ok: true, errors: [] });
    });
    it("create_exam over MCP refuses a paper without its table when the subject has documents, and saves it when attached", async () => {
      book("syl", "syllabus", "syllabus,both");
      const server = buildServer({ env, ctx, user, scopes: ["study:read", "study:write"], origin: "https://study.test" });
      const client = new Client({ name: "alignment-test", version: "1" });
      const [ct, st] = InMemoryTransport.createLinkedPair();
      await Promise.all([server.connect(st), client.connect(ct)]);
      const call = async (name: string, args: Record<string, unknown>) => JSON.parse((await client.callTool({ name, arguments: args })).content.find((part) => part.type === "text")!.text as string);
      try {
        const names = (await client.listTools()).tools.map((tool) => tool.name);
        for (const name of ["validate_course_blueprint", "check_openmaic_alignment"]) expect(names).toContain(name);
        expect(JSON.stringify((await client.listTools()).tools.find((tool) => tool.name === "start_openmaic_classroom")!.inputSchema)).toContain("blueprint");
        const markdown = ["q1", "q2", "q3", "q4", "q5"].map((id) => `::::question{#${id}}\n題目 ${id}\n::::`).join("\n\n");
        const refused = await call("create_exam", { title: "練習卷", markdown, answers, subject_id: "phys" });
        expect(refused.created).toBe(false);
        expect(refused.errors.join()).toContain("必須附 alignment");
        const made = await call("create_exam", { title: "練習卷", markdown, answers, subject_id: "phys", alignment: alignment([cited("ib_syllabus", "syl")]) });
        expect(made).toMatchObject({ created: true, alignment_saved: true });
        expect(fixture.db.prepare("SELECT COUNT(*) AS n FROM document_alignments").get()).toEqual({ n: 1 });
        const checked = await call("validate_exam", { markdown, answers, subject_id: "phys", alignment: alignment([cited("ib_syllabus", "syl")]) });
        expect(checked).toMatchObject({ ok: true });
        expect(await call("validate_exam", { markdown, answers, subject_id: "phys" })).toMatchObject({ ok: false, alignment_required: true });
        expect(await call("validate_exam", { markdown, answers })).toMatchObject({ ok: true });
      } finally { await client.close(); await server.close(); }
    });
    it("stores the table with the exam and returns it", async () => {
      const exam = await api<{ slug: string }>("POST", "/api/documents", { kind: "exam", title: "熱物理練習卷", subject_id: "chem", body_md: ["q1", "q2", "q3", "q4", "q5"].map((id) => `::::question{#${id}}\n題目 ${id}\n::::`).join("\n\n"), visibility: "shared" });
      await api("POST", `/api/exams/${exam.slug}/answers`, { answers, message: "t" });
      expect(await api("PUT", `/api/exams/${exam.slug}/alignment`, { alignment: alignment() })).toMatchObject({ saved: true });
      expect((await api<{ alignment: { paper: string } }>("GET", `/api/exams/${exam.slug}/alignment`)).alignment.paper).toBe("Paper 1A（練習卷）");
      const bad = await api("PUT", `/api/exams/${exam.slug}/alignment`, { alignment: { ...alignment(), questions: rows.slice(1) } }).catch((error) => error);
      expect(bad.status).toBe(422);
    });
  });
});
