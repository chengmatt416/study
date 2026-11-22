import { gradeCourseQuestion, type CourseScene, type QuizQuestion } from "./openmaic";

export type LearningChapter = Extract<CourseScene, { type: "interactive" }>;
export type Responses = Record<string, string[]>;
export type LearningPhase = "welcome" | "pretest" | "route" | "teaching" | "interaction" | "checkpoint" | "final" | "complete";
export interface LearningState {
  phase: LearningPhase;
  route: number[];
  chapter: number;
  teachingStep: number;
  interactionStep: number;
  checkpointPassed: boolean;
  cycle: number;
}
export const initialLearningState: LearningState = { phase: "welcome", route: [], chapter: 0, teachingStep: 0, interactionStep: 0, checkpointPassed: false, cycle: 0 };

export function masteryPassed(questions: QuizQuestion[], responses: Responses): boolean {
  return questions.length > 0 && questions.every((q) => gradeCourseQuestion(q, responses[q.id] ?? []) === true);
}

/** Start at the earliest gap, retaining all later chapters in prerequisite order. */
export function diagnosticRoute(chapters: LearningChapter[], responses: Responses[]): number[] {
  const start = chapters.findIndex((chapter, i) => !masteryPassed(chapter.content.pretest ?? [], responses[i] ?? {}));
  return start < 0 ? [] : chapters.map((_, i) => i).slice(start);
}

export type LearningAction =
  | { type: "start" | "begin" | "teach-next" | "teach-back" | "check" | "relearn" | "advance" | "restart" }
  | { type: "diagnose"; responses: Responses[] }
  | { type: "all-chapters" }
  | { type: "interact"; step: number }
  | { type: "assess"; responses: Responses };

export function advanceLearning(state: LearningState, action: LearningAction, chapters: LearningChapter[], hasFinal: boolean): LearningState {
  const chapter = chapters[state.route[state.chapter]];
  switch (action.type) {
    case "restart": return { ...initialLearningState };
    case "start": return state.phase === "welcome" ? { ...state, phase: "pretest" } : state;
    case "diagnose": return state.phase === "pretest" ? { ...state, phase: "route", route: diagnosticRoute(chapters, action.responses) } : state;
    case "all-chapters": return state.phase === "route" ? { ...state, route: chapters.map((_, i) => i) } : state;
    case "begin": return state.phase === "route" ? { ...state, phase: state.route.length ? "teaching" : hasFinal ? "final" : "complete" } : state;
    case "teach-next": {
      if (state.phase !== "teaching" || !chapter?.content.teaching_steps) return state;
      const last = state.teachingStep === chapter.content.teaching_steps.length - 1;
      return { ...state, phase: last ? "interaction" : "teaching", teachingStep: last ? state.teachingStep : state.teachingStep + 1 };
    }
    case "teach-back": return state.phase === "teaching" ? { ...state, teachingStep: Math.max(0, state.teachingStep - 1) } : state;
    case "interact": {
      if (state.phase !== "interaction" || !chapter?.content.lesson_steps || !Number.isInteger(action.step) || action.step < 0 || action.step >= chapter.content.lesson_steps.length) return state;
      return { ...state, interactionStep: action.step };
    }
    case "check": return state.phase === "interaction" && chapter?.content.lesson_steps && state.interactionStep === chapter.content.lesson_steps.length - 1 ? { ...state, phase: "checkpoint" } : state;
    case "assess": return state.phase === "checkpoint" ? { ...state, checkpointPassed: masteryPassed(chapter?.content.checkpoint ?? [], action.responses) } : state;
    case "relearn": return ["interaction", "checkpoint"].includes(state.phase) ? { ...state, phase: "teaching", teachingStep: 0, interactionStep: 0, checkpointPassed: false, cycle: state.cycle + 1 } : state;
    case "advance": {
      if (state.phase !== "checkpoint" || !state.checkpointPassed) return state;
      const next = state.chapter + 1;
      return { ...state, chapter: next, phase: next < state.route.length ? "teaching" : hasFinal ? "final" : "complete", teachingStep: 0, interactionStep: 0, checkpointPassed: false };
    }
  }
}
