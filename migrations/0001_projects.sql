CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  schema_version TEXT NOT NULL DEFAULT '1.0',
  api_version TEXT NOT NULL DEFAULT 'v1',
  app_version TEXT NOT NULL DEFAULT '1.0.0',
  code TEXT NOT NULL DEFAULT '',
  scene_json TEXT NOT NULL,
  objects_json TEXT NOT NULL,
  clips_json TEXT NOT NULL DEFAULT '[]',
  textures_json TEXT NOT NULL DEFAULT '[]',
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_projects_user_id ON projects(user_id);
