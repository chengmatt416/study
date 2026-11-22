ALTER TABLE subjects ADD COLUMN practice_scale TEXT NOT NULL DEFAULT 'general'
  CHECK(practice_scale IN ('general','ib'));

UPDATE subjects SET practice_scale='ib'
  WHERE lower(slug) GLOB 'ib-*'
    OR lower(trim(name)) GLOB 'ib *';

CREATE TABLE practice_items_with_grades (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  subject_id TEXT NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK(kind IN ('question','flashcard','concept')),
  item_json TEXT NOT NULL,
  level TEXT NOT NULL DEFAULT 'medium'
    CHECK(level IN ('easy','medium','hard','ib-1','ib-2','ib-3','ib-4','ib-5','ib-6','ib-7')),
  visibility TEXT NOT NULL DEFAULT 'private' CHECK(visibility IN ('private','shared'))
);

INSERT INTO practice_items_with_grades(id,user_id,subject_id,kind,item_json,level,visibility)
  SELECT id,user_id,subject_id,kind,item_json,level,visibility FROM practice_items;
DROP TABLE practice_items;
ALTER TABLE practice_items_with_grades RENAME TO practice_items;

CREATE INDEX practice_items_feed ON practice_items(user_id,kind,subject_id,id);
CREATE INDEX practice_items_level_feed ON practice_items(user_id,kind,level,subject_id,id);
CREATE INDEX practice_items_shared_feed ON practice_items(kind,level,subject_id,id)
  WHERE visibility='shared';
