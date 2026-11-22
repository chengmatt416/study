import { summarize, type ConceptState, type LearnerSignal, type SignalKind } from '../../shared/adaptive-learning';
import { liveAiError } from './live-ai/service';

const KEEP_PER_CLASSROOM = 2000;
const FLOOD_PER_MINUTE = 300;
interface SignalRow { classroom_id: string; concept: string; kind: SignalKind; correct: number | null; misconception: string | null; value: number | null; difficulty: number | null; ops: number | null; created_at: number }
const toSignal = (row: SignalRow): LearnerSignal => ({ concept: row.concept, kind: row.kind, correct: row.correct === null ? null : row.correct === 1, misconception: row.misconception, value: row.value, difficulty: row.difficulty as LearnerSignal['difficulty'], ops: row.ops });

export async function recordSignals(env: Env, userId: string, classroom: string, signals: LearnerSignal[], now = Date.now()) {
  const recent = await env.DB.prepare('SELECT COUNT(*) AS n FROM learner_signals WHERE user_id=? AND created_at>?').bind(userId, now - 60000).first<{ n: number }>();
  if ((recent?.n ?? 0) + signals.length > FLOOD_PER_MINUTE) liveAiError('互動紀錄太頻繁，請稍後再試', 429, 'signal_limit', 60);
  const insert = env.DB.prepare('INSERT INTO learner_signals(id,user_id,classroom_id,concept,kind,correct,misconception,value,difficulty,ops,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)');
  await env.DB.batch([
    ...signals.map((signal, index) => insert.bind(crypto.randomUUID(), userId, classroom, signal.concept, signal.kind, signal.correct === undefined || signal.correct === null ? null : signal.correct ? 1 : 0, signal.misconception ?? null, signal.value ?? null, signal.difficulty ?? null, signal.ops ?? null, now + index)),
    env.DB.prepare('DELETE FROM learner_signals WHERE user_id=? AND classroom_id=? AND id NOT IN (SELECT id FROM learner_signals WHERE user_id=? AND classroom_id=? ORDER BY created_at DESC, rowid DESC LIMIT ?)').bind(userId, classroom, userId, classroom, KEEP_PER_CLASSROOM),
  ]);
}

export async function loadSignals(env: Env, userId: string, classroom: string): Promise<LearnerSignal[]> {
  const { results } = await env.DB.prepare('SELECT classroom_id,concept,kind,correct,misconception,value,difficulty,ops,created_at FROM learner_signals WHERE user_id=? AND classroom_id=? ORDER BY created_at, rowid').bind(userId, classroom).all<SignalRow>();
  return results.map(toSignal);
}

export async function classroomStates(env: Env, userId: string, classroom: string): Promise<Record<string, ConceptState>> {
  return summarize(await loadSignals(env, userId, classroom));
}

export interface WeaknessReport { classroom_id: string; last_activity: number; concepts: ConceptState[] }
/** Concepts the learner has not mastered, or mastered with recorded misconceptions. Only the caller's own signals are read. */
export async function learnerWeaknesses(env: Env, userId: string, options: { classroom?: string; limit?: number; now?: number } = {}): Promise<WeaknessReport[]> {
  const since = (options.now ?? Date.now()) - 90 * 86400000;
  const { results } = await env.DB.prepare(`SELECT classroom_id,concept,kind,correct,misconception,value,difficulty,ops,created_at FROM learner_signals
    WHERE user_id=? AND created_at>? ${options.classroom ? 'AND classroom_id=?' : ''} ORDER BY created_at, rowid LIMIT 20000`)
    .bind(...(options.classroom ? [userId, since, options.classroom] : [userId, since])).all<SignalRow>();
  const byClassroom = new Map<string, SignalRow[]>();
  for (const row of results) byClassroom.set(row.classroom_id, [...(byClassroom.get(row.classroom_id) ?? []), row]);
  return [...byClassroom.entries()].map(([classroom_id, rows]) => ({
    classroom_id, last_activity: rows[rows.length - 1].created_at,
    concepts: Object.values(summarize(rows.map(toSignal))).filter(state => state.mastery !== 'mastered' || Object.keys(state.misconceptions).length),
  })).filter(report => report.concepts.length).sort((a, b) => b.last_activity - a.last_activity).slice(0, options.limit ?? 10);
}
