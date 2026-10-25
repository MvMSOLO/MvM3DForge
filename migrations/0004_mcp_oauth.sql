CREATE TABLE IF NOT EXISTS mcp_oauth_clients (
  client_id TEXT PRIMARY KEY,
  client_name TEXT NOT NULL,
  redirect_uris_json TEXT NOT NULL,
  scope TEXT NOT NULL,
  created_at BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS mcp_oauth_codes (
  code_hash TEXT PRIMARY KEY,
  client_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  redirect_uri TEXT NOT NULL,
  code_challenge TEXT NOT NULL,
  scopes_json TEXT NOT NULL,
  expires_at BIGINT NOT NULL,
  consumed_at BIGINT,
  created_at BIGINT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_mcp_oauth_codes_expiry ON mcp_oauth_codes(expires_at);
CREATE INDEX IF NOT EXISTS idx_mcp_oauth_codes_client ON mcp_oauth_codes(client_id, created_at);
