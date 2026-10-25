/**
 * Pure OAuth server configuration. Keep this module free of database/auth imports
 * so metadata endpoints are available before any user signs in.
 */
export const MCP_OAUTH_SCOPES = [
  "project:read",
  "scene:write",
  "scene:execute",
  "assets:export",
  "offline_access",
] as const;
export type McpOAuthScope = (typeof MCP_OAUTH_SCOPES)[number];

const SCOPE_SET = new Set<string>(MCP_OAUTH_SCOPES);

export function mcpPublicBaseUrl(): string {
  const configured = process.env.MCP_PUBLIC_URL?.trim();
  const vercelEnvironment = process.env.VERCEL_ENV?.trim().toLowerCase();
  const isPreview = vercelEnvironment === "preview";
  const projectHost = process.env.VERCEL_PROJECT_PRODUCTION_URL?.trim();
  const branchHost = process.env.VERCEL_BRANCH_URL?.trim();
  const deploymentHost = process.env.VERCEL_URL?.trim();

  // An explicit URL wins. Otherwise, previews must identify themselves using
  // their branch/deployment host instead of accidentally borrowing the
  // production project's hostname. Production prefers its stable project host.
  const systemHost = isPreview
    ? branchHost || deploymentHost
    : projectHost || deploymentHost || branchHost;
  const inferredBase = systemHost
    ? "https://" + systemHost.replace(/^https?:\/\//i, "")
    : isPreview
      ? ""
      : process.env.NODE_ENV === "production"
        ? "https://mvm3d.vercel.app"
        : "http://localhost:8080";

  let base = configured || inferredBase;
  while (base.endsWith("/")) base = base.slice(0, -1);
  if (!base) {
    throw new Error("MCP_PUBLIC_URL could not be inferred for this Vercel preview deployment.");
  }

  const parsed = new URL(base);
  if (parsed.protocol !== "https:" && parsed.hostname !== "localhost" && parsed.hostname !== "127.0.0.1") {
    throw new Error("MCP_PUBLIC_URL must use HTTPS outside local development.");
  }
  return parsed.origin;
}

export function mcpResourceUrl(): string {
  return mcpPublicBaseUrl() + "/mcp";
}

export function normalizeOAuthScopes(value: string | null | undefined): McpOAuthScope[] | null {
  const raw = (value || "").trim();
  const scopes = [...new Set(raw ? raw.split(/\s+/).filter(Boolean) : [])];
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
