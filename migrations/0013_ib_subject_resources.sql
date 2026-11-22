ALTER TABLE books ADD COLUMN ib_document_type TEXT CHECK(ib_document_type IS NULL OR ib_document_type IN ('syllabus','guideline','mark_scheme'));
ALTER TABLE books ADD COLUMN ib_level TEXT CHECK(ib_level IS NULL OR ib_level IN ('both','SL','HL'));
ALTER TABLE books ADD COLUMN ib_first_assessment_year INTEGER CHECK(ib_first_assessment_year IS NULL OR ib_first_assessment_year BETWEEN 1900 AND 2200);
ALTER TABLE books ADD COLUMN ib_version TEXT;
CREATE INDEX idx_books_ib_resources ON books(subject_id,ib_document_type,ib_level,status);
