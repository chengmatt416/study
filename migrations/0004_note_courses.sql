-- OpenMAIC-compatible courses belong to notes and follow their deletion lifecycle.
CREATE TABLE note_courses (
  document_id TEXT PRIMARY KEY REFERENCES documents(id) ON DELETE CASCADE,
  course_json TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  updated_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  updated_at INTEGER NOT NULL
);
