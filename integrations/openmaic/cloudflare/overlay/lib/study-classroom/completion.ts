import type { Scene } from '@/lib/types/stage';
import { pendingCompleteSummary, readSceneQuizAnswers, summarizeScenes, type CompleteSummary } from '@/lib/classroom/complete-summary';
import { buildCourseMap } from './course-map';

export interface StudyOutcome {
  checking: boolean;
  assessments: number;
  reviewed: number;
  unattempted: number;
  pending: number;
  unavailable: number;
  ungraded: number;
}
export interface StudyCompleteSummary extends CompleteSummary { study?: StudyOutcome }
interface QuizState {
  phase?: string;
  answers: Record<string, string | string[]>;
  results?: { questionId: string; correct: boolean | null }[];
}
type QuizLoader = (input: { stageId: string; sceneId: string }) => Promise<{ state?: QuizState }>;

export function pendingStudyCompleteSummary(scenes: Scene[]): StudyCompleteSummary {
  const summary = pendingCompleteSummary(scenes), map = buildCourseMap(scenes);
  if (!map.active) return summary;
  return { ...summary, study: { checking: true, assessments: scenes.filter(scene => scene.type === 'quiz' && map.roles[scene.id]?.role !== 'pretest').length, reviewed: 0, unattempted: 0, pending: 0, unavailable: 0, ungraded: 0 } };
}

export function studyCompleteSummaryForScenes(scenes: Scene[], resolved: { scenes: Scene[]; summary: StudyCompleteSummary }): StudyCompleteSummary {
  return resolved.scenes === scenes ? resolved.summary : pendingStudyCompleteSummary(scenes);
}

/** Diagnostic answers describe the starting point; the final result uses reviewed assessments only. */
export async function summarizeStudyScenes(scenes: Scene[], load: QuizLoader): Promise<StudyCompleteSummary> {
  const map = buildCourseMap(scenes);
  if (!map.active) return summarizeScenes(scenes, id => readSceneQuizAnswers(scenes.find(scene => scene.id === id), load));
  const summary = pendingStudyCompleteSummary(scenes), study = summary.study!;
  let correct = 0, total = 0;
  for (const scene of scenes) {
    if (scene.type !== 'quiz' || map.roles[scene.id]?.role === 'pretest') continue;
    if (!scene.stageId) { study.unavailable++; continue; }
    let state: QuizState | undefined;
    try { state = (await load({ stageId: scene.stageId, sceneId: scene.id })).state; }
    catch { study.unavailable++; continue; }
    if (!state || state.phase === 'draft') { study.unattempted++; continue; }
    if (state.phase !== 'reviewed') { study.pending++; continue; }
    study.reviewed++;
    const results = new Map((state.results ?? []).map(result => [result.questionId, result]));
    const questions = scene.content.type === 'quiz' ? scene.content.questions ?? [] : [];
    for (const question of questions) {
      const result = results.get(question.id);
      if (result?.correct === true || result?.correct === false) { total++; if (result.correct) correct++; }
      else study.ungraded++;
    }
  }
  study.checking = false;
  summary.quiz = total ? { correct, total, pct: Math.round(correct / total * 100) } : null;
  return summary;
}
