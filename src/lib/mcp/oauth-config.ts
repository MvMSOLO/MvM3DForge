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

const MCP_PRODUCTION_ORIGIN = "https://mvm3d.vercel.app";
const VERIFIED_MCP_PRODUCTION_ORIGINS = [
  MCP_PRODUCTION_ORIGIN,
  "https://mvm3d-mvmsolos-projects.vercel.app",
  "https://mvm3d-git-main-mvmsolos-projects.vercel.app",
] as const;

function normalizeExplicitMcpOrigin(value: string, allowLocalHttp: boolean): string | null {
  try {
    const parsed = new URL(value);
    const local = ["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname.toLowerCase());
    if (
      parsed.username ||
      parsed.password ||
      parsed.pathname !== "/" ||
      parsed.search ||
      parsed.hash ||
      parsed.hostname.includes("*") ||
      (parsed.protocol !== "https:" && !(allowLocalHttp && local && parsed.protocol === "http:")) ||
      (parsed.port !== "" && !local)
    ) return null;
    return parsed.origin.toLowerCase();
  } catch {
    return null;
  }
}

function vercelOrigin(value: string | undefined): string | undefined {
  const raw = value?.trim();
  if (!raw) return undefined;
  try {
    const parsed = new URL(raw.includes("://") ? raw : "https://" + raw);
    if (
      parsed.protocol !== "https:" ||
      parsed.username ||
      parsed.password ||
      parsed.pathname !== "/" ||
      parsed.search ||
      parsed.hash ||
      parsed.port ||
      parsed.hostname.includes("*") ||
      !parsed.hostname.toLowerCase().endsWith(".vercel.app")
    ) return undefined;
    return parsed.origin.toLowerCase();
  } catch {
    return undefined;
  }
}

function mcpRuntimeMode(): "development" | "preview" | "production" {
  if (process.env.NODE_ENV && process.env.NODE_ENV !== "production") return "development";
  if (process.env.VERCEL_ENV?.trim().toLowerCase() === "preview") return "preview";
  if (process.env.VERCEL_ENV?.trim().toLowerCase() === "production" || process.env.NODE_ENV === "production") {
    return "production";
  }
  return "development";
}

export function mcpPublicBaseUrl(): string {
  const mode = mcpRuntimeMode();
  const configured = process.env.MCP_PUBLIC_URL?.trim();
  const explicitOrigin = configured
    ? normalizeExplicitMcpOrigin(configured, mode === "development")
    : null;
  if (configured && !explicitOrigin) {
    throw new Error("MCP_PUBLIC_URL must be a valid root origin without credentials, paths, queries, fragments, wildcards, or untrusted ports.");
  }

  if (mode === "development") {
    return explicitOrigin || "http://localhost:8080";
  }

  const branchOrigin = vercelOrigin(process.env.VERCEL_BRANCH_URL);
  const deploymentOrigin = vercelOrigin(process.env.VERCEL_URL);
  const projectOrigin = vercelOrigin(process.env.VERCEL_PROJECT_PRODUCTION_URL);

  if (mode === "preview") {
    const previewOrigins = [branchOrigin, deploymentOrigin].filter((origin): origin is string => Boolean(origin));
    if (!previewOrigins.length) {
      throw new Error("MCP_PUBLIC_URL could not be inferred for this Vercel preview deployment.");
    }
    if (explicitOrigin && !previewOrigins.includes(explicitOrigin)) {
      throw new Error("MCP_PUBLIC_URL must match this Vercel preview's branch or deployment origin.");
    }
    return explicitOrigin || branchOrigin || deploymentOrigin!;
  }

  const productionOrigins = new Set<string>([
    ...VERIFIED_MCP_PRODUCTION_ORIGINS,
    ...(projectOrigin ? [projectOrigin] : []),
    ...(deploymentOrigin ? [deploymentOrigin] : []),
  ]);
  if (explicitOrigin && !productionOrigins.has(explicitOrigin)) {
    throw new Error("MCP_PUBLIC_URL must match the verified MVM3D production origin or its exact Vercel-reported origin.");
  }
  // Keep the canonical hostname as issuer when the environment has only a
  // deployment URL or no metadata; never advertise a branch Preview as issuer.
  return explicitOrigin || projectOrigin || MCP_PRODUCTION_ORIGIN;
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
