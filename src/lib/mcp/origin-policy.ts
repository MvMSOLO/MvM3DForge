/**
 * Exact host/origin policy for the remote MCP endpoint.
 *
 * Vercel's canonical public hostname is mvm3d.vercel.app. Other hosts are
 * trusted only when explicitly configured or supplied by this deployment's
 * Vercel environment. In particular, do not accept every hostname that merely
 * resembles a project slug and do not retain aliases for other projects.
 */
export type McpOriginEnvironment = Record<string, string | undefined>;

export const CANONICAL_MCP_ORIGIN = "https://mvm3d.vercel.app";

const LOCAL_DEV_HOSTS = ["localhost:8080", "127.0.0.1:8080", "[::1]:8080"] as const;
const LOCAL_DEV_ORIGINS = [
  "http://localhost:8080",
  "http://127.0.0.1:8080",
  "http://[::1]:8080",
] as const;

type RuntimeMode = "production" | "preview" | "development";

function runtimeMode(env: McpOriginEnvironment): RuntimeMode {
  const vercelEnv = env.VERCEL_ENV?.trim().toLowerCase();
  if (vercelEnv === "preview") return "preview";
  if (vercelEnv === "production" || env.NODE_ENV === "production") return "production";
  return "development";
}

function isProduction(env: McpOriginEnvironment): boolean {
  return runtimeMode(env) === "production";
}

function firstForwardedValue(value: string): string {
  return value.split(",", 1)[0]?.trim() ?? "";
}

/** Normalize a raw Host / X-Forwarded-Host authority without trusting paths. */
function normalizeAuthority(value: string | null | undefined): string | null {
  if (!value || value !== value.trim() || /[\s/@?#]/.test(value)) return null;
  try {
    const url = new URL("https://" + value);
    if (url.username || url.password || url.pathname !== "/" || url.search || url.hash) return null;
    return url.host.toLowerCase();
  } catch {
    return null;
  }
}

/** Normalize an explicitly configured allowed host. Host entries are exact; no patterns. */
function normalizeConfiguredHost(value: string | undefined, allowLocalHttp: boolean): string | null {
  if (!value || value !== value.trim()) return null;
  try {
    const url = new URL(value.includes("://") ? value : "https://" + value);
    const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname.toLowerCase());
    if (
      url.username ||
      url.password ||
      url.pathname !== "/" ||
      url.search ||
      url.hash ||
      (url.protocol !== "https:" && !(allowLocalHttp && local && url.protocol === "http:"))
    ) {
      return null;
    }
    return url.host.toLowerCase();
  } catch {
    return null;
  }
}

function parseOrigin(value: string, allowLocalHttp: boolean): URL | null {
  if (!value || value !== value.trim()) return null;
  try {
    const url = new URL(value);
    const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname.toLowerCase());
    if (
      url.username ||
      url.password ||
      url.pathname !== "/" ||
      url.search ||
      url.hash ||
      (url.protocol !== "https:" && !(allowLocalHttp && local && url.protocol === "http:"))
    ) {
      return null;
    }
    return url;
  } catch {
    return null;
  }
}

function parseCsvHosts(value: string, allowLocalHttp: boolean): string[] {
  return value.split(",")
    .map((entry) => normalizeConfiguredHost(entry.trim(), allowLocalHttp))
    .filter((entry): entry is string => Boolean(entry));
}

export function resolveAllowedMcpHosts(env: McpOriginEnvironment): string[] {
  const production = isProduction(env);
  const allowLocalHttp = !production;
  const override = env.MCP_ALLOWED_HOSTS;
  if (override?.trim()) {
    // An explicit override intentionally replaces inferred defaults. Invalid
    // non-empty configuration fails closed rather than silently widening.
    return [...new Set(parseCsvHosts(override, allowLocalHttp))];
  }

  const mode = runtimeMode(env);
  const hostValues = [
    env.MCP_PUBLIC_URL,
    ...(mode === "preview"
      ? [env.VERCEL_BRANCH_URL, env.VERCEL_URL]
      : mode === "production"
        ? [env.VERCEL_PROJECT_PRODUCTION_URL, env.VERCEL_URL]
        : []),
  ];
  const hosts = hostValues
    .map((value) => normalizeConfiguredHost(value, allowLocalHttp))
    .filter((host): host is string => Boolean(host));

  if (mode === "production") {
    hosts.push(new URL(CANONICAL_MCP_ORIGIN).host);
  } else if (mode === "development") {
    hosts.push(...LOCAL_DEV_HOSTS);
  }
  return [...new Set(hosts)];
}

/** Prefer the canonical forwarded host set by Vercel; never fall back when it is malformed. */
export function resolveMcpRequestHost(
  forwardedHost: string | null | undefined,
  directHost: string | null | undefined,
): string | null {
  if (forwardedHost?.trim()) {
    return normalizeAuthority(firstForwardedValue(forwardedHost));
  }
  if (directHost?.trim()) {
    return normalizeAuthority(firstForwardedValue(directHost));
  }
  return null;
}

export function isAllowedMcpHost(
  requestHost: string | null | undefined,
  env: McpOriginEnvironment,
): boolean {
  const normalizedRequestHost = normalizeAuthority(requestHost);
  if (!normalizedRequestHost) return false;
  return resolveAllowedMcpHosts(env).includes(normalizedRequestHost);
}

export function resolveAllowedMcpOrigins(env: McpOriginEnvironment): string[] {
  const production = isProduction(env);
  const allowLocalHttp = !production;
  const override = env.MCP_ALLOWED_ORIGINS;
  if (override?.trim()) {
    // Exact normalized origins only. A malformed non-empty override denies all.
    return [...new Set(override.split(",")
      .map((entry) => parseOrigin(entry.trim(), allowLocalHttp)?.origin)
      .filter((entry): entry is string => Boolean(entry)))];
  }

  const origins = resolveAllowedMcpHosts(env)
    .map((host) => "https://" + host);
  if (!production) origins.push(...LOCAL_DEV_ORIGINS);
  return [...new Set(origins)];
}

/** Non-browser MCP clients omit Origin; browser origins must match an exact allow-list entry. */
export function isAllowedMcpOrigin(
  originHeader: string | null | undefined,
  env: McpOriginEnvironment,
): boolean {
  if (originHeader === null || originHeader === undefined) return true;
  if (!originHeader.trim()) return false;
  const parsed = parseOrigin(originHeader, !isProduction(env));
  if (!parsed) return false;
  return resolveAllowedMcpOrigins(env).includes(parsed.origin);
}
