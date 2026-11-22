-- 資料手冊（data booklet）：與電子書共用儲存與閱讀器，以 kind 區分
ALTER TABLE books ADD COLUMN kind TEXT NOT NULL DEFAULT 'book';
CREATE INDEX idx_books_kind ON books(kind);
-- 模擬試題可連結一份資料手冊
ALTER TABLE documents ADD COLUMN booklet_id TEXT;
-- 刪除改為移到垃圾桶（status = 'archived'），可由管理員復原或永久刪除
ALTER TABLE documents ADD COLUMN deleted_at INTEGER;
ALTER TABLE documents ADD COLUMN deleted_by TEXT;
