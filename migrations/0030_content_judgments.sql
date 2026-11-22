-- Verdicts of the content judge (a small model deciding whether slides and modules break the teaching rules),
-- keyed by a hash of the judged content, rules version and model, so unchanged content is never judged (or paid for) twice.
CREATE TABLE content_judgments (
  hash TEXT PRIMARY KEY,
  model TEXT NOT NULL,
  result_json TEXT NOT NULL,
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_content_judgments_created ON content_judgments(created_at);
