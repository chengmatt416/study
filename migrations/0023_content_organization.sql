-- Personal organization never changes shared content or the document trash state.
CREATE TABLE content_folders (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL CHECK(length(name) BETWEEN 1 AND 120),
  parent_id TEXT REFERENCES content_folders(id) ON DELETE RESTRICT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX idx_content_folders_user_parent ON content_folders(user_id,parent_id);
CREATE TABLE content_organization (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  content_type TEXT NOT NULL CHECK(content_type IN ('document','book','deck')),
  content_id TEXT NOT NULL,
  folder_id TEXT REFERENCES content_folders(id) ON DELETE RESTRICT,
  archived_at INTEGER,
  starred INTEGER NOT NULL DEFAULT 0 CHECK(starred IN (0,1)),
  updated_at INTEGER NOT NULL,
  PRIMARY KEY(user_id,content_type,content_id)
);
CREATE INDEX idx_content_organization_folder ON content_organization(user_id,folder_id);
CREATE INDEX idx_content_organization_archive ON content_organization(user_id,content_type,archived_at,content_id);
CREATE TRIGGER content_organization_document_deleted AFTER DELETE ON documents BEGIN
  DELETE FROM content_organization WHERE content_type='document' AND content_id=OLD.id;
END;
CREATE TRIGGER content_organization_book_deleted AFTER DELETE ON books BEGIN
  DELETE FROM content_organization WHERE content_type='book' AND content_id=OLD.id;
END;
CREATE TRIGGER content_organization_deck_deleted AFTER DELETE ON decks BEGIN
  DELETE FROM content_organization WHERE content_type='deck' AND content_id=OLD.id;
END;
