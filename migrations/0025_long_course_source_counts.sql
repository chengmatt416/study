-- Keep library totals in a small covering index instead of rereading every source.
ALTER TABLE long_course_parts ADD COLUMN source_chars INTEGER NOT NULL DEFAULT 0 CHECK(source_chars >= 0);
UPDATE long_course_parts SET source_chars=length(source_md);
CREATE INDEX long_course_parts_counts ON long_course_parts(course_id,published_at,source_chars);
