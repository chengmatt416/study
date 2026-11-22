-- Chapters are either shared (everyone who can see the subject) or private (only their creator), like notes and decks.
-- Rows of the old, never-used topics table have no creator; the app never lists them, so a new install starts empty.
ALTER TABLE topics ADD COLUMN visibility TEXT NOT NULL DEFAULT 'private' CHECK (visibility IN ('shared','private'));
CREATE INDEX idx_topics_visibility ON topics(created_by, visibility);
