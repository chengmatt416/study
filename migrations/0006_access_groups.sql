CREATE TABLE access_groups (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  description TEXT NOT NULL DEFAULT '',
  version INTEGER NOT NULL DEFAULT 1,
  edit_token TEXT,
  created_at INTEGER NOT NULL
);
CREATE TABLE access_group_members (
  group_id TEXT NOT NULL REFERENCES access_groups(id) ON DELETE CASCADE,
  email TEXT NOT NULL REFERENCES allowlist(email) ON DELETE CASCADE,
  PRIMARY KEY (group_id, email)
);
CREATE INDEX idx_access_members_email ON access_group_members(email);
CREATE TABLE access_rules (
  group_id TEXT NOT NULL REFERENCES access_groups(id) ON DELETE CASCADE,
  resource_type TEXT NOT NULL CHECK(resource_type IN ('feature','book','document','deck')),
  resource_id TEXT NOT NULL,
  allowed INTEGER NOT NULL CHECK(allowed IN (0,1)),
  PRIMARY KEY (group_id, resource_type, resource_id)
);
