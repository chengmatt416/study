-- Adaptive lesson routing signals, and per-classroom opt-in for live AI.
CREATE TABLE learner_signals (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  classroom_id TEXT NOT NULL,
  concept TEXT NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('pretest','checkpoint','question','hint','step','retry','ask')),
  correct INTEGER CHECK(correct IN (0,1)),
  misconception TEXT,
  value INTEGER,
  created_at INTEGER NOT NULL
);
CREATE INDEX learner_signals_user_class ON learner_signals(user_id,classroom_id,created_at);
CREATE INDEX learner_signals_user_time ON learner_signals(user_id,created_at);

CREATE TABLE live_ai_sessions (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  classroom_id TEXT NOT NULL,
  enabled_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  PRIMARY KEY(user_id,classroom_id)
);

-- Allow the 'route' purpose. SQLite cannot alter a CHECK, so rebuild the pair. The child table is dropped first
-- so no ON DELETE CASCADE can remove its rows, and its rows are kept in a side table meanwhile.
CREATE TABLE live_ai_calls_keep AS SELECT * FROM live_ai_calls;
CREATE TABLE live_ai_turns_keep AS SELECT * FROM live_ai_turns;
DROP TABLE live_ai_calls;
DROP TABLE live_ai_turns;
CREATE TABLE live_ai_turns (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  classroom_id TEXT NOT NULL,
  purpose TEXT NOT NULL CHECK(purpose IN ('interaction','regrade','route')),
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX live_ai_turns_user_time ON live_ai_turns(user_id,created_at);
CREATE INDEX live_ai_turns_time ON live_ai_turns(created_at);
CREATE TABLE live_ai_calls (
  id TEXT PRIMARY KEY,
  turn_id TEXT NOT NULL REFERENCES live_ai_turns(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  reserved_tokens INTEGER NOT NULL,
  actual_tokens INTEGER,
  cost REAL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','completed','failed'))
);
CREATE INDEX live_ai_calls_user_time ON live_ai_calls(user_id,created_at);
CREATE INDEX live_ai_calls_turn ON live_ai_calls(turn_id);
CREATE INDEX live_ai_calls_time ON live_ai_calls(created_at);
INSERT INTO live_ai_turns(id,user_id,classroom_id,purpose,created_at,expires_at) SELECT id,user_id,classroom_id,purpose,created_at,expires_at FROM live_ai_turns_keep;
INSERT INTO live_ai_calls(id,turn_id,user_id,created_at,reserved_tokens,actual_tokens,cost,status) SELECT id,turn_id,user_id,created_at,reserved_tokens,actual_tokens,cost,status FROM live_ai_calls_keep;
DROP TABLE live_ai_calls_keep;
DROP TABLE live_ai_turns_keep;
