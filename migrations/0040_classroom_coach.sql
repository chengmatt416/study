-- 學習教練（learning coach）：看學生在課堂中一再弄錯的地方，解釋那個觀念並建議接下來怎麼走。
-- 1. live_ai_turns.purpose 加入 coach（SQLite 要重建表；先備份並移除子表 live_ai_calls，避免 ON DELETE CASCADE 刪掉紀錄）
-- 2. classroom_coach_notes：每個學生在每個課堂、對每個卡住的地方只解釋一次，重新開啟課堂時讀回同一則，不再呼叫模型

CREATE TABLE live_ai_calls_keep AS SELECT * FROM live_ai_calls;
CREATE TABLE live_ai_turns_keep AS SELECT * FROM live_ai_turns;
DROP TABLE live_ai_calls;
DROP TABLE live_ai_turns;
CREATE TABLE live_ai_turns (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  classroom_id TEXT NOT NULL,
  purpose TEXT NOT NULL CHECK(purpose IN ('interaction','regrade','route','coach')),
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

CREATE TABLE classroom_coach_notes (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  classroom_id TEXT NOT NULL,
  focus_key TEXT NOT NULL,
  note_json TEXT NOT NULL,
  source TEXT NOT NULL CHECK(source IN ('model','rules')),
  created_at INTEGER NOT NULL,
  dismissed_at INTEGER,
  PRIMARY KEY (user_id, classroom_id, focus_key)
);
CREATE INDEX classroom_coach_notes_time ON classroom_coach_notes(user_id, classroom_id, created_at);
