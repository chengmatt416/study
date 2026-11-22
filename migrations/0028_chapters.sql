-- Chapters: one study unit of a subject that gathers its 重點整理 (with its interactive course), mock exams, flashcard decks
-- and uploaded source material. Chapters reuse the original (unused) topics and content_links tables.
ALTER TABLE topics ADD COLUMN description TEXT;
ALTER TABLE topics ADD COLUMN created_by TEXT REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE topics ADD COLUMN created_at INTEGER;
ALTER TABLE topics ADD COLUMN updated_at INTEGER;
CREATE INDEX idx_topics_subject ON topics(subject_id, sort, title);
CREATE UNIQUE INDEX idx_content_links_topic ON content_links(topic_id, content_type, content_id) WHERE topic_id IS NOT NULL;
CREATE INDEX idx_content_links_topic_lookup ON content_links(topic_id);

CREATE TRIGGER content_links_topic_deleted AFTER DELETE ON topics BEGIN
  DELETE FROM content_links WHERE topic_id = OLD.id;
END;
CREATE TRIGGER content_links_document_deleted AFTER DELETE ON documents BEGIN
  DELETE FROM content_links WHERE content_type IN ('note','exam','document') AND content_id = OLD.id;
END;
CREATE TRIGGER content_links_deck_deleted AFTER DELETE ON decks BEGIN
  DELETE FROM content_links WHERE content_type = 'deck' AND content_id = OLD.id;
END;

-- How one learner wants to study one chapter, chosen in the chapter onboarding and changed in its settings.
CREATE TABLE chapter_preferences (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  topic_id TEXT NOT NULL REFERENCES topics(id) ON DELETE CASCADE,
  study_mode TEXT NOT NULL CHECK (study_mode IN ('summary','course')),
  cards_before_exam INTEGER NOT NULL DEFAULT 1 CHECK (cards_before_exam IN (0,1)),
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, topic_id)
);

-- Files a user uploads to a chapter as source material for generation. The original file and its extracted text live in R2.
CREATE TABLE chapter_materials (
  id TEXT PRIMARY KEY,
  topic_id TEXT NOT NULL REFERENCES topics(id) ON DELETE CASCADE,
  filename TEXT NOT NULL CHECK (length(filename) BETWEEN 1 AND 200),
  format TEXT NOT NULL CHECK (format IN ('pptx','docx','md','pdf','html')),
  size INTEGER NOT NULL CHECK (size > 0),
  r2_key TEXT NOT NULL,
  text_key TEXT NOT NULL,
  text_chars INTEGER NOT NULL CHECK (text_chars >= 0),
  sections INTEGER NOT NULL DEFAULT 0,
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_chapter_materials_topic ON chapter_materials(topic_id, created_at);
