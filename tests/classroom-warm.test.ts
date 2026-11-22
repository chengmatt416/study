import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { collectImageUrls, createWarmCache } from '../integrations/openmaic/cloudflare/overlay/lib/study-classroom/warm';

const root = join(__dirname, '..');
const patch = readFileSync(join(root, 'integrations/openmaic/cloudflare/patch-classroom.mjs'), 'utf8');
const prefetch = readFileSync(join(root, 'integrations/openmaic/cloudflare/overlay/components/study/StudyScenePrefetch.tsx'), 'utf8');
const vite = readFileSync(join(root, 'vite.config.ts'), 'utf8');

describe('warm cache', () => {
  it('starts a load once, hands it over once, and forgets it after the ttl', async () => {
    let time = 0;
    const cache = createWarmCache<string>(1000, () => time);
    const load = vi.fn(async () => 'state');
    cache.warm('quiz', load); cache.warm('quiz', load);
    expect(load).toHaveBeenCalledOnce();
    await expect(cache.take('quiz')).resolves.toBe('state');
    expect(cache.take('quiz')).toBeUndefined();
    cache.warm('old', async () => 'stale'); time = 1001;
    expect(cache.take('old')).toBeUndefined();
  });

  it('drops a failed warm load so the real read retries instead of reusing the failure', async () => {
    const cache = createWarmCache<string>();
    cache.warm('quiz', async () => { throw new Error('offline'); });
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(cache.size).toBe(0);
    expect(cache.take('quiz')).toBeUndefined();
  });

  it('prunes expired entries when something else warms', () => {
    let time = 0;
    const cache = createWarmCache<string>(1000, () => time);
    cache.warm('a', async () => 'a'); time = 2000; cache.warm('b', async () => 'b');
    expect(cache.size).toBe(1);
  });
});

describe('quiz image discovery', () => {
  it('finds Markdown and HTML images anywhere in a question, skipping inline data and duplicates', () => {
    const questions = [{ question: 'Which? ![graph](/api/classroom-media/c1/media/a.png "t")', options: [{ label: '<img class="x" src=\'/api/classroom-media/c1/media/b.webp\'>', value: 'A' }, { label: '![](data:image/png;base64,AAAA)', value: 'B' }], analysis: '![](/api/classroom-media/c1/media/a.png)' }];
    expect(collectImageUrls(questions)).toEqual(['/api/classroom-media/c1/media/a.png', '/api/classroom-media/c1/media/b.webp']);
  });
  it('is bounded and ignores non-text values', () => {
    const many = Array.from({ length: 50 }, (_, i) => `![](/m/${i}.png)`);
    expect(collectImageUrls(many, 10)).toHaveLength(10);
    expect(collectImageUrls({ n: 3, ok: true, none: null })).toEqual([]);
  });
});

describe('quiz loading wiring', () => {
  it('opens quizzes from a warmed state read and warms the next three quiz scenes', () => {
    for (const part of ["import { loadStudyQuizAttempt } from '@/lib/study-classroom/quiz-warm'", "void loadStudyQuizAttempt({ stageId, sceneId })"]) expect(patch).toContain(part);
    expect(patch).not.toContain('  loadQuizAttemptState,\\n");');
    expect(prefetch).toContain('scenes.slice(index + 1, index + 4)');
    expect(prefetch).toMatch(/warmQuizAttempt\(\{ stageId, sceneId \}\);\s*warmQuizImages\(questions\);/);
  });
  it('keeps lesson images in a stale-while-revalidate service worker cache ahead of the API catch-all', () => {
    const images = vite.indexOf('cacheName: "classroom-media"'), catchAll = vite.indexOf('url.pathname.startsWith("/api/"),');
    expect(images).toBeGreaterThan(0);
    expect(images).toBeLessThan(catchAll);
    expect(vite).toContain('handler: "StaleWhileRevalidate"');
  });
});
