ALTER TABLE exam_attempts ADD COLUMN mode TEXT NOT NULL DEFAULT 'exam' CHECK (mode IN ('exam', 'instant'));
ALTER TABLE exam_attempts ADD COLUMN current_question_id TEXT;

CREATE TABLE exam_instant_checks (
  attempt_id TEXT NOT NULL REFERENCES exam_attempts(id) ON DELETE CASCADE,
  question_id TEXT NOT NULL,
  response_json TEXT NOT NULL,
  feedback_json TEXT,
  operation_id TEXT,
  operation_expires_at INTEGER,
  PRIMARY KEY (attempt_id, question_id)
);
