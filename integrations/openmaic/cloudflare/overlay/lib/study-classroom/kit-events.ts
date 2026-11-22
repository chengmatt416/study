// Turns events reported by the module kit (src/shared/module-kit.ts) into routing signals. Pure and strict:
// the events come from generated pages, so only known shapes and short ids are accepted.
export interface KitSignal { concept: string; kind: 'question' | 'hint' | 'retry' | 'step' | 'module'; correct?: boolean | null; misconception?: string | null; value?: number | null; ops?: number | null }
const ID = /^[A-Za-z0-9_.:-]{1,64}$/;
const id = (value: unknown): string | null => (typeof value === 'string' && ID.test(value) ? value : null);
const count = (value: unknown): number | null => (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= 100000 ? value : null);
const ms = (value: unknown): number | null => (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= 86400000 ? value : null);

export function signalFromKitEvent(event: unknown, concept: string): KitSignal | null {
  if (!event || typeof event !== 'object') return null;
  const e = event as Record<string, unknown>;
  switch (e.kind) {
    case 'answer': return typeof e.correct === 'boolean' ? { concept, kind: 'question', correct: e.correct, misconception: e.correct ? null : id(e.misconception) } : null;
    case 'hint': return { concept, kind: 'hint' };
    case 'retry': return { concept, kind: 'retry' };
    case 'step': return { concept, kind: 'step', value: ms(e.ms) };
    // The module's own summary: how long the learner worked in it and how many controls they touched.
    case 'summary': return { concept, kind: 'module', value: ms(e.ms), ops: count(e.controls) };
    case 'observe': {
      const tag = id(e.tag);
      if (!tag || (e.observed !== 'evidence' && e.observed !== 'misconception')) return null;
      return { concept, kind: 'question', correct: e.observed === 'evidence', misconception: e.observed === 'misconception' ? tag : null };
    }
    default: return null;
  }
}
