import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { LIVE_AI_ENDPOINT, LIVE_AI_MIN_OUTPUT_TOKENS, LIVE_AI_PURPOSES, LIVE_AI_SYSTEM_PROMPT, LIVE_AI_TIMEOUT_MS, isLiveAiPurpose } from '../src/shared/ai-boundary';
import { signLiveAiGrant, verifyLiveAiGrant } from '../src/shared/live-ai-transport';

const root = join(__dirname, '..', 'src');
function sources(dir: string): string[] {
  return readdirSync(dir).flatMap(name => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? sources(path) : /\.tsx?$/.test(name) ? [path] : [];
  });
}
const files = sources(root).map(path => ({ path: relative(root, path), text: readFileSync(path, 'utf8') }));
const matching = (pattern: RegExp, only?: (path: string) => boolean) => files.filter(file => (!only || only(file.path)) && pattern.test(file.text)).map(file => file.path);

describe('MCP generation vs OpenRouter interaction boundary', () => {
  it('limits live AI to classroom, practice explanation and exam grading', () => {
    expect([...LIVE_AI_PURPOSES]).toEqual(['interaction', 'regrade', 'route', 'coach', 'practice_explain', 'exam_grade']);
    for (const purpose of ['generate', 'exam', 'note', 'cards', 'outline', '']) expect(isLiveAiPurpose(purpose)).toBe(false);
  });

  it('rejects signed grants for any other purpose', async () => {
    const secret = 'boundary-'.repeat(8);
    const grant = { sub: 'study:u', turn: crypto.randomUUID(), classroom: 'class', exp: Date.now() + 10000 };
    expect(await verifyLiveAiGrant(await signLiveAiGrant({ ...grant, purpose: 'interaction' }, secret), secret)).not.toBeNull();
    expect(await verifyLiveAiGrant(await signLiveAiGrant({ ...grant, purpose: 'exam_grade' }, secret), secret)).not.toBeNull();
    expect(await verifyLiveAiGrant(await signLiveAiGrant({ ...grant, purpose: 'exam' as never }, secret), secret)).toBeNull();
  });

  it('calls OpenRouter from exactly one place', () => {
    expect(LIVE_AI_ENDPOINT).toBe('https://openrouter.ai/api/v1/chat/completions');
    expect(matching(/LIVE_AI_ENDPOINT|openrouter\.ai\/api/).sort()).toEqual([
      'shared/ai-boundary.ts',
      'worker/lib/live-ai/service.ts',
    ]);
  });

  it('keeps the MCP side free of OpenRouter and live AI code', () => {
    expect(matching(/openrouter|live-ai|ai-boundary/i, path => path.startsWith('worker/mcp/'))).toEqual([]);
    expect(matching(/openrouter|live-ai|ai-boundary/i, path => /(^|\/)(ib-resources|book-upload)\.ts$/.test(path) || path.startsWith('web/features/ib-resources/'))).toEqual([]);
  });

  it('keeps IB reference documents and book PDFs out of the live AI path', () => {
    const live = (path: string) => path.startsWith('worker/lib/live-ai/') || path === 'worker/routes/live-ai.ts' || path === 'shared/live-ai-transport.ts' || path === 'shared/live-classroom.ts';
    expect(matching(/ib-resources|book-pdf|mcp\/|routes\/books|\bbooks\b.*FROM|FROM\s+books/i, live)).toEqual([]);
  });

  it('keeps the module kit free of model and network access', () => {
    expect(matching(/openrouter|live-ai|fetch\(/i, path => /^shared\/module-kit(-guide)?\.ts$/.test(path))).toEqual([]);
  });

  it('keeps the adaptive rule router pure, with no model or storage dependency', () => {
    expect(matching(/openrouter|fetch\(|from '\.\.\/worker|hono|D1Database|env\.DB/i, path => path === 'shared/adaptive-learning.ts')).toEqual([]);
  });

  it('never limits a live answer below 4096 tokens', () => {
    expect(LIVE_AI_MIN_OUTPUT_TOKENS).toBe(4096);
    expect(LIVE_AI_TIMEOUT_MS).toBeGreaterThanOrEqual(90000);
  });

  it('tells the live model not to generate content or cite IB documents', () => {
    expect(LIVE_AI_SYSTEM_PROMPT).toMatch(/mock exam/);
    expect(LIVE_AI_SYSTEM_PROMPT).toMatch(/IB reference documents/);
  });
});
