/**
 * Resolve Better Auth's trusted origins and dynamic baseURL hosts per runtime.
 *
 * Vercel Preview must not inherit the Production project hostname, and
 * Production must not trust loopback origins or sandbox-preview wildcards.
 * The shared grok-sandbox wildcard remains limited to non-production preview
 * runtimes where that platform actually hosts the app.
 */
export type AuthOriginEnvironment = Record<string, string | undefined>;

export type AuthOriginPolicy = {
  trustedOrigins: string[];
  dynamicAllowedHosts: string[];
  mode: "production" | "preview" | "development";
};

export const CANONICAL_PRODUCTION_ORIGIN = "https://mvm3d.vercel.app";

const PREVIEW_ALLOWED_HOSTS = ["*.grok-sandbox.com"] as const;
const LOCAL_DEV_ORIGINS = [
  "http://localhost:8080",
  "http://127.0.0.1:8080",
  "http://[::1]:8080",
] as const;
const LOCAL_DEV_HOSTS = ["localhost", "127.0.0.1", "[::1]"] as const;

function isLoopbackHost(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
}

function parseOrigin(value: string | undefined, allowLocalHttp: boolean): URL | null {
  if (!value || value !== value.trim()) return null;
  try {
    const url = new URL(value);
    if (
      url.username ||
      url.password ||
      url.pathname !== "/" ||
      url.search ||
      url.hash ||
      (url.protocol !== "https:" && !(allowLocalHttp && url.protocol === "http:" && isLoopbackHost(url.hostname.toLowerCase())))
    ) {
      return null;
    }
    return url;
  } catch {
    return null;
  }
}

/** Accept a platform hostname or a bare hostname, never a path or credential. */
export function normalizeAuthPlatformHost(value: string | undefined): string | null {
  if (!value || value !== value.trim()) return null;
  try {
    const url = new URL(value.includes("://") ? value : "https://" + value);
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.pathname !== "/" ||
      url.search ||
      url.hash
    ) {
      return null;
    }
    return url.host.toLowerCase();
  } catch {
    return null;
  }
}

function resolveMode(env: AuthOriginEnvironment): AuthOriginPolicy["mode"] {
  const vercelEnv = env.VERCEL_ENV?.trim().toLowerCase();
  if (vercelEnv === "preview") return "preview";
  if (vercelEnv === "production" || env.NODE_ENV === "production") return "production";
  return "development";
}

export function resolveAuthOriginPolicy(env: AuthOriginEnvironment): AuthOriginPolicy {
  const mode = resolveMode(env);
  const allowLocalHttp = mode === "development";
  const explicitOrigin = parseOrigin(env.BETTER_AUTH_URL?.trim(), allowLocalHttp);
  const exactPlatformHosts = (mode === "preview"
    ? [env.VERCEL_BRANCH_URL, env.VERCEL_URL]
    : mode === "production"
      ? [env.VERCEL_PROJECT_PRODUCTION_URL, env.VERCEL_URL]
      : []
  )
    .map(normalizeAuthPlatformHost)
    .filter((host): host is string => Boolean(host));

  const exactOrigins = new Set<string>();
  if (explicitOrigin) exactOrigins.add(explicitOrigin.origin);

  if (mode === "production") {
    exactOrigins.add(CANONICAL_PRODUCTION_ORIGIN);
    for (const host of exactPlatformHosts) exactOrigins.add("https://" + host);
  } else if (mode === "preview") {
    for (const host of exactPlatformHosts) exactOrigins.add("https://" + host);
  } else {
    for (const origin of LOCAL_DEV_ORIGINS) exactOrigins.add(origin);
    // This wildcard is the documented shared live-preview boundary, not a
    // catch-all Vercel or arbitrary-domain wildcard.
    exactOrigins.add("https://*.grok-sandbox.com");
    exactOrigins.add("http://*.grok-sandbox.com");
  }

  const dynamicAllowedHosts = new Set<string>(exactPlatformHosts);
  if (mode === "production") {
    dynamicAllowedHosts.add(new URL(CANONICAL_PRODUCTION_ORIGIN).host);
  }
  if (explicitOrigin) dynamicAllowedHosts.add(explicitOrigin.host);
  if (mode === "development") {
    for (const host of LOCAL_DEV_HOSTS) dynamicAllowedHosts.add(host);
    for (const host of PREVIEW_ALLOWED_HOSTS) dynamicAllowedHosts.add(host);
  }

  return {
    mode,
    trustedOrigins: [...exactOrigins],
    dynamicAllowedHosts: [...dynamicAllowedHosts],
  };
}
