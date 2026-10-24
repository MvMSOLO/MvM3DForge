-- Repair the OAuth schema used by src/lib/mcp/oauth.server.ts.
-- This is a forward-only migration: 0004 may already be recorded as applied
-- on production, so do not edit that historical migration in place.

ALTER TABLE mcp_oauth_clients
  ADD COLUMN IF NOT EXISTS grant_types_json TEXT NOT NULL
  DEFAULT '["authorization_code","refresh_token"]';

CREATE TABLE IF NOT EXISTS mcp_oauth_refresh_tokens (
  token_hash TEXT PRIMARY KEY,
  client_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  scopes_json TEXT NOT NULL,
  expires_at BIGINT NOT NULL,
  consumed_at BIGINT,
  created_at BIGINT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_mcp_oauth_refresh_tokens_client
  ON mcp_oauth_refresh_tokens(client_id, created_at);

CREATE INDEX IF NOT EXISTS idx_mcp_oauth_refresh_tokens_expiry
  ON mcp_oauth_refresh_tokens(expires_at);
