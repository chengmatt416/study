-- IB reference documents are no longer split by subject: the chatbot lists them all and picks the ones that apply.
-- Keep what the subject said by putting its name in the title, then detach the documents from their subject.
UPDATE books SET title = (SELECT s.name FROM subjects s WHERE s.id = books.subject_id) || ' ' || title
  WHERE ib_document_type IS NOT NULL AND subject_id IS NOT NULL
  AND instr(lower(title), lower((SELECT s.name FROM subjects s WHERE s.id = books.subject_id))) = 0;
UPDATE books SET subject_id = NULL WHERE ib_document_type IS NOT NULL;
DROP INDEX IF EXISTS idx_books_ib_resources;
CREATE INDEX idx_books_ib_resources ON books(ib_document_type,ib_level,status);
