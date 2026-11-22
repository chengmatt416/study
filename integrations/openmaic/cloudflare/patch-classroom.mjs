import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export function patchStudyCourseCompleteSlot(source) {
  const before = `key="course-complete-slot"
                  onClick={() => {
                    if (onSceneSelect) {
                      onSceneSelect(PENDING_SCENE_ID);
                    } else {
                      setCurrentSceneId(PENDING_SCENE_ID);
                    }
                  }}`;
  if (!source.includes(before)) throw new Error('Pinned classroom completion selection patch no longer matches');
  return source.replace(before, `key="course-complete-slot"
                  data-testid="scene-complete-item"
                  role="button"
                  tabIndex={0}
                  aria-current={isActive ? 'step' : undefined}
                  aria-label={t('stage.courseComplete')}
                  onKeyDown={(event) => {
                    if (event.target === event.currentTarget && (event.key === 'Enter' || event.key === ' ')) {
                      event.preventDefault(); event.currentTarget.click();
                    }
                  }}
                  onClick={() => {
                    if (onSceneSelect) {
                      onSceneSelect(PENDING_SCENE_ID);
                    } else {
                      setCurrentSceneId(PENDING_SCENE_ID);
                    }
                    if (window.matchMedia('(max-width: 700px), (max-height: 500px) and (pointer: coarse)').matches) onCollapseChange(true);
                  }}`);
}

export async function patchStudyClassroom(core) {
  async function replace(file, before, after) {
    const target = path.join(core, file), source = await readFile(target, 'utf8');
    if (!source.includes(before)) throw new Error(`Pinned classroom patch no longer matches ${file}: ${before.slice(0, 90)}`);
    await writeFile(target, source.replace(before, after));
  }
  await replace('lib/playback/types.ts', 'export interface PlaybackEngineCallbacks {', `export interface PlaybackEngineCallbacks {
  /** STUDY narration waits for an explicit learner action, without audio. */
  manualNarration?: boolean;`);
  await replace('lib/playback/engine.ts', "const log = createLogger('PlaybackEngine');", `import { splitDialogue } from '@/lib/study-classroom/dialogue';
const log = createLogger('PlaybackEngine');`);
  await replace('lib/playback/engine.ts', '  private playbackGeneration: number = 0;', `  private playbackGeneration: number = 0;
  private manualDialogue: { sentences: string[]; index: number } | null = null;

  /** Consume exactly one learner click. Visual actions still use the official engine. */
  advanceNarration(): boolean {
    if (this.mode !== 'playing' || !this.manualDialogue) return false;
    this.callbacks.onSpeechEnd?.();
    const dialogue = this.manualDialogue;
    dialogue.index++;
    if (dialogue.index < dialogue.sentences.length) {
      this.callbacks.onSpeechStart?.(dialogue.sentences[dialogue.index]);
    } else {
      this.manualDialogue = null;
      // The learner finished this line: its spotlight, laser and highlights end with it, not after a fixed five seconds.
      this.actionEngine.clearEffects();
      this.processNext();
    }
    return true;
  }`);
  for (const anchor of [
    '  restoreFromSnapshot(snapshot: PlaybackSnapshot): void {',
    '  stop(): void {',
    '  handleUserInterrupt(text: string): void {',
    '  private cancelActivePlaybackWork(): void {',
  ]) await replace('lib/playback/engine.ts', anchor, anchor + '\n    this.manualDialogue = null;');
  await replace('lib/playback/engine.ts', '      // Resume lecture\n      this.setMode(\'playing\');', `      // Resume a manual line in place; only a learner click consumes it.
      this.setMode('playing');
      if (this.manualDialogue) return;`);
  await replace('lib/playback/engine.ts', `        const speechAction = action as SpeechAction;
        this.callbacks.beforeSpeech?.();`, `        const speechAction = action as SpeechAction;
        if (this.callbacks.manualNarration) {
          const sentences = splitDialogue(speechAction.text);
          this.manualDialogue = { sentences, index: 0 };
          this.callbacks.beforeSpeech?.();
          this.callbacks.onSpeechStart?.(sentences[0]);
          break;
        }
        this.callbacks.beforeSpeech?.();`);
  await replace('components/edit/PlaybackChromeRoot.tsx', "import { toast } from 'sonner';", `import { toast } from 'sonner';
import { StudyLessonDock } from '@/components/study/StudyLessonDock';
import { isStudyQuizGraded, studyAdaptiveTarget, studyFallbackTarget, studyPreviousTarget } from '@/lib/study-classroom/adaptive';
import { StudyScenePrefetch } from '@/components/study/StudyScenePrefetch';
import { StudyContentsGuard } from '@/components/study/StudyContentsGuard';
import { StudyNextSteps } from '@/components/study/StudyNextSteps';`);
  await replace('components/edit/PlaybackChromeRoot.tsx', `    const [lectureSpeech, setLectureSpeech] = useState<string | null>(null);`, `    const [showStudyDiscussion, setShowStudyDiscussion] = useState(false);
    const dialogueAdvanceRef = useRef(false);
    const [lectureSpeech, setLectureSpeech] = useState<string | null>(null);`);
  await replace('components/edit/PlaybackChromeRoot.tsx', 'enabled: ttsEnabled && !ttsMuted,', 'enabled: false, // STUDY uses learner-paced text for lecture and discussion.');
  await replace('components/edit/PlaybackChromeRoot.tsx', '          beforeSpeech: pauseInteractiveMedia,', '          manualNarration: true,\n          beforeSpeech: pauseInteractiveMedia,');
  await replace('components/edit/PlaybackChromeRoot.tsx', '            const { autoPlayLecture } = useSettingsStore.getState();', '            const autoPlayLecture = false; // Chapter changes require a learner click.');
  await replace('components/edit/PlaybackChromeRoot.tsx', '    const currentSceneIndex = isPendingScene\n      ? scenes.length', `    // Adaptive courses route "continue" from the learner's results; other courses keep their linear order.
    const adaptiveBusyRef = useRef(false);
    const handleAdaptiveNext = useCallback(async () => {
      if (isPendingScene || adaptiveBusyRef.current) return;
      if (mode !== 'playback') { handleNextScene(); return; }
      adaptiveBusyRef.current = true;
      try {
        const target = (await studyAdaptiveTarget(currentSceneId)) ?? studyFallbackTarget(currentSceneId);
        if (useStageStore.getState().currentSceneId !== currentSceneId) return;
        if (target) void gatedSceneSwitch(target); else handleNextScene();
      } finally { adaptiveBusyRef.current = false; }
    }, [currentSceneId, gatedSceneSwitch, handleNextScene, isPendingScene, mode]);

    const currentSceneIndex = isPendingScene
      ? scenes.length`);
  await replace('components/edit/PlaybackChromeRoot.tsx', '      const currentIndex = scenes.findIndex((s) => s.id === currentSceneId);\n      if (currentIndex > 0) {', `      const previous = mode === 'playback' ? studyPreviousTarget(currentSceneId) : null;
      if (previous) { void gatedSceneSwitch(previous); return; }
      const currentIndex = scenes.findIndex((s) => s.id === currentSceneId);
      if (currentIndex > 0) {`);
  await replace('components/edit/PlaybackChromeRoot.tsx', '    }, [currentSceneId, gatedSceneSwitch, isPendingScene, scenes]);', '    }, [currentSceneId, gatedSceneSwitch, isPendingScene, scenes, mode]);');
  await replace('components/edit/PlaybackChromeRoot.tsx', '              onNextSlide={handleNextScene}', "              onNextSlide={mode === 'playback' ? handleAdaptiveNext : handleNextScene}");
  // One "continue" for the button, the dialogue and the Space key: the next line, or on to the next chapter once the lesson (or a graded quiz) is done.
  await replace('components/edit/PlaybackChromeRoot.tsx', '    const totalScenesCount = scenes.length + (canAdvanceToPendingSlot ? 1 : 0);\n', `    const totalScenesCount = scenes.length + (canAdvanceToPendingSlot ? 1 : 0);
    const handleStudyContinue = useCallback(() => {
      if ((playbackCompleted || isStudyQuizGraded(currentSceneId)) && currentSceneIndex < totalScenesCount - 1) void handleAdaptiveNext();
      else void handleContinueNarration();
    }, [currentSceneId, currentSceneIndex, handleAdaptiveNext, handleContinueNarration, playbackCompleted, totalScenesCount]);
`);
  await replace('components/edit/PlaybackChromeRoot.tsx', '    // get scene information', `    const handleContinueNarration = useCallback(async () => {
      if (dialogueAdvanceRef.current) return;
      dialogueAdvanceRef.current = true;
      try {
        const engine = engineRef.current;
        if (!engine || engine.getMode() === 'live') return;
        if (engine.getMode() === 'paused') engine.resume();
        if (!engine.advanceNarration() && engine.getMode() === 'idle') await handlePlayPause();
      } finally { dialogueAdvanceRef.current = false; }
    }, [handlePlayPause]);

    // get scene information`);
  await replace('components/edit/PlaybackChromeRoot.tsx', "['input', 'textarea', 'select', '[role=\"slider\"]', 'input[type=\"range\"]']", "['input', 'textarea', 'select', 'button', 'a', 'summary', '[role=\"button\"]', '[role=\"slider\"]', 'input[type=\"range\"]']");
  await replace('components/edit/PlaybackChromeRoot.tsx', `            handlePlayPause();
            break;
          case 'Escape':`, `            // The official handler replays a finished lesson; STUDY moves on to the next chapter instead.
            handleStudyContinue();
            break;
          case 'Escape':`);
  await replace('components/edit/PlaybackChromeRoot.tsx', `      handlePlayPause,
`, `      handlePlayPause,
      handleStudyContinue,
      handleAdaptiveNext,
`);
  await replace('components/edit/PlaybackChromeRoot.tsx', `          case 'ArrowRight':
            if (!isPresenting) return;
            event.preventDefault();
            handleNextScene();`, `          case 'ArrowRight':
            if (!isPresenting) return;
            event.preventDefault();
            void handleAdaptiveNext();`);
  await replace('components/edit/PlaybackChromeRoot.tsx', `'flex-1 flex overflow-hidden bg-gray-50 dark:bg-gray-900',`, `'study-classroom flex-1 flex overflow-hidden bg-gray-50 dark:bg-gray-900',`);
  await replace('components/edit/PlaybackChromeRoot.tsx', '          {/* Roundtable Area */}\n          {mode === \'playback\' && (', `          <StudyScenePrefetch />
          <StudyContentsGuard open={!sidebarCollapsed} onClose={() => setSidebarCollapsed(true)} />
          {isCourseComplete && isPendingScene && <StudyNextSteps complete onReview={handlePreviousScene} />}
          {currentScene && <StudyLessonDock
            text={lectureSpeech ?? firstSpeechText ?? ''}
            fullText={currentScene.actions?.[currentPlaybackActionIndex ?? 0]?.type === 'speech' ? (currentScene.actions[currentPlaybackActionIndex ?? 0] as SpeechAction).text : firstSpeechText ?? ''}
            title={currentScene.title}
            sceneId={currentScene.id}
            sceneIndex={currentSceneIndex}
            sceneCount={totalScenesCount}
            started={engineMode !== 'idle'}
            completed={playbackCompleted}
            busy={engineMode === 'live' || !!chatSessionType && chatSessionType !== 'lecture'}
            discussionOpen={showStudyDiscussion && !studyDiscussion.minimized}
            discussionLive={engineMode === 'live' || !!discussionTrigger || chatSessionType === 'qa' || chatSessionType === 'discussion'}
            discussionStreaming={chatIsStreaming}
            discussionMinimized={studyDiscussion.minimized}
            discussionUnread={studyDiscussion.unread}
            onResumeDiscussion={() => { setShowStudyDiscussion(true); setStudyDiscussionMinimized(false); }}
            onGoToScene={(sceneId) => { void gatedSceneSwitch(sceneId); }}
            onContinue={handleStudyContinue}
            onPrevious={handlePreviousScene}
            onNext={handleAdaptiveNext}
            contentsOpen={!sidebarCollapsed}
            onToggleContents={() => setSidebarCollapsed(!sidebarCollapsed)}
            onToggleDiscussion={() => { if (studyDiscussion.minimized) setStudyDiscussionMinimized(false); else setShowStudyDiscussion(value => !value); }}
            onStartPeerDiscussion={() => { setStudyDiscussionMinimized(false); setShowStudyDiscussion(true); handleDiscussionSSE(currentScene.title, '請同學們和我一起討論這一節的重點，並讓我加入發言。', 'default-1'); }}
          />}
          {/* The complete native roundtable remains available on demand. */}
          {mode === 'playback' && (showStudyDiscussion || engineMode === 'live' || !!discussionTrigger || chatSessionType === 'qa' || chatSessionType === 'discussion') && (`);
  await replace('components/canvas/canvas-area.tsx', '  const showPlayHint =\n    showControls &&', '  const showPlayHint =\n    false && showControls &&');
  await replace('components/classroom/ClassroomSurface.tsx', 'useNarrationAdoption(classroomId, { ready: !loading && !error, mayGenerate });', 'useNarrationAdoption(classroomId, { ready: false, mayGenerate });');
  await replace('components/roundtable/index.tsx', 'const ttsEnabled = !!useModelCapabilities().tts;', 'useModelCapabilities();\n  const ttsEnabled = false;');
  await replace('components/edit/PlaybackChromeRoot.tsx', '                onResumeTopic={doResumeTopic}\n                onPlayPause={handlePlayPause}', '                onResumeTopic={doResumeTopic}\n                onPlayPause={handleContinueNarration}');
  await replace('components/stage/scene-sidebar.tsx', 'className="bg-white/80', 'className="study-scene-sidebar bg-white/80');
  await replace('components/stage/scene-sidebar.tsx', '    <div\n      style={{', '    <div\n      id="study-contents"\n      style={{');
  await replace('components/stage/scene-sidebar.tsx', "onClick={() => router.push('/')}", "onClick={() => window.location.assign('/')}");
  await replace('components/stage/scene-sidebar.tsx', 'data-testid="scene-item"', `data-testid="scene-item"
                role="button"
                tabIndex={0}
                aria-current={isActive ? 'step' : undefined}
                aria-label={\`\${index + 1}. \${scene.title}\`}
                onKeyDown={(event) => {
                  if (event.target === event.currentTarget && (event.key === 'Enter' || event.key === ' ')) {
                    event.preventDefault(); event.currentTarget.click();
                  }
                }}`);
  await replace('components/stage/scene-sidebar.tsx', `                    setCurrentSceneId(scene.id);
                  }
                }}`, `                    setCurrentSceneId(scene.id);
                  }
                  if (window.matchMedia('(max-width: 700px), (max-height: 500px) and (pointer: coarse)').matches) onCollapseChange(true);
                }}`);
  await replace('components/stage/scene-sidebar.tsx', 'className="relative aspect-video w-full rounded', 'aria-hidden="true" inert className="relative aspect-video w-full rounded');
  await replace('components/stage/scene-sidebar.tsx', 'onClick={() => onCollapseChange(true)}', 'aria-label="收起章節目錄"\n            onClick={() => onCollapseChange(true)}');
  await replace('components/stage/scene-sidebar.tsx', 'className="w-7 h-7 shrink-0', 'className="study-contents-close w-7 h-7 shrink-0');
  await replace('components/stage/scene-sidebar.tsx', 'className="h-10 flex items-center justify-between', 'className="min-h-14 flex items-center justify-between');
  const sidebar = path.join(core, 'components/stage/scene-sidebar.tsx');
  await writeFile(sidebar, patchStudyCourseCompleteSlot(await readFile(sidebar, 'utf8')));
  await replace('lib/workbench/classroom-exit.ts', '  router.push(resolveClassroomExit({ searchParams }).href);', `  const destination = resolveClassroomExit({ searchParams }).href;
  if (destination === '/' && typeof window !== 'undefined') window.location.assign(destination);
  else router.push(destination);`);
  const completePage = 'components/scene-renderers/classroom-complete.tsx';
  await replace(completePage, `import {
  completeSummaryForScenes,
  pendingCompleteSummary,
  readSceneQuizAnswers,
  summarizeScenes,
} from '@/lib/classroom/complete-summary';`, `import {
  studyCompleteSummaryForScenes as completeSummaryForScenes,
  pendingStudyCompleteSummary as pendingCompleteSummary,
  summarizeStudyScenes,
} from '@/lib/study-classroom/completion';
import { StudyOutcomeNote } from '@/components/study/StudyOutcomeNote';`);
  await replace(completePage, "import { createLogger } from '@/lib/logger';\n\nconst log = createLogger('ClassroomComplete');", '');
  await replace(completePage, `    void summarizeScenes(scenes, async (sceneId) => {
      const scene = scenes.find((candidate) => candidate.id === sceneId);
      try {
        return await readSceneQuizAnswers(scene, loadQuizAttemptState);
      } catch (error) {
        log.warn(\`Failed to load quiz summary for scene \${sceneId}:\`, error);
        return undefined;
      }
    }).then((next) => {`, `    void summarizeStudyScenes(scenes, loadQuizAttemptState).then((next) => {`);
  await replace(completePage, '  const summary = completeSummaryForScenes(scenes, resolvedSummary);', `  const [studySummaryAttempt, setStudySummaryAttempt] = useState(0);
  const summary = completeSummaryForScenes(scenes, resolvedSummary);`);
  await replace(completePage, '    void summarizeStudyScenes(scenes, loadQuizAttemptState).then((next) => {', `    setResolvedSummary({ scenes, summary: pendingCompleteSummary(scenes) });
    void summarizeStudyScenes(scenes, loadQuizAttemptState).then((next) => {`);
  await replace(completePage, '  }, [scenes]);', '  }, [scenes, studySummaryAttempt]);');
  await replace(completePage, '              {/* Stats cards */}', `              {summary.study && <StudyOutcomeNote outcome={summary.study} onRetry={() => setStudySummaryAttempt(value => value + 1)} />}
              {summary.study && <p className="study-inventory-label">本課教材數量（包含可選版本）</p>}
              {/* Stats cards */}`);
  await replace(completePage, '{t(`classroomComplete.encouragement.${encouragementKey(summary.quiz.pct)}`)}', "{summary.study ? '這是已批改題目的結果；未完成或待覆核的檢核另列。' : t(`classroomComplete.encouragement.${encouragementKey(summary.quiz.pct)}`)}");
  await replace('components/edit/PlaybackChromeRoot.tsx', '        <SceneSidebar\n', '        {!sidebarCollapsed && <button type="button" className="study-contents-backdrop" aria-label="關閉章節目錄" onClick={() => setSidebarCollapsed(true)} />}\n        <SceneSidebar\n');
  await replace('components/scene-renderers/InteractiveIframeHost.tsx', "import { useI18n }", "import { fitStudyInteractiveViewport } from '@/lib/study-classroom/viewport';\nimport { useI18n }");
  await replace('components/scene-renderers/InteractiveIframeHost.tsx', 'const viewport = rect ? fitGenUiViewport(rect) : null;', 'const viewport = rect ? fitStudyInteractiveViewport(rect, entry.sourceHtml) : null;');
  await replace('components/scene-renderers/InteractiveIframeHost.tsx', '  fitGenUiViewport,\n', '');
  await replace('components/scene-renderers/InteractiveIframeHost.tsx', '    width: GENUI_LOGICAL_WIDTH,\n    height: GENUI_LOGICAL_HEIGHT,', '    width: viewport ? viewport.box.width / (viewport.scale || 1) : GENUI_LOGICAL_WIDTH,\n    height: viewport ? viewport.box.height / (viewport.scale || 1) : GENUI_LOGICAL_HEIGHT,');
  await replace('app/layout.tsx', "import { ProSwapWatcher }", "import { StudyAppProvider } from '@/components/study/StudyAppContext';\nimport { StudyClassroomHost } from '@/components/study/StudyClassroomHost';\nimport { ProSwapWatcher }");
  await replace('app/layout.tsx', '              <ModelSettingsInit />', `              <StudyClassroomHost hosted={headerStore.get('x-study-host') === '1'} />
              <ModelSettingsInit />`);
  await replace('app/layout.tsx', '              <StudyClassroomHost hosted=', '              <StudyAppProvider hosted={headerStore.get(\'x-study-host\') === \'1\'}>\n              <StudyClassroomHost hosted=');
  await replace('app/layout.tsx', '              <StorageHealthNotice />', '              <StorageHealthNotice />\n              </StudyAppProvider>');
  const quizPath = path.join(core, 'components/scene-renderers/quiz-view.tsx');
  let quiz = await readFile(quizPath, 'utf8');
  quiz = quiz.replace("import { answerIncludesOption }", "import { gradeSystemQuestion } from '@/lib/study-classroom/grading';\nimport { recordStudyQuiz, setStudyQuizGraded, studyQuestionsFor } from '@/lib/study-classroom/adaptive';\nimport { STUDY_UNSURE, toggleChoice } from '@/lib/study-classroom/unsure';\nimport { StudyFormulaInput } from '@/components/study/StudyFormulaInput';\nimport { StudyQuizReviewProvider, StudyQuizRegrade } from '@/components/study/StudyQuizReview';\nimport { answerIncludesOption }");
  const gradeStart = quiz.indexOf('/** Call /api/quiz-grade');
  const gradeEnd = quiz.indexOf('// ─── Sub-components', gradeStart);
  if (gradeStart < 0 || gradeEnd < 0) throw new Error('Quiz grading anchor changed');
  quiz = quiz.slice(0, gradeStart) + quiz.slice(gradeEnd);
  quiz = quiz.replace("import { gradeChoiceQuestions, isShortAnswer, type QuestionResult }", "import { type QuestionResult }");
  quiz = quiz.replace("import { SpeechButton } from '@/components/audio/speech-button';\n", '');
  const inputStart = quiz.indexOf('          <textarea');
  const inputEnd = quiz.indexOf('        </div>',inputStart);
  if (inputStart < 0 || inputEnd < 0) throw new Error('Quiz answer input anchor changed');
  quiz = quiz.slice(0,inputStart) + `          <StudyFormulaInput value={value ?? ''} onChange={onChange} disabled={disabled} placeholder={t('quiz.inputPlaceholder')} />\n` + quiz.slice(inputEnd);
  // The common footer labels system/pending/reviewed grades consistently.
  const commentStart = quiz.indexOf('          {result.aiComment && (');
  const commentEnd = quiz.indexOf('          )}', commentStart);
  quiz = quiz.slice(0,commentStart) + quiz.slice(commentEnd + '          )}'.length);
  quiz = quiz.replace('      {/* Analysis (review only) */}', '      {isReview && <StudyQuizRegrade id={question.id} result={result} />}\n      {/* Analysis (review only) */}');
  quiz = quiz.replace('// When entering grading phase, grade choice questions locally + call API for short-answer', '// Grade submitted answers deterministically; AI review requires a learner click.');
  quiz = quiz.replaceAll("result.status === 'incorrect'", "result.correct !== null && result.status === 'incorrect'");
  quiz = quiz.replace("        !isReview && 'border-gray-150", "        isReview && result.correct === null && 'border-gray-200 dark:border-gray-700',\n        !isReview && 'border-gray-150");
  quiz = quiz.replace("          !isReview && 'bg-violet-400',", "          (!isReview || result.correct === null) && 'bg-violet-400',");
  quiz = quiz.replace("results.filter((r) => r.status === 'incorrect')", "results.filter((r) => r.correct !== null && r.status === 'incorrect')");
  quiz = quiz.replace("  const c = colorMap[color];", "  const c = colorMap[color];\n  const pendingCount = results.filter(r => r.correct === null).length;");
  quiz = quiz.replace('{c.text}</p>', "{total === 0 ? '尚未評分' : c.text}</p>\n          {pendingCount > 0 && <p className=\"text-xs mt-1\">{pendingCount} 題待覆核，不計入以下總分</p>}");
  quiz = quiz.replace('{pct}%</span>', "{total === 0 ? '—' : pct + '%'} </span>");
  const systemStart = quiz.indexOf('      // 1. Grade choice questions');
  const systemEnd = quiz.indexOf('      if (!attemptId)',systemStart);
  if(systemStart<0||systemEnd<0)throw new Error('Quiz system grading anchor changed');
  quiz = quiz.slice(0,systemStart) + `      const ordered = questions.map(question => gradeSystemQuestion(question, answers[question.id]));\n      if (cancelled) return;\n      recordStudyQuiz(sceneId, questions, ordered, answers);\n\n` + quiz.slice(systemEnd);
  quiz = quiz.replace("{t('quiz.aiGrading')}", "系統正在批改").replace("{t('quiz.aiGradingWait')}", "依據預先生成的答案檢核，不會呼叫 AI");
  quiz = quiz.replace('total={totalPoints} results={results}', "total={questions.filter(q => resultMap[q.id]?.correct !== null).reduce((sum,q) => sum + (q.points ?? 1),0)} results={results}");
  const mainReturn = '  return (\n    <div className="w-full h-full bg-gradient-to-b';
  quiz = quiz.replace(mainReturn, `  return (\n    <StudyQuizReviewProvider key={sceneId + ':' + phase} sceneId={sceneId} answers={answers} onReview={async result => {\n      if (!attemptId) throw new Error('作答尚未儲存');\n      const token = viewLifetime.capture();\n      const updated = results.map(previous => previous.questionId === result.questionId ? result : previous);\n      await persistQuizReview({stageId,sceneId,attemptId,answers,results:updated},runtimeWriter);\n      if (viewLifetime.isCurrent(token)) setResults(updated);\n    }}>\n    <div className="w-full h-full bg-gradient-to-b`);
  const close = quiz.lastIndexOf('    </div>\n  );');
  if(close<0)throw new Error('Quiz provider anchor changed');
  quiz = quiz.slice(0,close)+quiz.slice(close).replace('    </div>\n  );','    </div>\n    </StudyQuizReviewProvider>\n  );');
  await writeFile(quizPath,quiz);
  await replace('components/scene-renderers/quiz-view.tsx', "'px-4 py-1.5 rounded-lg text-xs font-medium transition-all'", "'study-quiz-submit px-4 py-1.5 rounded-lg text-xs font-medium transition-all'");
  await replace('components/scene-renderers/quiz-view.tsx', 'className="flex items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400 hover:text-violet-600', 'className="study-quiz-retry flex items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400 hover:text-violet-600');
  await replace('components/scene-renderers/quiz-view.tsx', '              disabled={disabled}\n              onClick={() => !disabled && onChange(opt.value)}', '              disabled={disabled}\n              aria-pressed={selected}\n              onClick={() => !disabled && onChange(opt.value)}');
  await replace('components/scene-renderers/quiz-view.tsx', '              disabled={disabled}\n              onClick={() => toggle(opt.value)}', '              disabled={disabled}\n              aria-pressed={isSelected}\n              onClick={() => toggle(opt.value)}');

  await replace('components/classroom/ClassroomSurface.tsx', "import { useI18n }", "import { StudyClassroomLoading } from '@/components/study/StudyClassroomLoading';\nimport { useI18n }");
  await replace('components/classroom/ClassroomSurface.tsx', `<div className="flex-1 flex items-center justify-center bg-gray-50 dark:bg-gray-900">
              <div className="flex flex-col items-center gap-3 text-muted-foreground">
                <Loader2 className="h-8 w-8 animate-spin" />
                <p>{t('common.loadingClassroom')}</p>
              </div>
            </div>`, '<StudyClassroomLoading ready={loadedClassroomId === classroomId} onRetry={retryClassroom} />');

  await replace('components/edit/PlaybackChromeRoot.tsx', "import { StudyLessonDock }", "import { useStudyLiveAi } from '@/lib/study-classroom/live-ai';\nimport { StudyLessonDock }");
  await replace('components/edit/PlaybackChromeRoot.tsx', "import { StudyLessonDock }", "import { StudyDiscussionLog } from '@/components/study/StudyDiscussionLog';\nimport { setStudyDiscussionMinimized, useStudyDiscussion } from '@/lib/study-classroom/discussion';\nimport { StudyLessonDock }");
  await replace('components/edit/PlaybackChromeRoot.tsx', '    const [showStudyDiscussion, setShowStudyDiscussion]', '    const liveAi = useStudyLiveAi();\n    const studyDiscussion = useStudyDiscussion();\n    const [showStudyDiscussion, setShowStudyDiscussion]');
  await replace('components/edit/PlaybackChromeRoot.tsx', "{mode === 'playback' && (showStudyDiscussion ||", "{mode === 'playback' && liveAi.available && (showStudyDiscussion ||");
  await replace('components/edit/PlaybackChromeRoot.tsx', '    /** Full scene reset (scene switch)', `    useEffect(() => {
      if (liveAi.checking || liveAi.available) return;
      setShowStudyDiscussion(false);
      if (discussionTrigger) engineRef.current?.skipDiscussion();
      if (chatSessionType === 'qa' || chatSessionType === 'discussion') {
        void chatAreaRef.current?.stopActiveSession();
        engineRef.current?.handleDiscussionError();
        resetLiveState();
      }
    }, [liveAi.available, liveAi.checking, discussionTrigger, chatSessionType, resetLiveState]);

    /** Full scene reset (scene switch)`);
  await replace('components/chat/use-chat-sessions.ts', "import { useStageStore }", "import { requireStudyLiveAi } from '@/lib/study-classroom/live-ai';\nimport { recordStudyAsk } from '@/lib/study-classroom/adaptive';\nimport { useStageStore }");
  await replace('components/chat/use-chat-sessions.ts', "  const response = await fetch('/api/chat/pi',", "  await requireStudyLiveAi();\n  if ((requestTemplate as { messages?: { role?: string }[] }).messages?.at(-1)?.role === 'user') recordStudyAsk();\n  const response = await fetch('/api/chat/pi',");
  await replace('components/chat/use-chat-sessions.ts', '    throw new Error(`Pi chat request failed: ${response.status}`);', "    throw new Error(typeof errorBody?.error === 'string' ? errorBody.error : errorBody?.error?.message ?? `Pi chat request failed: ${response.status}`);");
  await replace('components/chat/chat-session.tsx', "import { useI18n }", "import { useStudyLiveAi } from '@/lib/study-classroom/live-ai';\nimport { useI18n }");
  await replace('components/chat/chat-session.tsx', '  const userProfileAvatar =', '  const liveAi = useStudyLiveAi();\n  const userProfileAvatar =');
  await replace('components/chat/chat-session.tsx', '                onClick={() => onContinueSession(session.id)}', '                disabled={!liveAi.available}\n                title={liveAi.reason ?? undefined}\n                onClick={() => { if (liveAi.available) onContinueSession(session.id); }}');
  await replace('components/scene-renderers/pbl-renderer.tsx', "import { useI18n }", "import { useStudyLiveAi } from '@/lib/study-classroom/live-ai';\nimport { useI18n }");
  await replace('components/scene-renderers/pbl-renderer.tsx', '  const { t } = useI18n();', '  const { t } = useI18n();\n  const liveAi = useStudyLiveAi();');
  await replace('components/scene-renderers/pbl-renderer.tsx', '  if (resolvedProjectV2) {', `  if (resolvedProjectV2 && !liveAi.available) return (
    <section className="h-full overflow-y-auto p-6 space-y-4" aria-label="專題教材">
      <h2 className="text-xl font-semibold">{resolvedProjectV2.title}</h2>
      <p className="text-sm whitespace-pre-wrap">{resolvedProjectV2.description}</p>
      <p role="status" className="text-sm text-gray-500">{liveAi.reason}</p>
      <button type="button" disabled className="min-h-11 rounded-lg border px-4 text-sm opacity-50">AI 專題討論已停用</button>
      <ol className="space-y-3">{resolvedProjectV2.milestones.map(milestone => <li key={milestone.id} className="rounded-lg border p-4"><h3 className="font-medium">{milestone.title}</h3><p className="text-sm text-gray-500 whitespace-pre-wrap">{milestone.description}</p></li>)}</ol>
    </section>
  );
  if (resolvedProjectV2) {`);

  await replace('components/edit/PlaybackChromeRoot.tsx', '      canPickSlideElement || canPickInteractiveComponent || canPickWhiteboardElement;', '      liveAi.available && (canPickSlideElement || canPickInteractiveComponent || canPickWhiteboardElement);');

  // Learner-only classroom: no editing, no header (settings, export, language, theme, Pro switch), and no
  // voice, speed or auto-play controls, which do nothing in learner-paced text lessons.
  await replace('components/stage.tsx', 'const canEditOwnedStage = isOwner && !readOnly;', 'const canEditOwnedStage = false && isOwner && !readOnly; // STUDY classrooms are for learning, not editing.');
  await replace('components/stage.tsx', 'hideHeader={!classroomHeaderControls.showHeader}', 'hideHeader');
  await replace('components/roundtable/index.tsx', '      onToggleMute={() => ttsEnabled && setTTSMuted(!ttsMuted)}\n', '');
  await replace('components/roundtable/index.tsx', '      onToggleAutoPlay={() => setAutoPlayLecture(!autoPlayLecture)}\n', '');
  await replace('components/roundtable/index.tsx', '      onCycleSpeed={handleCycleSpeed}\n', '');

  // Quizzes: a system-level "I don't know" for pretests and checkpoints, and results shown at once.
  const quizFile = 'components/scene-renderers/quiz-view.tsx';
  await replace(quizFile, "export function QuizView({ questions, sceneId, stageId }: QuizViewProps) {\n  const { t, locale } = useI18n();", "export function QuizView({ questions, sceneId, stageId }: QuizViewProps) {\n  const { t, locale } = useI18n();\n  // Pretest and checkpoint choice questions also offer \"I don't know\"; grading keeps using the original questions.\n  const studyShown = studyQuestionsFor(sceneId, questions);");
  let shown = await readFile(path.join(core, quizFile), 'utf8');
  if ((shown.match(/\{questions\.map\(\(q, i\) => \{/g) ?? []).length !== 2) throw new Error('Quiz question loops changed');
  shown = shown.replaceAll('{questions.map((q, i) => {', '{studyShown.map((q, i) => {');
  await writeFile(path.join(core, quizFile), shown);
  await replace(quizFile, "const isWrong = isReview && selected && result?.status === 'incorrect';", "const isWrong = isReview && selected && result?.status === 'incorrect' && opt.value !== STUDY_UNSURE;");
  await replace(quizFile, 'const isWrong = isReview && isSelected && !isCorrectOpt;', 'const isWrong = isReview && isSelected && !isCorrectOpt && opt.value !== STUDY_UNSURE;');
  await replace(quizFile, "    if (selected.includes(optValue)) {\n      onChange(selected.filter((v) => v !== optValue));\n    } else {\n      onChange([...selected, optValue]);\n    }", '    onChange(toggleChoice(selected, optValue));');
  await replace(quizFile, '  const [retrying, setRetrying] = useState(false);', `  const [retrying, setRetrying] = useState(false);
  // Hydrated reviews finish the scene too; retakes clear it without replaying any learner signals.
  useEffect(() => { setStudyQuizGraded(sceneId, phase === 'reviewing' && !retrying); }, [sceneId, phase, retrying]);
  // Saving runs behind the result; a retry waits for it so the attempt is stored before it is reset.
  const savingRef = useRef<Promise<unknown>>(Promise.resolve());`);
  await replace(quizFile, "    if (!attemptId) return;\n    setPhase('submitting');\n    await runQuizPersistenceTransition(\n      () => persistQuizSubmission({ stageId, sceneId, attemptId, answers }, runtimeWriter),\n      viewLifetime,\n      () => setPhase('grading'),\n      (error) => {\n        log.warn('Failed to persist quiz submission:', error);\n        setRuntimeGate({ status: 'error' });\n      },\n    );\n  }, [attemptId, answers, runtimeWriter, sceneId, stageId, viewLifetime]);", "    if (!attemptId) return;\n    // Grading is instant, saving is not: show the result now and save behind it.\n    const ordered = questions.map(question => gradeSystemQuestion(question, answers[question.id]));\n    setResults(ordered);\n    setPhase('reviewing');\n    recordStudyQuiz(sceneId, questions, ordered, answers);\n    const save = async () => {\n      await persistQuizSubmission({ stageId, sceneId, attemptId, answers }, runtimeWriter);\n      await persistQuizReview({ stageId, sceneId, attemptId, answers, results: ordered }, runtimeWriter);\n    };\n    savingRef.current = save().catch(async (error) => {\n      log.warn('Failed to save the quiz result, retrying once:', error);\n      await new Promise((resolve) => setTimeout(resolve, 1500));\n      await save();\n    }).catch((error) => log.warn('The quiz result is shown but could not be saved:', error));\n  }, [attemptId, answers, questions, runtimeWriter, sceneId, stageId]);");
  await replace(quizFile, '    if (!attemptId || retrying) return;\n    setRetrying(true);', '    if (!attemptId || retrying) return;\n    setRetrying(true);\n    await savingRef.current.catch(() => undefined);');

  await replace(quizFile, "  persistQuizRetry,\n", '');
  await replace(quizFile, "    runtimeWriter.cancelDraft();\n    await runQuizPersistenceTransition(\n      () => persistQuizRetry({ stageId, sceneId, attemptId }, runtimeWriter),\n      viewLifetime,\n      () => {\n        setPhase('not_started');\n        setAnswers({});\n        setResults([]);", "    runtimeWriter.cancelDraft();\n    let retried: Awaited<ReturnType<typeof retryStudyQuiz>>;\n    await runQuizPersistenceTransition(\n      async () => { retried = await retryStudyQuiz({ stageId, sceneId, attemptId }, runtimeWriter); },\n      viewLifetime,\n      () => {\n        const next = quizViewStateFromAttempt(retried.state);\n        setRuntimeGate({ status: 'ready', attemptId: retried.attemptId });\n        setPhase(next.phase);\n        setAnswers(next.answers);\n        setResults(next.results);");

  // Quizzes open from a warmed state read when the previous scenes had time to start it (see StudyScenePrefetch).
  await replace(quizFile, "import {\n  createQuizAttemptWriter,\n  loadQuizAttemptState,\n", "import { retryStudyQuiz } from '@/lib/study-classroom/quiz-retry';\nimport { loadStudyQuizAttempt } from '@/lib/study-classroom/quiz-warm';\nimport {\n  createQuizAttemptWriter,\n");
  await replace(quizFile, '    void loadQuizAttemptState({ stageId, sceneId })', '    void loadStudyQuizAttempt({ stageId, sceneId })');

  // Phone: the ask-and-discuss panel is a bottom sheet with a grabber and a close button instead of a 192px strip.
  await replace('components/edit/PlaybackChromeRoot.tsx', "                'transition-opacity duration-300',\n                !isPresenting && 'shrink-0',\n                isPresenting && 'absolute inset-x-0 bottom-0 z-20',\n              )}\n            >\n              <Roundtable", "                'transition-opacity duration-300 study-discussion',\n                studyDiscussion.minimized && 'study-discussion-min',\n                !isPresenting && 'shrink-0',\n                isPresenting && 'absolute inset-x-0 bottom-0 z-20',\n              )}\n              onClick={(event) => { if (event.target === event.currentTarget) { if (engineMode === 'live' || !!discussionTrigger || chatSessionType === 'qa' || chatSessionType === 'discussion') setStudyDiscussionMinimized(true); else setShowStudyDiscussion(false); } }}\n            >\n              <div className=\"study-discussion-bar\"><span className=\"study-discussion-grabber\" aria-hidden=\"true\" /><span className=\"study-discussion-title\">提問與討論</span>{(engineMode === 'live' || !!discussionTrigger || chatSessionType === 'qa' || chatSessionType === 'discussion') && <span className=\"study-discussion-live\" data-streaming={chatIsStreaming ? 'true' : undefined} role=\"status\"><i />{chatIsStreaming ? '發言中' : '輪到你'}</span>}<button type=\"button\" onClick={() => { if (engineMode === 'live' || !!discussionTrigger || chatSessionType === 'qa' || chatSessionType === 'discussion') setStudyDiscussionMinimized(true); else setShowStudyDiscussion(false); }} aria-label={(engineMode === 'live' || !!discussionTrigger || chatSessionType === 'qa' || chatSessionType === 'discussion') ? '先看課程，討論會保留，隨時可以回來' : '收起提問與討論'}>{(engineMode === 'live' || !!discussionTrigger || chatSessionType === 'qa' || chatSessionType === 'discussion') ? '先看課程' : '收起'}</button></div>\n              <StudyDiscussionLog live={engineMode === 'live' || !!discussionTrigger || chatSessionType === 'qa' || chatSessionType === 'discussion'} streaming={chatIsStreaming} />\n              <Roundtable");

  // Phone ask-and-discuss: the avatar column that toggles the text box is hidden in the sheet, so the box stays open,
  // the answer is no longer dimmed or squeezed into 110px, and the sheet rides above the on-screen keyboard.
  const roundtable = 'components/roundtable/index.tsx';
  await replace(roundtable, "import { useAgentRegistry } from '@/lib/orchestration/registry/store';", "import { useStudyKeyboardInset, useStudyPhone } from '@/lib/study-classroom/phone';\nimport { useAgentRegistry } from '@/lib/orchestration/registry/store';");
  await replace(roundtable, '  const [isVoiceOpen, setIsVoiceOpen] = useState(false);', `  const [isVoiceOpen, setIsVoiceOpen] = useState(false);
  const studyPhone = useStudyPhone();
  useStudyKeyboardInset(studyPhone);
  useEffect(() => {
    if (studyPhone && !isInputOpen && !isVoiceOpen) setIsInputOpen(true);
  }, [studyPhone, isInputOpen, isVoiceOpen]);`);
  await replace(roundtable, "                    opacity: isInputOpen || isVoiceOpen ? 0.4 : 1,\n                    y: 0,\n                    filter: isInputOpen || isVoiceOpen ? 'blur(1px) grayscale(0.2)' : 'none',", "                    opacity: (isInputOpen || isVoiceOpen) && !studyPhone ? 0.4 : 1,\n                    y: 0,\n                    filter: (isInputOpen || isVoiceOpen) && !studyPhone ? 'blur(1px) grayscale(0.2)' : 'none',");
  await replace(roundtable, '    hasQuickReplies && !!isCueUser && !bubbleRole && !thinkingState && !isInputOpen && !isVoiceOpen;', '    hasQuickReplies && !!isCueUser && !bubbleRole && !thinkingState && (studyPhone || !isInputOpen) && !isVoiceOpen;');
  // The teacher pointed at something in an interactive module: the dock repeats it in words until the learner operates it.
  await replace('components/scene-renderers/InteractiveIframeHost.tsx', "import { useI18n }", "import { setStudyOperate } from '@/lib/study-classroom/operate';\nimport { useI18n }");
  await replace('components/scene-renderers/InteractiveIframeHost.tsx', "      iframeRef.current?.contentWindow?.postMessage({ type, ...payload }, '*');\n    };\n    return registerIframe(", "      if (type === 'HIGHLIGHT_ELEMENT' || type === 'ANNOTATE_ELEMENT') setStudyOperate(payload.content);\n      iframeRef.current?.contentWindow?.postMessage({ type, ...payload }, '*');\n    };\n    return registerIframe(");
  // Learner-paced narration: spotlight and laser stay up while the learner reads and scrolls to them (a phone needs more than the default five seconds).
  await replace('lib/action/engine.ts', '    }, EFFECT_AUTO_CLEAR_MS);', '    }, Math.max(EFFECT_AUTO_CLEAR_MS, 10 * 60 * 1000));');
  // Writing on a page: desktop slides get the pen layer from the scene wrapper, interactive modules from their frame host, phone slides from the reader.
  await replace('components/stage/scene-renderer.tsx', "import { PBLRenderer } from '../scene-renderers/pbl-renderer';", "import { PBLRenderer } from '../scene-renderers/pbl-renderer';\nimport { StudyInkCanvas } from '@/components/study/StudyInk';");
  await replace('components/stage/scene-renderer.tsx', '  return <div className="w-full h-full">{renderer}</div>;', "  return <div className=\"relative w-full h-full\">{renderer}{scene.type === 'slide' && !phone && <StudyInkCanvas sceneId={scene.id} />}</div>;");
  await replace('components/scene-renderers/InteractiveIframeHost.tsx', "import { useI18n }", "import { StudyInkCanvas } from '@/components/study/StudyInk';\nimport { useI18n }");
  await replace('components/scene-renderers/InteractiveIframeHost.tsx', '      {showRuntimeError && latestRuntimeError ? (', '      <StudyInkCanvas sceneId={sceneId} />\n      {showRuntimeError && latestRuntimeError ? (');
  // The interactive panel is locked until the dialogue tells the learner to operate it; the lock covers the frame and makes it inert.
  await replace('components/scene-renderers/InteractiveIframeHost.tsx', "import { useI18n }", "import { StudyPanelLock } from '@/components/study/StudyPanelLock';\nimport { useStudyPanelLock } from '@/lib/study-classroom/lock';\nimport { useI18n }");
  await replace('components/scene-renderers/InteractiveIframeHost.tsx', '  const iframeRef = useRef<HTMLIFrameElement>(null);\n  const mediaSession', '  const iframeRef = useRef<HTMLIFrameElement>(null);\n  const studyLock = useStudyPanelLock(sceneId);\n  const mediaSession');
  await replace('components/scene-renderers/InteractiveIframeHost.tsx', '        ref={iframeRef}\n        srcDoc={observation.html}', '        ref={iframeRef}\n        inert={studyLock ? true : undefined}\n        srcDoc={observation.html}');
  await replace('components/scene-renderers/InteractiveIframeHost.tsx', '      {showRuntimeError && latestRuntimeError ? (', '      <StudyPanelLock sceneId={sceneId} />\n      {showRuntimeError && latestRuntimeError ? (');
  // Ask and discuss is for questions and classmates only: the lecture sentence already lives in the dock, so the panel never repeats it.
  await replace(roundtable, "  const sourceText = userMessage\n    ? userMessage\n    : (playbackView?.sourceText ??", "  const studyLectureOnly = !isInLiveFlow && !userMessage && !currentSpeech;\n  const sourceText = userMessage\n    ? userMessage\n    : studyLectureOnly ? '' : (playbackView?.sourceText ??");
  await replace(roundtable, "  const bubbleRole: 'teacher' | 'user' | 'agent' | null = userMessage\n    ? 'user'\n    : (playbackView?.bubbleRole ??", "  const bubbleRole: 'teacher' | 'user' | 'agent' | null = userMessage\n    ? 'user'\n    : studyLectureOnly ? null : (playbackView?.bubbleRole ??");
  const roundtableSource = await readFile(path.join(core, roundtable), 'utf8');
  if ((roundtableSource.match(/autoFocus\n\s+rows=\{1\}/g) ?? []).length !== 2) throw new Error('Roundtable input focus changed');
  await writeFile(path.join(core, roundtable), roundtableSource.replace(/autoFocus(\n\s+rows=\{1\})/g, 'autoFocus={!studyPhone}$1'));

  // Phones get a reflowed reader instead of a shrunken 1000px slide canvas.
  await replace('components/stage/scene-renderer.tsx', "import { PBLRenderer } from '../scene-renderers/pbl-renderer';", "import { PBLRenderer } from '../scene-renderers/pbl-renderer';\nimport { StudySlideReader } from '@/components/study/StudySlideReader';\nimport { useMobileLayout } from '@/lib/adaptive/adaptive-provider';");
  await replace('components/stage/scene-renderer.tsx', 'export function SceneRenderer({ scene, mode }: SceneRendererProps) {\n  const renderer = useMemo(() => {', 'export function SceneRenderer({ scene, mode }: SceneRendererProps) {\n  const phone = useMobileLayout();\n  const renderer = useMemo(() => {');
  await replace('components/stage/scene-renderer.tsx', '        return <SlideRenderer mode={mode} />;', '        return phone ? <StudySlideReader slide={scene.content.canvas} /> : <SlideRenderer mode={mode} />;');
  await replace('components/stage/scene-renderer.tsx', '  }, [scene, mode]);', '  }, [scene, mode, phone]);');

  // Module kit: pre-designed components injected into kit-based interactive pages, and the guide the chatbot reads.
  await replace('lib/utils/iframe.ts', 'export function patchHtmlForIframe(', "import { hasStudyKit, studyKitHead } from '@/lib/study-classroom/module-kit';\nexport function patchHtmlForIframe(");
  await replace('lib/utils/iframe.ts', "    (options?.mediaId ? mediaBridgeScript(options.mediaId) : '') +", "    (hasStudyKit(html) ? studyKitHead(html) : '') +\n    '\\n' +\n    (options?.mediaId ? mediaBridgeScript(options.mediaId) : '') +");
  const { MODULE_KIT_PROMPT } = await import(pathToFileURL(path.resolve(import.meta.dirname, '../../../src/shared/module-kit-guide.ts')).href);
  // Slides teach and never ask: the outline and slide prompts carry the rule that questions live in 先測, 檢核 or a module.
  const { SLIDE_QUESTION_RULE, PRETEST_RULES, TEACH_FIRST_RULE } = await import(pathToFileURL(path.resolve(import.meta.dirname, '../../../src/shared/module-kit-guide.ts')).href);
  for (const template of ['requirements-to-outlines', 'slide-content', 'slide-actions']) {
    const target = path.join(core, 'packages/@openmaic/generation/templates', template, 'system.md');
    const source = await readFile(target, 'utf8');
    if (source.includes('STUDY 題目位置規則')) throw new Error(`Template already patched: ${template}`);
    // The outline and the slides also carry the order rule (explain first) and, for the outline, how pretests are built.
    await writeFile(target, source.trimEnd() + '\n\n' + SLIDE_QUESTION_RULE + '\n\n' + TEACH_FIRST_RULE + (template === 'requirements-to-outlines' ? '\n\n' + PRETEST_RULES : '') + '\n');
  }
  // Quiz scenes (先測 and 檢核) are generated from this template.
  for (const template of ['quiz-content']) {
    const target = path.join(core, 'packages/@openmaic/generation/templates', template, 'system.md');
    const source = await readFile(target, 'utf8');
    if (source.includes('STUDY 前測規則')) throw new Error(`Template already patched: ${template}`);
    await writeFile(target, source.trimEnd() + '\n\n' + PRETEST_RULES + '\n\n' + TEACH_FIRST_RULE + '\n');
  }
  for (const template of ['simulation-content', 'diagram-content', 'game-content', 'visualization3d-content']) {
    const target = path.join(core, 'packages/@openmaic/generation/templates', template, 'system.md');
    const source = await readFile(target, 'utf8');
    if (source.includes('STUDY 模組元件庫')) throw new Error(`Template already patched: ${template}`);
    await writeFile(target, source.trimEnd() + '\n\n' + MODULE_KIT_PROMPT + '\n');
  }

}
