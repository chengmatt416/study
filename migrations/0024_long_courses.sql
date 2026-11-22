CREATE TABLE long_courses (
  id TEXT PRIMARY KEY,
  document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  created_by TEXT NOT NULL REFERENCES users(id),
  title TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX long_courses_document ON long_courses(document_id, created_at DESC);
CREATE TABLE long_course_parts (
  id TEXT PRIMARY KEY,
  course_id TEXT NOT NULL REFERENCES long_courses(id) ON DELETE CASCADE,
  part_key TEXT NOT NULL,
  position INTEGER NOT NULL,
  title TEXT NOT NULL,
  source_md TEXT NOT NULL,
  source_hash TEXT NOT NULL,
  blueprint_json TEXT NOT NULL,
  generation_id TEXT UNIQUE REFERENCES openmaic_core_runs(id) ON DELETE SET NULL,
  classroom_id TEXT,
  start_lease INTEGER,
  published_at INTEGER,
  created_at INTEGER NOT NULL,
  UNIQUE(course_id, part_key),
  UNIQUE(course_id, position)
);
CREATE INDEX long_course_parts_order ON long_course_parts(course_id, position);
