ALTER TABLE books ADD COLUMN academic_year INTEGER CHECK(academic_year IS NULL OR academic_year BETWEEN 1900 AND 2200);
ALTER TABLE books ADD COLUMN semester TEXT CHECK(semester IS NULL OR semester IN ('1','2','summer'));
CREATE INDEX idx_books_syllabus_term ON books(kind,academic_year,semester,subject_id);
