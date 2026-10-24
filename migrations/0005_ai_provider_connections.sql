CREATE TABLE IF NOT EXISTS ai_provider_connections (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  encrypted_api_key TEXT NOT NULL,
  preferred_model TEXT NOT NULL,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL,
  UNIQUE (user_id, provider)
);

CREATE INDEX IF NOT EXISTS idx_ai_provider_connections_user ON ai_provider_connections(user_id);
