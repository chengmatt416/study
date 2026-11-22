-- 暫停考試、AI 批改評語、錯題複習紀錄
ALTER TABLE exam_attempts ADD COLUMN paused_at INTEGER;
ALTER TABLE exam_attempts ADD COLUMN paused_ms INTEGER NOT NULL DEFAULT 0;
ALTER TABLE exam_attempts ADD COLUMN comments_json TEXT;

CREATE TABLE mistake_reviews (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  question_id TEXT NOT NULL,
  outcome TEXT NOT NULL CHECK (outcome IN ('understood','still_confused')),
  note TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_mistake_reviews ON mistake_reviews(user_id, document_id, question_id, created_at);
