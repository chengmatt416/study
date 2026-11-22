CREATE TABLE live_ai_config (
  id INTEGER PRIMARY KEY CHECK(id=1),
  enabled INTEGER NOT NULL DEFAULT 0 CHECK(enabled IN (0,1)),
  model TEXT NOT NULL DEFAULT '',
  encrypted_key TEXT,
  max_output_tokens INTEGER NOT NULL DEFAULT 1024,
  requests_per_minute INTEGER NOT NULL DEFAULT 4,
  requests_per_day INTEGER NOT NULL DEFAULT 40,
  tokens_per_day INTEGER NOT NULL DEFAULT 200000,
  global_requests_per_day INTEGER NOT NULL DEFAULT 1000,
  global_tokens_per_day INTEGER NOT NULL DEFAULT 5000000,
  max_calls_per_turn INTEGER NOT NULL DEFAULT 6,
  updated_at INTEGER NOT NULL,
  updated_by TEXT REFERENCES users(id)
);
INSERT INTO live_ai_config(id,updated_at) VALUES(1,0);
CREATE TABLE live_ai_access (
  email TEXT PRIMARY KEY REFERENCES allowlist(email) ON DELETE CASCADE,
  enabled INTEGER NOT NULL DEFAULT 0 CHECK(enabled IN (0,1)),
  requests_per_minute INTEGER,
  requests_per_day INTEGER,
  tokens_per_day INTEGER,
  updated_at INTEGER NOT NULL,
  updated_by TEXT REFERENCES users(id)
);
CREATE TABLE live_ai_turns (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  classroom_id TEXT NOT NULL,
  purpose TEXT NOT NULL CHECK(purpose IN ('interaction','regrade')),
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
