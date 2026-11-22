-- Personal weekly timetable, kept per user and per academic term. day: 1 = Monday … 7 = Sunday.
CREATE TABLE timetable_entries (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  academic_year INTEGER NOT NULL CHECK(academic_year BETWEEN 1900 AND 2200),
  semester TEXT NOT NULL CHECK(semester IN ('1','2','summer')),
  day INTEGER NOT NULL CHECK(day BETWEEN 1 AND 7),
  start_time TEXT NOT NULL,
  end_time TEXT NOT NULL,
  title TEXT NOT NULL,
  room TEXT,
  subject_id TEXT REFERENCES subjects(id) ON DELETE SET NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX idx_timetable_user_term ON timetable_entries(user_id,academic_year,semester,day,start_time);
