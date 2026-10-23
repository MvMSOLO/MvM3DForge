CREATE TABLE IF NOT EXISTS mcp_execution_jobs (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  job_kind TEXT NOT NULL CHECK (job_kind IN ('script', 'render')),
  code TEXT NOT NULL DEFAULT '',
  apply_changes BOOLEAN NOT NULL DEFAULT FALSE,
  base_updated_at BIGINT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('queued', 'running', 'awaiting_capture', 'completed', 'failed')),
  result_json TEXT,
  screenshot_data_url TEXT,
  error TEXT,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL,
  claimed_at BIGINT,
  completed_at BIGINT
);

CREATE INDEX IF NOT EXISTS idx_mcp_execution_jobs_queue
  ON mcp_execution_jobs(user_id, project_id, status, created_at);

CREATE INDEX IF NOT EXISTS idx_mcp_execution_jobs_status_age
  ON mcp_execution_jobs(status, updated_at);
