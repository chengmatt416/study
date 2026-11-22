ALTER TABLE practice_items ADD COLUMN visibility TEXT NOT NULL DEFAULT 'private'
  CHECK(visibility IN ('private','shared'));

CREATE INDEX practice_items_shared_feed ON practice_items(kind,level,subject_id,id)
  WHERE visibility='shared';
