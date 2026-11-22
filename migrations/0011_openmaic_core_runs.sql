CREATE TABLE openmaic_core_runs (
  id TEXT PRIMARY KEY,
  document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  created_by TEXT NOT NULL REFERENCES users(id),
  source_revision_id TEXT,
  expected_course_version INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX openmaic_core_runs_owner_note ON openmaic_core_runs(created_by,document_id,created_at DESC);
