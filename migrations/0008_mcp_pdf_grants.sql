CREATE TABLE mcp_pdf_grants (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  book_id TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  r2_key TEXT NOT NULL,
  etag TEXT NOT NULL,
  origin TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX idx_mcp_pdf_grants_expires ON mcp_pdf_grants(expires_at);
