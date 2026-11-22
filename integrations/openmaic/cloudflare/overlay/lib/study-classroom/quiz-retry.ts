import { loadQuizAttemptState, type QuizAttemptWriter } from '@/lib/quiz/runtime';
import { persistQuizRetry } from '@/lib/quiz/view-state';

/** A completed view may hold the root id; a new attempt must write to its active child. */
export async function retryStudyQuiz(
  input: { stageId: string; sceneId: string; attemptId: string },
  writer: Pick<QuizAttemptWriter, 'recordPhase'>,
  load = loadQuizAttemptState,
) {
  await persistQuizRetry(input, writer);
  return load({ stageId: input.stageId, sceneId: input.sceneId });
}
