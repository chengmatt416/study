'use client';

import { useEffect } from 'react';
import type { Slide } from '@openmaic/dsl';
import { useStageStore } from '@/lib/store/stage';
import { useResolvedSlide } from '@/components/slide-renderer/use-resolved-slide';
import { warmQuizAttempt, warmQuizImages } from '@/lib/study-classroom/quiz-warm';

/** Fetches the images of one upcoming slide through the same resolution the slide itself uses, so they are cached when it opens. */
function PrefetchSlide({ slide }: { slide: Slide }) {
  const resolved = useResolvedSlide(slide);
  useEffect(() => {
    for (const element of resolved.elements.slice(0, 40)) {
      if (element.type !== 'image' || typeof element.src !== 'string' || !element.src || element.src.startsWith('data:')) continue;
      const image = new Image();
      image.decoding = 'async';
      image.src = element.src;
    }
  }, [resolved]);
  return null;
}

/** Quizzes sit behind a state read and may carry images; both start as soon as the quiz is within the next three scenes. */
function PrefetchQuiz({ stageId, sceneId, questions }: { stageId: string; sceneId: string; questions: unknown }) {
  useEffect(() => {
    warmQuizAttempt({ stageId, sceneId });
    warmQuizImages(questions);
  }, [stageId, sceneId, questions]);
  return null;
}

/** Renders nothing. Warms the next two slides and the next three quizzes while the learner reads the current scene. */
export function StudyScenePrefetch() {
  const scenes = useStageStore(state => state.scenes);
  const currentId = useStageStore(state => state.currentSceneId);
  const index = scenes.findIndex(scene => scene.id === currentId);
  if (index < 0) return null;
  return <>
    {scenes.slice(index + 1, index + 3).map(scene => (scene.content.type === 'slide' ? <PrefetchSlide key={scene.id} slide={scene.content.canvas} /> : null))}
    {scenes.slice(index + 1, index + 4).map(scene => (scene.content.type === 'quiz' ? <PrefetchQuiz key={scene.id} stageId={scene.stageId} sceneId={scene.id} questions={scene.content.questions} /> : null))}
  </>;
}
