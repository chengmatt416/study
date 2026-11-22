-- A chapter's PDF is also a book record (kind 'chapter') so the default ebook reader can save its annotations, bookmarks and
-- reading progress. Chapter books never show in the library, search or the content library; their visibility is the chapter's.
ALTER TABLE chapter_materials ADD COLUMN book_id TEXT REFERENCES books(id) ON DELETE SET NULL;
CREATE INDEX idx_chapter_materials_book ON chapter_materials(book_id);
