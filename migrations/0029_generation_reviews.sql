-- Reviews a chatbot must pass while generating: the course blueprint (reviewed by the learner in the app unless they asked
-- for yolo mode), the finished classroom, every mock exam, and the vocabulary plan behind a flashcard deck.
CREATE TABLE course_blueprint_drafts (
  id TEXT PRIMARY KEY,
  document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  topic_id TEXT REFERENCES topics(id) ON DELETE SET NULL,
  created_by TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  topic TEXT NOT NULL,
  blueprint_json TEXT NOT NULL,
  self_review_json TEXT NOT NULL,
  mode TEXT NOT NULL CHECK (mode IN ('review','yolo')),
  status TEXT NOT NULL CHECK (status IN ('pending_review','changes_requested','approved','started','superseded')),
  feedback TEXT,
  replaces_id TEXT,
  generation_id TEXT,
  round INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX idx_blueprint_drafts_owner ON course_blueprint_drafts(created_by, updated_at);

ALTER TABLE openmaic_core_runs ADD COLUMN blueprint_draft_id TEXT;
ALTER TABLE openmaic_core_runs ADD COLUMN completion_review_json TEXT;

CREATE TABLE exam_reviews (
  document_id TEXT PRIMARY KEY REFERENCES documents(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('pending','passed','failed')),
  review_json TEXT,
  decision TEXT CHECK (decision IS NULL OR decision IN ('redo','edit')),
  rounds INTEGER NOT NULL DEFAULT 0,
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE deck_vocabulary_plans (
  deck_id TEXT PRIMARY KEY REFERENCES decks(id) ON DELETE CASCADE,
  plan_json TEXT NOT NULL,
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at INTEGER NOT NULL
);
