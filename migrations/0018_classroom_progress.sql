-- Where a learner left off in a classroom: the last scene, and the saved progress of each interactive module they used.
CREATE TABLE classroom_progress (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  classroom_id TEXT NOT NULL,
  scene_id TEXT,
  scene_index INTEGER,
  modules_json TEXT NOT NULL DEFAULT '{}',
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, classroom_id)
);
