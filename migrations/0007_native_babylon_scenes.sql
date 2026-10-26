ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS engine TEXT;

ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS native_babylon_scene_json TEXT;
