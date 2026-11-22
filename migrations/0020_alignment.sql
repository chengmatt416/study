-- The plan a course is generated from, and how a mock exam lines up with the syllabus and mark scheme.
ALTER TABLE openmaic_core_runs ADD COLUMN blueprint_json TEXT;
CREATE TABLE document_alignments (
  document_id TEXT PRIMARY KEY REFERENCES documents(id) ON DELETE CASCADE,
  alignment_json TEXT NOT NULL,
  created_by TEXT NOT NULL REFERENCES users(id),
  created_at INTEGER NOT NULL
);
