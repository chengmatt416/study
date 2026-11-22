import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const root = 'integrations/openmaic/cloudflare/';
const read = (file: string) => readFileSync(root + file, 'utf8');
const patch = read('patch-classroom.mjs');
const dock = read('overlay/components/study/StudyLessonDock.tsx');
const css = read('overlay/components/study/classroom.css');
const log = read('overlay/components/study/StudyDiscussionLog.tsx');
const store = read('overlay/lib/study-classroom/discussion.ts');

describe('phone 提問與討論 shows the whole conversation', () => {
  it('mounts a scrollable transcript of this scene’s questions and discussions inside the sheet', () => {
    expect(patch).toContain('<StudyDiscussionLog live=');
    expect(log).toContain('role="log"');
    expect(log).toContain('aria-live="polite"');
    expect(store).toContain("chat.type === 'qa' || chat.type === 'discussion'");
    expect(css).toMatch(/\.study-discussion-log \{ position: absolute; inset: 0; overflow-y: auto;/);
  });

  it('follows new messages only while the learner is at the bottom, and offers a way down when they have scrolled up', () => {
    expect(log).toContain('stuck.current');
    expect(log).toContain('新訊息');
    expect(css).toContain('.study-log-down');
  });

  it('moves the latest bubble into the transcript so it is not shown twice, keeping quick replies and the text box', () => {
    expect(css).toMatch(/\.study-discussion \.group\\\/bubble \{ display: none !important; \}/);
    expect(css).toContain('cue-user-suggested-bubble');
    expect(css).toContain('roundtable-non-presentation-input-stage');
  });
});

describe('the learner can step away from a discussion and come back at any time', () => {
  it('always has a way to hide the sheet, even while the discussion is live, and the session is left alone', () => {
    // It used to be offered only when no discussion was running.
    expect(patch).not.toContain("{engineMode !== 'live' && !discussionTrigger && <button");
    expect(patch).toContain('先看課程');
    expect(patch).toContain('setStudyDiscussionMinimized(true)');
    expect(patch).toContain("studyDiscussion.minimized && 'study-discussion-min'");
    expect(css).toMatch(/\.study-discussion\.study-discussion-min \{ display: none; \}/);
    expect(patch).not.toMatch(/setStudyDiscussionMinimized\(true\)[^;]*stopActiveSession/);
  });

  it('tapping the dimmed area hides the sheet too', () => {
    expect(patch).toContain('event.target === event.currentTarget');
  });

  it('offers three ways back: a floating pill with a count of new messages, the main button, and the 提問與討論 button', () => {
    expect(dock).toContain('study-discussion-pill');
    expect(dock).toContain('回到討論');
    expect(dock).toContain('discussionUnread');
    expect(dock).toContain('resumeDiscussion ? onResumeDiscussion : onContinue');
    expect(patch).toContain('onResumeDiscussion={() => { setShowStudyDiscussion(true); setStudyDiscussionMinimized(false); }}');
    expect(patch).toContain('if (studyDiscussion.minimized) setStudyDiscussionMinimized(false)');
    expect(css).toMatch(/\.study-discussion-pill \{ position: absolute;/);
  });

  it('starting a new discussion always brings the sheet back, and the live state is shown in the header', () => {
    expect(patch).toContain('setStudyDiscussionMinimized(false); setShowStudyDiscussion(true); handleDiscussionSSE(');
    expect(patch).toContain('study-discussion-live');
    expect(patch).toContain("chatIsStreaming ? '發言中' : '輪到你'");
  });

  it('counts only messages that arrived while the learner was away', () => {
    expect(store).toContain('Math.max(0, total - read)');
    expect(store).toContain('seen = totalNow');
  });
});
