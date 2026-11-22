ALTER TABLE practice_items ADD COLUMN level TEXT NOT NULL DEFAULT 'medium'
  CHECK(level IN ('easy','medium','hard') OR (kind='question' AND level IN ('ib-1','ib-2','ib-3','ib-4','ib-5','ib-6','ib-7')));

CREATE INDEX practice_items_level_feed ON practice_items(user_id,kind,level,subject_id,id);
