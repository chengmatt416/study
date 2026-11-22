-- Regenerating a part starts a new official run under a new attempt; the Core keeps one run per part key.
ALTER TABLE long_course_parts ADD COLUMN generation_attempt INTEGER NOT NULL DEFAULT 0;
