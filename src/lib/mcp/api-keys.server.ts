import { randomBytes, randomUUID } from "node:crypto";
import { getSql } from "@/lib/db";
import { hashMcpApiKey, normalizeMcpScopes, type McpScope } from "./api-keys-primitives.ts";

export { MCP_SCOPES, hashMcpApiKey, normalizeMcpScopes } from "./api-keys-primitives.ts";
export type { McpScope } from "./api-keys-primitives.ts";

export interface McpApiKeyRow {
  id: string;
  user_id: string;
  name: string;
  key_hash: string;
  key_prefix: string;
  scopes_json: string;
  created_at: number;
  last_used_at: number | null;
  expires_at: number | null;
  revoked_at: number | null;
}

export interface PublicMcpApiKey {
  id: string;
  name: string;
  prefix: string;
  scopes: McpScope[];
  createdAt: number;
  lastUsedAt: number | null;
  expiresAt: number | null;
  revokedAt: number | null;
}

function publicKey(row: McpApiKeyRow): PublicMcpApiKey {
  let scopes: McpScope[] = [];
  try {
    scopes = normalizeMcpScopes(JSON.parse(row.scopes_json));
  } catch {
    scopes = [];
  }
  return {
    id: row.id,
    name: row.name,
    prefix: row.key_prefix,
    scopes,
    createdAt: Number(row.created_at),
    lastUsedAt: row.last_used_at == null ? null : Number(row.last_used_at),
    expiresAt: row.expires_at == null ? null : Number(row.expires_at),
    revokedAt: row.revoked_at == null ? null : Number(row.revoked_at),
  };
}

export async function createMcpApiKey(
  userId: string,
  input: { name: string; scopes: unknown; expiresInDays?: number | null },
): Promise<{ key: string; record: PublicMcpApiKey }> {
  if (!userId) throw new Error("A signed-in user is required.");
  const name = input.name.trim().slice(0, 80);
  if (name.length < 2) throw new Error("Key name must be at least 2 characters.");
  const scopes = normalizeMcpScopes(input.scopes);
  const days = input.expiresInDays == null ? null : Number(input.expiresInDays);
  if (days != null && (!Number.isInteger(days) || days < 1 || days > 365)) {
    throw new Error("Expiry must be between 1 and 365 days.");
  }

  // A high-entropy one-time secret: store only its SHA-256 digest.
  const key = "mvmf_live_" + randomBytes(32).toString("base64url");
  const id = randomUUID();
  const now = Date.now();
  const expiresAt = days == null ? null : now + days * 24 * 60 * 60 * 1000;
  const row: McpApiKeyRow = {
    id,
    user_id: userId,
    name,
    key_hash: hashMcpApiKey(key),
    key_prefix: key.slice(0, 16),
    scopes_json: JSON.stringify(scopes),
    created_at: now,
    last_used_at: null,
    expires_at: expiresAt,
    revoked_at: null,
  };

  const sql = await getSql();
  await sql`
    INSERT INTO mcp_api_keys (
      id, user_id, name, key_hash, key_prefix, scopes_json,
      created_at, last_used_at, expires_at, revoked_at
    ) VALUES (
      ${row.id}, ${row.user_id}, ${row.name}, ${row.key_hash}, ${row.key_prefix},
      ${row.scopes_json}, ${row.created_at}, ${row.last_used_at}, ${row.expires_at}, ${row.revoked_at}
    )
  `;

  return { key, record: publicKey(row) };
}

export async function listMcpApiKeys(userId: string): Promise<PublicMcpApiKey[]> {
  const sql = await getSql();
  const rows = await sql<McpApiKeyRow>`
    SELECT id, user_id, name, key_hash, key_prefix, scopes_json, created_at,
           last_used_at, expires_at, revoked_at
      FROM mcp_api_keys
     WHERE user_id = ${userId}
     ORDER BY created_at DESC
  `;
  return rows.map(publicKey);
}

export async function revokeMcpApiKey(userId: string, keyId: string): Promise<boolean> {
  const sql = await getSql();
  const now = Date.now();
  const rows = await sql<{ id: string }>`
    UPDATE mcp_api_keys
       SET revoked_at = ${now}
     WHERE id = ${keyId} AND user_id = ${userId} AND revoked_at IS NULL
     RETURNING id
  `;
  return rows.length > 0;
}

export async function authenticateMcpApiKey(token: string): Promise<{
  userId: string;
  scopes: McpScope[];
  keyId: string;
} | null> {
  if (!token.startsWith("mvmf_live_") || token.length < 40 || token.length > 200) return null;

  const sql = await getSql();
  const hash = hashMcpApiKey(token);
  const now = Date.now();
  const rows = await sql<McpApiKeyRow>`
    SELECT id, user_id, name, key_hash, key_prefix, scopes_json, created_at,
           last_used_at, expires_at, revoked_at
      FROM mcp_api_keys
     WHERE key_hash = ${hash}
       AND revoked_at IS NULL
       AND (expires_at IS NULL OR expires_at > ${now})
     LIMIT 1
  `;
  const row = rows[0];
  if (!row?.user_id) return null;

  let scopes: McpScope[];
  try {
    scopes = normalizeMcpScopes(JSON.parse(row.scopes_json));
  } catch {
    return null;
  }
  await sql`UPDATE mcp_api_keys SET last_used_at = ${now} WHERE id = ${row.id} AND revoked_at IS NULL`;
  return { userId: row.user_id, scopes, keyId: row.id };
}
