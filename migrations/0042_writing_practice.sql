CREATE TABLE writing_practices (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  language TEXT NOT NULL CHECK (language IN ('en', 'zh')),
  prompt TEXT NOT NULL,
  markscheme_json TEXT NOT NULL,
  draft TEXT,
  feedback_json TEXT,
  final_draft TEXT,
  created_at INTEGER NOT NULL,
  CHECK (feedback_json IS NULL OR draft IS NOT NULL),
  CHECK (final_draft IS NULL OR feedback_json IS NOT NULL)
);

CREATE INDEX idx_writing_practices_user_created ON writing_practices(user_id, created_at DESC, id DESC);
