CREATE TABLE practice_items (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  subject_id TEXT NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK(kind IN ('question','flashcard','concept')),
  item_json TEXT NOT NULL
);
CREATE INDEX practice_items_feed ON practice_items(user_id,kind,subject_id,id);

-- Keep quota history while adding the explicit practice explanation purpose.
CREATE TABLE live_ai_calls_keep AS SELECT * FROM live_ai_calls;
CREATE TABLE live_ai_turns_keep AS SELECT * FROM live_ai_turns;
DROP TABLE live_ai_calls;
DROP TABLE live_ai_turns;
CREATE TABLE live_ai_turns (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  classroom_id TEXT NOT NULL,
  purpose TEXT NOT NULL CHECK(purpose IN ('interaction','regrade','route','coach','practice_explain','exam_grade')),
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
INSERT INTO live_ai_turns SELECT * FROM live_ai_turns_keep;
INSERT INTO live_ai_calls SELECT * FROM live_ai_calls_keep;
DROP TABLE live_ai_calls_keep;
DROP TABLE live_ai_turns_keep;
