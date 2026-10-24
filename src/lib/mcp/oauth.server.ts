import { createHash, randomBytes, randomUUID } from "node:crypto";
import { SignJWT, jwtVerify } from "jose";
import { getSql } from "@/lib/db";
import { mcpOAuthSigningSecret } from "@/lib/auth/server";

export const MCP_OAUTH_SCOPES = [
  "project:read",
  "scene:write",
  "scene:execute",
  "assets:export",
  "offline_access",
] as const;
export type McpOAuthScope = (typeof MCP_OAUTH_SCOPES)[number];

const SCOPE_SET = new Set<string>(MCP_OAUTH_SCOPES);
const CODE_LIFETIME_MS = 5 * 60 * 1000;
const ACCESS_TOKEN_SECONDS = 60 * 60;
export const MCP_OAUTH_REFRESH_TOKEN_SECONDS = 30 * 24 * 60 * 60;
const REFRESH_TOKEN_LIFETIME_MS = MCP_OAUTH_REFRESH_TOKEN_SECONDS * 1000;

export function mcpPublicBaseUrl(): string {
  const configured = process.env.MCP_PUBLIC_URL?.trim();
  const base = (configured || "https://mvm3d.vercel.app").replace(/\/+$/, "");
  const parsed = new URL(base);
  if (parsed.protocol !== "https:" && parsed.hostname !== "localhost" && parsed.hostname !== "127.0.0.1") {
    throw new Error("MCP_PUBLIC_URL must use HTTPS outside local development.");
  }
  return parsed.origin;
}

export function mcpResourceUrl(): string {
  return `${mcpPublicBaseUrl()}/mcp`;
}

export function normalizeOAuthScopes(value: string | null | undefined): McpOAuthScope[] | null {
  const scopes = [...new Set((value || "").split(/\s+/).filter(Boolean))];
  if (!scopes.length) return ["project:read"];
  if (scopes.some((scope) => !SCOPE_SET.has(scope))) return null;
  return scopes as McpOAuthScope[];
}

export function isSafeOAuthRedirectUri(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 2048) return false;
  try {
    const url = new URL(value);
    if (url.username || url.password || url.hash) return false;
    if (url.protocol === "https:") return true;
    return url.protocol === "http:" &&
      (url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "[::1]");
  } catch {
    return false;
  }
}

function digest(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export interface OAuthClientMetadata {
  client_id: string;
  client_name: string;
  redirect_uris: string[];
  token_endpoint_auth_method: "none";
  grant_types: string[];
  response_types: string[];
  scope?: string;
}

/**
 * Dynamic Client Registration is stored in Postgres/PGLite. ChatGPT's
 * Client-ID Metadata Documents are also supported, but only from the
 * explicitly trusted chatgpt.com origin to avoid SSRF through arbitrary URLs.
 */
/**
 * Public OAuth clients are registered dynamically and authenticate with PKCE.
 * Client ID Metadata Documents are not advertised until private_key_jwt assertions
 * are implemented and verified by the token endpoint.
 */
export async function resolveMcpOAuthClient(clientId: string): Promise<OAuthClientMetadata | null> {
  if (!clientId || clientId.length > 256 || clientId.startsWith("https://") || clientId.startsWith("http://")) return null;
  try {
    const sql = await getSql();
    const rows = await sql.query<Record<string, unknown>>(
      "SELECT client_id, client_name, redirect_uris_json, scope, grant_types_json FROM mcp_oauth_clients WHERE client_id = $1 LIMIT 1",
      [clientId],
    );
    const row = rows[0];
    if (!row) return null;
    let redirectUris: unknown;
    let grantTypes: unknown;
    try {
      redirectUris = JSON.parse(String(row.redirect_uris_json));
      grantTypes = JSON.parse(String(row.grant_types_json || '[\"authorization_code\",\"refresh_token\"]'));
    } catch {
      return null;
    }
    if (!Array.isArray(redirectUris) || !redirectUris.every(isSafeOAuthRedirectUri) ||
        !Array.isArray(grantTypes) ||
        grantTypes.some((grant) => grant !== "authorization_code" && grant !== "refresh_token") ||
        !grantTypes.includes("authorization_code")) return null;
    return {
      client_id: String(row.client_id),
      client_name: String(row.client_name || "AI client"),
      redirect_uris: redirectUris,
      token_endpoint_auth_method: "none",
      grant_types: grantTypes as string[],
      response_types: ["code"],
      scope: typeof row.scope === "string" ? row.scope : undefined,
    };
  } catch {
    return null;
  }
}

export async function registerMcpOAuthClient(input: {
  client_name?: unknown;
  redirect_uris?: unknown;
  grant_types?: unknown;
  response_types?: unknown;
  token_endpoint_auth_method?: unknown;
  scope?: unknown;
}): Promise<OAuthClientMetadata> {
  const redirectUris = input.redirect_uris;
  if (!Array.isArray(redirectUris) || redirectUris.length < 1 || redirectUris.length > 12 ||
      !redirectUris.every(isSafeOAuthRedirectUri)) {
    throw new Error("redirect_uris must contain 1–12 valid HTTPS or loopback redirect URLs.");
  }
  const grantTypes = Array.isArray(input.grant_types) ? input.grant_types : ["authorization_code", "refresh_token"];
  const responseTypes = Array.isArray(input.response_types) ? input.response_types : ["code"];
  if (!grantTypes.includes("authorization_code") || grantTypes.length > 2 || new Set(grantTypes).size !== grantTypes.length ||
      grantTypes.some((grant) => grant !== "authorization_code" && grant !== "refresh_token") ||
      responseTypes.length !== 1 || responseTypes[0] !== "code" ||
      (input.token_endpoint_auth_method !== undefined && input.token_endpoint_auth_method !== "none")) {
    throw new Error("Only authorization_code (optionally refresh_token) with PKCE and token_endpoint_auth_method=none is supported.");
  }
  const scopes = typeof input.scope === "string" ? normalizeOAuthScopes(input.scope) : [...MCP_OAUTH_SCOPES];
  if (!scopes) throw new Error("The requested OAuth scope contains an unsupported permission.");
  const clientId = `mvm3d_client_${randomUUID().replace(/-/g, "")}`;
  const clientName = typeof input.client_name === "string" && input.client_name.trim()
    ? input.client_name.trim().slice(0, 120)
    : "AI client";
  const sql = await getSql();
  await sql.query(
    "INSERT INTO mcp_oauth_clients (client_id, client_name, redirect_uris_json, scope, grant_types_json, created_at) VALUES ($1, $2, $3, $4, $5, $6)",
    [clientId, clientName, JSON.stringify(redirectUris), scopes.join(" "), JSON.stringify(grantTypes), Date.now()],
  );
  return {
    client_id: clientId,
    client_name: clientName,
    redirect_uris: redirectUris,
    token_endpoint_auth_method: "none",
    grant_types: grantTypes as string[],
    response_types: ["code"],
    scope: scopes.join(" "),
  };
}

export async function createMcpOAuthCode(input: {
  clientId: string;
  userId: string;
  redirectUri: string;
  challenge: string;
  scopes: McpOAuthScope[];
}): Promise<string> {
  const code = randomBytes(32).toString("base64url");
  const now = Date.now();
  const sql = await getSql();
  await sql.query(
    "INSERT INTO mcp_oauth_codes (code_hash, client_id, user_id, redirect_uri, code_challenge, scopes_json, expires_at, consumed_at, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7, NULL, $8)",
    [digest(code), input.clientId, input.userId, input.redirectUri, input.challenge, JSON.stringify(input.scopes), now + CODE_LIFETIME_MS, now],
  );
  return code;
}

export async function exchangeMcpOAuthCode(input: {
  code: string;
  clientId: string;
  redirectUri: string;
  verifier: string;
}): Promise<{ userId: string; scopes: McpOAuthScope[] } | null> {
  if (!/^[A-Za-z0-9._~-]{43,128}$/.test(input.verifier)) return null;
  const expectedChallenge = createHash("sha256").update(input.verifier).digest("base64url");
  const now = Date.now();
  const sql = await getSql();
  const rows = await sql.query<Record<string, unknown>>(
    "SELECT code_challenge FROM mcp_oauth_codes WHERE code_hash = $1 AND client_id = $2 AND redirect_uri = $3 AND consumed_at IS NULL AND expires_at > $4 LIMIT 1",
    [digest(input.code), input.clientId, input.redirectUri, now],
  );
  if (!rows[0] || rows[0].code_challenge !== expectedChallenge) return null;

  // Atomic compare-and-set makes authorization codes single-use even when
  // two token exchanges arrive concurrently at different serverless instances.
  const consumed = await sql.query<Record<string, unknown>>(
    "UPDATE mcp_oauth_codes SET consumed_at = $1 WHERE code_hash = $2 AND client_id = $3 AND redirect_uri = $4 AND consumed_at IS NULL AND expires_at > $1 RETURNING user_id, scopes_json",
    [now, digest(input.code), input.clientId, input.redirectUri],
  );
  const row = consumed[0];
  if (!row) return null;
  let decoded: unknown;
  try {
    decoded = JSON.parse(String(row.scopes_json));
  } catch {
    return null;
  }
  if (!Array.isArray(decoded) || decoded.some((scope) => typeof scope !== "string" || !SCOPE_SET.has(scope))) return null;
  return { userId: String(row.user_id), scopes: decoded as McpOAuthScope[] };
}

export async function createMcpOAuthRefreshToken(
  userId: string,
  clientId: string,
  scopes: McpOAuthScope[],
): Promise<string> {
  const token = "mvm3d_refresh_" + randomBytes(48).toString("base64url");
  const now = Date.now();
  const sql = await getSql();
  await sql.query(
    "INSERT INTO mcp_oauth_refresh_tokens (token_hash, client_id, user_id, scopes_json, expires_at, consumed_at, created_at) VALUES ($1, $2, $3, $4, $5, NULL, $6)",
    [digest(token), clientId, userId, JSON.stringify(scopes), now + REFRESH_TOKEN_LIFETIME_MS, now],
  );
  return token;
}

export async function exchangeMcpOAuthRefreshToken(input: {
  refreshToken: string;
  clientId: string;
}): Promise<{ userId: string; scopes: McpOAuthScope[] } | null> {
  if (!input.refreshToken.startsWith("mvm3d_refresh_") || input.refreshToken.length > 256) return null;
  const now = Date.now();
  const sql = await getSql();
  const rows = await sql.query<Record<string, unknown>>(
    "UPDATE mcp_oauth_refresh_tokens SET consumed_at = $1 WHERE token_hash = $2 AND client_id = $3 AND consumed_at IS NULL AND expires_at > $1 RETURNING user_id, scopes_json",
    [now, digest(input.refreshToken), input.clientId],
  );
  const row = rows[0];
  if (!row) return null;
  let decoded: unknown;
  try { decoded = JSON.parse(String(row.scopes_json)); } catch { return null; }
  if (!Array.isArray(decoded) || decoded.some((scope) => typeof scope !== "string" || !SCOPE_SET.has(scope))) return null;
  return { userId: String(row.user_id), scopes: decoded as McpOAuthScope[] };
}

export async function issueMcpOAuthAccessToken(
  userId: string,
  clientId: string,
  scopes: McpOAuthScope[],
): Promise<string> {
  const signingKey = new TextEncoder().encode(mcpOAuthSigningSecret);
  const jwt = await new SignJWT({
    token_use: "mcp_access",
    client_id: clientId,
    scope: scopes.join(" "),
  })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setIssuer(mcpPublicBaseUrl())
    .setAudience(mcpResourceUrl())
    .setSubject(userId)
    .setIssuedAt()
    .setExpirationTime(`${ACCESS_TOKEN_SECONDS}s`)
    .sign(signingKey);
  return `mvm3d_oauth_${jwt}`;
}

export async function verifyMcpOAuthAccessToken(token: string): Promise<{ userId: string; scopes: McpOAuthScope[] } | null> {
  if (!token.startsWith("mvm3d_oauth_")) return null;
  try {
    const { payload } = await jwtVerify(
      token.slice("mvm3d_oauth_".length),
      new TextEncoder().encode(mcpOAuthSigningSecret),
      { issuer: mcpPublicBaseUrl(), audience: mcpResourceUrl(), algorithms: ["HS256"] },
    );
    if (payload.token_use !== "mcp_access" || typeof payload.sub !== "string" || !payload.sub ||
        typeof payload.scope !== "string") return null;
    const scopes = normalizeOAuthScopes(payload.scope);
    if (!scopes) return null;
    return { userId: payload.sub, scopes };
  } catch {
    return null;
  }
}
