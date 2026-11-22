-- The learner can say "I don't know" instead of guessing; record it as its own signal kind.
-- SQLite cannot alter a CHECK, so rebuild the table. Nothing references learner_signals.
CREATE TABLE learner_signals_new (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  classroom_id TEXT NOT NULL,
  concept TEXT NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('pretest','checkpoint','question','hint','step','retry','ask','unsure')),
  correct INTEGER CHECK(correct IN (0,1)),
  misconception TEXT,
  value INTEGER,
  created_at INTEGER NOT NULL
);
INSERT INTO learner_signals_new SELECT id,user_id,classroom_id,concept,kind,correct,misconception,value,created_at FROM learner_signals;
DROP TABLE learner_signals;
ALTER TABLE learner_signals_new RENAME TO learner_signals;
CREATE INDEX learner_signals_user_class ON learner_signals(user_id,classroom_id,created_at);
CREATE INDEX learner_signals_user_time ON learner_signals(user_id,created_at);
