-- The router now also sees how a learner operated an interactive module (`module`: total time in `value`, number of
-- controls touched in `ops`), and a learner's request to skip a chapter (`skip`) with the router's answer when it
-- granted the request (`skipped`, written by the server only).
-- SQLite cannot alter a CHECK, so rebuild the table. Nothing references learner_signals.
CREATE TABLE learner_signals_new (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  classroom_id TEXT NOT NULL,
  concept TEXT NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('pretest','checkpoint','question','hint','step','retry','ask','unsure','module','skip','skipped')),
  correct INTEGER CHECK(correct IN (0,1)),
  misconception TEXT,
  value INTEGER,
  difficulty INTEGER CHECK (difficulty IS NULL OR difficulty BETWEEN 1 AND 3),
  ops INTEGER CHECK (ops IS NULL OR ops >= 0),
  created_at INTEGER NOT NULL
);
INSERT INTO learner_signals_new(id,user_id,classroom_id,concept,kind,correct,misconception,value,difficulty,created_at)
  SELECT id,user_id,classroom_id,concept,kind,correct,misconception,value,difficulty,created_at FROM learner_signals ORDER BY created_at, rowid;
DROP TABLE learner_signals;
ALTER TABLE learner_signals_new RENAME TO learner_signals;
CREATE INDEX learner_signals_user_class ON learner_signals(user_id,classroom_id,created_at);
CREATE INDEX learner_signals_user_time ON learner_signals(user_id,created_at);
