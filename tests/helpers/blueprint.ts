import { BLUEPRINT_SCHEMA } from "../../src/shared/course-blueprint";

/** A blueprint for a note that has no ebook or IB documents behind it: the note itself is the only source. */
export const blueprint = () => ({
  schema: BLUEPRINT_SCHEMA, level: "none", learner: "高一學生，已學過國中數學與基本物理量",
  sources: [{ kind: "note", title: "來源筆記", used_for: "筆記是這門課唯一的依據" }],
  source_exemptions: [],
  chapters: [
    { key: "週期", summary: "說明週期是重複一次所需的時間", prerequisites: [], minutes: 12, difficulty: 1,
      new_concepts: [{ name: "週期", kind: "term" }], objectives: [{ id: "t-define", text: "定義週期並說出單位", command_term: "define", syllabus_ref: "1.1", bloom: "remember" }], misconceptions: [], exam_traps: ["單位寫成赫茲"] },
    { key: "頻率", summary: "頻率是週期的倒數", prerequisites: ["週期"], minutes: 12, difficulty: 2,
      new_concepts: [{ name: "f = 1/T", kind: "formula" }], objectives: [{ id: "f-calc", text: "由週期計算頻率", command_term: "calculate", syllabus_ref: "1.2", bloom: "apply" }], misconceptions: [], exam_traps: [] },
  ],
  assessment: { pretest_plan: "每章 5 到 6 題，基礎、核心、難題三個難度都有，難題考多步驟推理", checkpoint_plan: "只考已經講解過的內容，並含一題 __d3 遷移題，不重複前測題目", exam_alignment: "題型與指令詞對應課本習題與段考，給分點依老師提供的評分標準" },
});
