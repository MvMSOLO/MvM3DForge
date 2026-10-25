/**
 * Pure OAuth server configuration. Keep this module free of database/auth imports
 * so metadata endpoints are available before any user signs in.
 */
import { configuredVercelOrigin, normalizeConfiguredOrigin } from "@/lib/auth/origin-policy";
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
  const projectOrigin = configuredVercelOrigin(process.env.VERCEL_PROJECT_PRODUCTION_URL);
  const branchOrigin = configuredVercelOrigin(process.env.VERCEL_BRANCH_URL);
  const deploymentOrigin = configuredVercelOrigin(process.env.VERCEL_URL);
  const isPreview = vercelEnvironment === "preview";
  const isProduction = vercelEnvironment === "production" ||
    (!isPreview && process.env.NODE_ENV === "production");

  if (isPreview) {
    // Never let a shared/stale MCP_PUBLIC_URL make a Preview advertise Production
    // as its issuer. Preview must be bound to its own Vercel branch/deployment host.
    const previewOrigins = [branchOrigin, deploymentOrigin].filter(
      (origin): origin is string => Boolean(origin),
    );
    if (!previewOrigins.length) {
      throw new Error("MCP_PUBLIC_URL could not be inferred for this Vercel preview deployment.");
    }
    if (configured) {
      const explicitOrigin = normalizeConfiguredOrigin(configured);
      if (!explicitOrigin || !previewOrigins.includes(explicitOrigin)) {
        throw new Error("MCP_PUBLIC_URL must match this Vercel preview's branch or deployment origin.");
      }
      return explicitOrigin;
    }
    return branchOrigin || deploymentOrigin!;
  }

  if (isProduction) {
    // The deployed project has been audited: mvm3d.vercel.app is its verified
    // canonical domain. Exact Vercel-reported deployment/project aliases may be
    // used when available; stale unrelated project aliases are rejected.
    const productionOrigins = [
      "https://mvm3d.vercel.app",
      projectOrigin,
      deploymentOrigin,
    ].filter((origin): origin is string => Boolean(origin));
    if (configured) {
      const explicitOrigin = normalizeConfiguredOrigin(configured);
      if (!explicitOrigin || !productionOrigins.includes(explicitOrigin)) {
        throw new Error("MCP_PUBLIC_URL must match the verified MVM3D production origin or its Vercel-reported deployment origin.");
      }
      return explicitOrigin;
    }
    return projectOrigin || deploymentOrigin || "https://mvm3d.vercel.app";
  }

  if (configured) {
    const explicitOrigin = normalizeConfiguredOrigin(configured, { allowHttpLocal: true });
    if (!explicitOrigin) {
      throw new Error("MCP_PUBLIC_URL must be a valid HTTPS origin (or local loopback HTTP) without a path.");
    }
    return explicitOrigin;
  }

  // Local-only fallback. Any non-local deployment must provide Vercel metadata
  // or an explicitly verified MCP_PUBLIC_URL rather than silently borrowing a
  // different project's URL.
  const inferred = projectOrigin || deploymentOrigin || branchOrigin;
  return inferred || "http://localhost:8080";
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
