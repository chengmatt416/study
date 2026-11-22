ALTER TABLE documents ADD COLUMN visibility TEXT NOT NULL DEFAULT 'shared' CHECK(visibility IN ('shared','private'));
ALTER TABLE decks ADD COLUMN visibility TEXT NOT NULL DEFAULT 'shared' CHECK(visibility IN ('shared','private'));
CREATE INDEX idx_documents_visibility_owner ON documents(visibility,created_by);
CREATE INDEX idx_decks_visibility_owner ON decks(visibility,created_by);
