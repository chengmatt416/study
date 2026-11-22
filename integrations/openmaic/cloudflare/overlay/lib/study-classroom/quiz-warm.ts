'use client';

import { loadQuizAttemptState, type LoadedQuizAttemptState } from '@/lib/quiz/runtime';
import { collectImageUrls, createWarmCache } from './warm';

type Input = { stageId: string; sceneId: string };
const attempts = createWarmCache<LoadedQuizAttemptState>();
const key = ({ stageId, sceneId }: Input) => `${stageId}:${sceneId}`;
const requested = new Set<string>();

/** Reads the learner's quiz state before the quiz opens; it is a server round trip that otherwise holds the quiz behind a spinner. */
export function warmQuizAttempt(input: Input): void {
  attempts.warm(key(input), () => loadQuizAttemptState(input));
}

/** The quiz view's loader: a warmed read when one is ready, otherwise the normal read. Warm reads are single use. */
export function loadStudyQuizAttempt(input: Input): Promise<LoadedQuizAttemptState> {
  return attempts.take(key(input)) ?? loadQuizAttemptState(input);
}

/** Starts fetching images used by a quiz so the browser (and the service worker's classroom-media cache) already has them. */
export function warmQuizImages(questions: unknown): void {
  for (const url of collectImageUrls(questions)) {
    if (requested.has(url)) continue;
    requested.add(url);
    const image = new Image();
    image.decoding = 'async';
    image.src = url;
  }
}
