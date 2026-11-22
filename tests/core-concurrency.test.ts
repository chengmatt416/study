import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// A learner can have ten courses compiling at once: the Core's per-owner active-run limit (default 2) is the one that stops an eleventh and a third.
describe('Core run limits', () => {
  const vars = JSON.parse(readFileSync(new URL('../integrations/openmaic/cloudflare/wrangler.core.jsonc', import.meta.url), 'utf8')).vars as Record<string, string>;
  it('allows ten active generation runs per learner and queues more behind them', () => {
    expect(Number(vars.OPENMAIC_MAX_ACTIVE_RUNS_PER_OWNER)).toBeGreaterThanOrEqual(10);
    expect(Number(vars.OPENMAIC_GENERATION_RUN_MAX_CONCURRENT)).toBeGreaterThanOrEqual(10);
    expect(Number(vars.OPENMAIC_MAX_WAITING_RUNS_PER_OWNER)).toBeGreaterThanOrEqual(10);
  });
});
