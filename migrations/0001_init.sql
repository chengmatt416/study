-- STUDY 初始 schema
-- 時間一律 unix ms（INTEGER）；id 為 crypto.randomUUID()

-- 使用者與授權名單（觀看與編輯同一份名單）
CREATE TABLE allowlist (
  email TEXT PRIMARY KEY,
  role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('admin','member')),
  note TEXT,
  invited_by TEXT,
  created_at INTEGER NOT NULL
);
CREATE TABLE users (
  id TEXT PRIMARY KEY,
  google_sub TEXT UNIQUE,
  email TEXT UNIQUE NOT NULL,
  name TEXT,
  avatar_url TEXT,
  created_at INTEGER NOT NULL,
  last_login_at INTEGER
);
CREATE TABLE sessions (
  id_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL,
  user_agent TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_sessions_user ON sessions(user_id);
CREATE TABLE oauth_states (
  state TEXT PRIMARY KEY,
  code_verifier TEXT NOT NULL,
  nonce TEXT NOT NULL,
  redirect_to TEXT,
  created_at INTEGER NOT NULL
);

-- 分類
CREATE TABLE subjects (
  id TEXT PRIMARY KEY,
  slug TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  color TEXT,
  sort INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE topics (
  id TEXT PRIMARY KEY,
  subject_id TEXT NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
  parent_id TEXT,
  code TEXT,
  title TEXT NOT NULL,
  sort INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE assessments (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  start_date TEXT,
  end_date TEXT,
  created_at INTEGER NOT NULL
);
CREATE TABLE assessment_scope (
  id TEXT PRIMARY KEY,
  assessment_id TEXT NOT NULL REFERENCES assessments(id) ON DELETE CASCADE,
  subject_id TEXT NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
  has_exam INTEGER NOT NULL DEFAULT 1,
  coverage_md TEXT,
  exam_date TEXT
);
-- 任何內容（book/note/exam/deck）可掛 topic 或 assessment
CREATE TABLE content_links (
  content_type TEXT NOT NULL,
  content_id TEXT NOT NULL,
  topic_id TEXT,
  assessment_id TEXT
);
CREATE INDEX idx_content_links ON content_links(content_type, content_id);

-- 電子書
CREATE TABLE books (
  id TEXT PRIMARY KEY,
  subject_id TEXT REFERENCES subjects(id),
  title TEXT NOT NULL,
  r2_key TEXT,
  size_bytes INTEGER NOT NULL DEFAULT 0,
  page_count INTEGER,
  page_offset INTEGER NOT NULL DEFAULT 0,
  has_text_layer INTEGER,
  cover_key TEXT,
  status TEXT NOT NULL DEFAULT 'uploading' CHECK (status IN ('uploading','ready','failed')),
  uploaded_by TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE uploads (
  id TEXT PRIMARY KEY,               -- R2 multipart uploadId
  book_id TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  r2_key TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  part_size INTEGER NOT NULL,
  part_count INTEGER NOT NULL,
  created_by TEXT,
  created_at INTEGER NOT NULL,
  completed_at INTEGER
);
CREATE TABLE upload_parts (
  upload_id TEXT NOT NULL REFERENCES uploads(id) ON DELETE CASCADE,
  part_number INTEGER NOT NULL,
  etag TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  PRIMARY KEY (upload_id, part_number)
);
CREATE TABLE annotations (
  id TEXT PRIMARY KEY,
  book_id TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  page INTEGER NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('highlight','underline','strike','ink','rect','note')),
  data_json TEXT NOT NULL,
  color TEXT,
  visibility TEXT NOT NULL DEFAULT 'private' CHECK (visibility IN ('private','shared')),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER
);
CREATE INDEX idx_ann_book_page ON annotations(book_id, page);
CREATE INDEX idx_ann_user ON annotations(user_id, book_id);
CREATE TABLE bookmarks (
  id TEXT PRIMARY KEY,
  book_id TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  page INTEGER NOT NULL,
  label TEXT,
  created_at INTEGER NOT NULL
);
CREATE TABLE reading_progress (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  book_id TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  page INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, book_id)
);

-- 重點整理與試題（共用「文件 + 修訂」模型）
CREATE TABLE documents (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('note','exam')),
  subject_id TEXT REFERENCES subjects(id),
  slug TEXT UNIQUE NOT NULL,
  title TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'published' CHECK (status IN ('draft','published','archived')),
  baseline_revision_id TEXT,
  current_revision_id TEXT,
  answers_revision_id TEXT,          -- exam：目前生效（已核准）的答案版本
  created_by TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX idx_documents_kind ON documents(kind, subject_id);
CREATE TABLE revisions (
  id TEXT PRIMARY KEY,
  document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  parent_id TEXT,
  body_md TEXT NOT NULL,
  author_id TEXT,
  contributors TEXT,                 -- JSON array of user ids（即時協作期間參與者）
  message TEXT,
  source TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual','autosave','import','revert','baseline')),
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_revisions_doc ON revisions(document_id, created_at);
CREATE TABLE answer_revisions (
  id TEXT PRIMARY KEY,
  document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  answers_json TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  author_id TEXT,
  reviewed_by TEXT,
  message TEXT,
  created_at INTEGER NOT NULL,
  reviewed_at INTEGER
);
CREATE INDEX idx_answer_rev_doc ON answer_revisions(document_id, created_at);
CREATE TABLE assets (
  id TEXT PRIMARY KEY,
  r2_key TEXT NOT NULL,
  mime TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  uploaded_by TEXT,
  created_at INTEGER NOT NULL
);

-- 作答
CREATE TABLE exam_attempts (
  id TEXT PRIMARY KEY,
  document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  revision_id TEXT NOT NULL,
  answers_revision_id TEXT NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  started_at INTEGER NOT NULL,
  submitted_at INTEGER,
  duration_sec INTEGER,
  responses_json TEXT NOT NULL DEFAULT '{}',
  result_json TEXT,
  self_scores_json TEXT,
  score REAL,
  max_score REAL
);
CREATE INDEX idx_attempts_user ON exam_attempts(user_id, document_id);

-- 字卡
CREATE TABLE decks (
  id TEXT PRIMARY KEY,
  subject_id TEXT REFERENCES subjects(id),
  title TEXT NOT NULL,
  description TEXT,
  source_type TEXT NOT NULL DEFAULT 'manual' CHECK (source_type IN ('manual','notebooklm','csv','json')),
  source_url TEXT,
  source_meta TEXT,
  last_synced_at INTEGER,
  created_by TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE cards (
  id TEXT PRIMARY KEY,
  deck_id TEXT NOT NULL REFERENCES decks(id) ON DELETE CASCADE,
  ord INTEGER NOT NULL,
  front TEXT NOT NULL,
  back TEXT NOT NULL,
  baseline_front TEXT,               -- 原版；NULL 表示新增於原版之後
  baseline_back TEXT,
  source_key TEXT,                   -- 匯入來源對應用（正面內容 hash）
  updated_by TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER
);
CREATE INDEX idx_cards_deck ON cards(deck_id, ord);
CREATE TABLE card_revisions (
  id TEXT PRIMARY KEY,
  card_id TEXT NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
  front TEXT NOT NULL,
  back TEXT NOT NULL,
  author_id TEXT,
  created_at INTEGER NOT NULL
);
CREATE TABLE review_state (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  card_id TEXT NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
  deck_id TEXT NOT NULL,
  due INTEGER NOT NULL,
  stability REAL NOT NULL,
  difficulty REAL NOT NULL,
  elapsed_days INTEGER NOT NULL,
  scheduled_days INTEGER NOT NULL,
  learning_steps INTEGER NOT NULL DEFAULT 0,
  reps INTEGER NOT NULL,
  lapses INTEGER NOT NULL,
  state INTEGER NOT NULL,
  last_review INTEGER,
  PRIMARY KEY (user_id, card_id)
);
CREATE INDEX idx_review_due ON review_state(user_id, deck_id, due);
CREATE TABLE review_log (
  id TEXT PRIMARY KEY,               -- 由前端產生，離線重送時可去重
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  card_id TEXT NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
  rating INTEGER NOT NULL,
  mode TEXT NOT NULL,
  reviewed_at INTEGER NOT NULL,
  duration_ms INTEGER
);
CREATE INDEX idx_review_log_user ON review_log(user_id, reviewed_at);
CREATE TABLE deck_settings (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  deck_id TEXT NOT NULL REFERENCES decks(id) ON DELETE CASCADE,
  new_per_day INTEGER NOT NULL DEFAULT 20,
  target_date TEXT,                  -- 考試日期（考前衝刺）
  PRIMARY KEY (user_id, deck_id)
);

-- 系統
CREATE TABLE audit_log (
  id TEXT PRIMARY KEY,
  actor_id TEXT,
  action TEXT NOT NULL,
  entity TEXT NOT NULL,
  entity_id TEXT,
  meta_json TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_audit_time ON audit_log(created_at);
CREATE TABLE system_checks (
  name TEXT PRIMARY KEY,
  ok INTEGER NOT NULL,
  detail TEXT,
  checked_at INTEGER NOT NULL
);
