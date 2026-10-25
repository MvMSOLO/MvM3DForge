/**
 * Shared, dependency-free origin policy for Better Auth and the OAuth consent
 * POST. Production trusts the canonical MVM3D host plus exact Vercel-provided
 * deployment hosts; Preview trusts only its own branch/deployment hosts.
 */
export const CANONICAL_PRODUCTION_ORIGIN = "https://mvm3d.vercel.app";
/** Exact production aliases listed by the audited Vercel mvm3d project. */
export const VERIFIED_PROJECT_PRODUCTION_ORIGINS = [
  CANONICAL_PRODUCTION_ORIGIN,
  "https://mvm3d-mvmsolos-projects.vercel.app",
  "https://mvm3d-git-main-mvmsolos-projects.vercel.app",
] as const;
export const LIVE_PREVIEW_HOST_PATTERN = "*.grok-sandbox.com";

export const LOCAL_DEV_ORIGINS = [
  "http://localhost:8080",
  "http://127.0.0.1:8080",
  "http://[::1]:8080",
] as const;

export type AuthOriginPolicyInput = {
  nodeEnv?: string;
  vercelEnvironment?: string;
  vercelUrl?: string;
  vercelBranchUrl?: string;
  vercelProjectProductionUrl?: string;
  explicitBaseURL?: string;
  grokProjectId?: string;
};

export type AuthOriginPolicy = {
  trustedOrigins: string[];
  allowedHosts: string[];
  explicitBaseURL?: string;
  isProduction: boolean;
  isVercelPreview: boolean;
  isWorkspacePreview: boolean;
};

function clean(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized || undefined;
}

function isLoopback(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return host === "localhost" || host === "127.0.0.1" || host === "[::1]";
}

/**
 * Normalize an explicit origin, rejecting URL paths, queries, fragments,
 * credentials, commas and non-HTTPS remote origins. HTTP is local-only.
 */
export function normalizeConfiguredOrigin(
  value: string | undefined,
  options: { allowHttpLocal?: boolean } = {},
): string | undefined {
  const raw = clean(value);
  if (!raw || raw.includes(",")) return undefined;
  try {
    const parsed = new URL(raw);
    if (
      parsed.username ||
      parsed.password ||
      parsed.pathname !== "/" ||
      parsed.search ||
      parsed.hash
    ) return undefined;

    const local = isLoopback(parsed.hostname);
    if (parsed.hostname.includes("*")) return undefined;
    if (parsed.protocol === "https:") {
      if (parsed.port) return undefined;
      return parsed.origin.toLowerCase();
    }
    if (parsed.protocol === "http:" && local && options.allowHttpLocal) {
      return parsed.origin.toLowerCase();
    }
    return undefined;
  } catch {
    return undefined;
  }
}

/** Parse Vercel's host-only env vars as exact HTTPS *.vercel.app origins. */
export function configuredVercelOrigin(value: string | undefined): string | undefined {
  const raw = clean(value);
  if (!raw || raw.includes(",")) return undefined;
  const candidate = raw.includes("://") ? raw : "https://" + raw;
  const normalized = normalizeConfiguredOrigin(candidate);
  if (!normalized) return undefined;
  try {
    const hostname = new URL(normalized).hostname.toLowerCase();
    if (!hostname.endsWith(".vercel.app")) return undefined;
    return normalized;
  } catch {
    return undefined;
  }
}

function add(target: Set<string>, value: string | undefined): void {
  if (value) target.add(value);
}
/** Normalize a single Host / forwarded-host value without trusting its domain. */
export function normalizeHostHeader(value: string | undefined): string | undefined {
  const raw = clean(value);
  if (!raw || raw.includes(",") || raw.includes("/") || raw.includes("@") || raw.includes("*") || raw.includes("://")) {
    return undefined;
  }
  try {
    const parsed = new URL("https://" + raw);
    if (parsed.username || parsed.password || parsed.pathname !== "/" || parsed.search || parsed.hash) return undefined;
    if (parsed.port && !isLoopback(parsed.hostname)) return undefined;
    return parsed.host.toLowerCase();
  } catch {
    return undefined;
  }
}

/** Exact host allow-list plus the one workspace-preview wildcard. */
export function isTrustedHost(value: string | undefined, allowedHosts: readonly string[]): boolean {
  const normalized = normalizeHostHeader(value);
  if (!normalized) return false;
  if (allowedHosts.includes(normalized)) return true;
  const noPort = normalized.replace(/:\d+$/, "");
  return allowedHosts.includes(LIVE_PREVIEW_HOST_PATTERN) &&
    noPort.endsWith(".grok-sandbox.com") &&
    noPort !== "grok-sandbox.com";
}


function originHost(origin: string): string | undefined {
  if (origin === LIVE_PREVIEW_HOST_PATTERN || origin === "https://" + LIVE_PREVIEW_HOST_PATTERN) {
    return LIVE_PREVIEW_HOST_PATTERN;
  }
  try {
    return new URL(origin).host.toLowerCase();
  } catch {
    return undefined;
  }
}

export function resolveAuthOriginPolicy(input: AuthOriginPolicyInput): AuthOriginPolicy {
  const nodeEnv = clean(input.nodeEnv)?.toLowerCase();
  const vercelEnvironment = clean(input.vercelEnvironment)?.toLowerCase();
  const isVercelPreview = vercelEnvironment === "preview" && nodeEnv !== "development";
  // A Grok workspace preview has no Vercel environment markers and no deployed
  // project id. Give it its documented sandbox host only; never on Vercel.
  const isWorkspacePreview = nodeEnv !== "production" && !vercelEnvironment && !clean(input.grokProjectId);
  const isProduction = !isVercelPreview && !isWorkspacePreview &&
    (vercelEnvironment === "production" || nodeEnv === "production");

  const deploymentOrigin = configuredVercelOrigin(input.vercelUrl);
  const branchOrigin = configuredVercelOrigin(input.vercelBranchUrl);
  const projectProductionOrigin = configuredVercelOrigin(input.vercelProjectProductionUrl);
  const explicitOrigin = normalizeConfiguredOrigin(input.explicitBaseURL, {
    allowHttpLocal: !isProduction && !isVercelPreview,
  });

  const trusted = new Set<string>();
  if (isProduction) {
    for (const origin of VERIFIED_PROJECT_PRODUCTION_ORIGINS) trusted.add(origin);
    add(trusted, projectProductionOrigin);
    add(trusted, deploymentOrigin);
    // BETTER_AUTH_URL is configuration, not proof of domain ownership. Only
    // honor it when it matches the canonical or platform-reported exact origin.
    if (explicitOrigin && trusted.has(explicitOrigin)) add(trusted, explicitOrigin);
  } else if (isVercelPreview) {
    // Preview never borrows the Production project's host. A stale global
    // BETTER_AUTH_URL pointing at production is ignored rather than trusted.
    add(trusted, branchOrigin);
    add(trusted, deploymentOrigin);
    if (explicitOrigin && (explicitOrigin === branchOrigin || explicitOrigin === deploymentOrigin)) {
      add(trusted, explicitOrigin);
    }
  } else {
    add(trusted, explicitOrigin);
    for (const origin of LOCAL_DEV_ORIGINS) trusted.add(origin);
    if (isWorkspacePreview) {
      // The sandbox origin is necessary for dynamic live-preview sign-in. Keep
      // it HTTPS-only, and never enable the pattern in a Vercel deployment.
      trusted.add("https://" + LIVE_PREVIEW_HOST_PATTERN);
    }
  }

  const allowedHosts = new Set<string>();
  for (const origin of trusted) {
    const host = originHost(origin);
    if (host) allowedHosts.add(host);
  }
  if (isWorkspacePreview) allowedHosts.add(LIVE_PREVIEW_HOST_PATTERN);
  if (!isProduction && !isVercelPreview) {
    for (const origin of LOCAL_DEV_ORIGINS) {
      const host = originHost(origin);
      if (host) allowedHosts.add(host);
    }
  }

  const trustedExplicit = explicitOrigin && trusted.has(explicitOrigin)
    ? explicitOrigin
    : undefined;

  return {
    trustedOrigins: [...trusted],
    allowedHosts: [...allowedHosts],
    explicitBaseURL: trustedExplicit,
    isProduction,
    isVercelPreview,
    isWorkspacePreview,
  };
}

export function isTrustedOrigin(origin: string, trustedOrigins: readonly string[]): boolean {
  const normalized = normalizeConfiguredOrigin(origin, { allowHttpLocal: true });
  if (!normalized) return false;
  return trustedOrigins.some((candidate) => {
    if (candidate === normalized) return true;
    const wildcard = candidate === LIVE_PREVIEW_HOST_PATTERN ||
      candidate === "https://" + LIVE_PREVIEW_HOST_PATTERN;
    if (!wildcard || !normalized.startsWith("https://")) return false;
    const hostname = new URL(normalized).hostname.toLowerCase();
    return hostname.endsWith(".grok-sandbox.com") && hostname !== "grok-sandbox.com";
  });
}

export type SameOriginPostInput = {
  origin?: string | null;
  referer?: string | null;
  forwardedHost?: string | null;
  host?: string | null;
  forwardedProto?: string | null;
};

/**
 * A cookie-bearing consent POST needs a verifiable browser origin and must be
 * same-origin with the trusted public host. Missing Origin is accepted only
 * when a strict same-origin Referer is present (some embedded clients omit Origin).
 */
export function isTrustedSameOriginPost(
  request: SameOriginPostInput,
  policy: AuthOriginPolicy,
): boolean {
  const originHeader = clean(request.origin ?? undefined);
  const refererHeader = clean(request.referer ?? undefined);
  let sourceOrigin: string | undefined;

  if (originHeader) {
    // Origin is serialized as an origin only; reject "null", paths and lists.
    sourceOrigin = normalizeConfiguredOrigin(originHeader, {
      allowHttpLocal: !policy.isProduction && !policy.isVercelPreview,
    });
  } else if (refererHeader && !refererHeader.includes(",")) {
    try {
      const referer = new URL(refererHeader);
      if (referer.username || referer.password || referer.hash) return false;
      sourceOrigin = normalizeConfiguredOrigin(referer.origin, {
        allowHttpLocal: !policy.isProduction && !policy.isVercelPreview,
      });
    } catch {
      return false;
    }
  } else {
    return false;
  }

  if (!sourceOrigin || !isTrustedOrigin(sourceOrigin, policy.trustedOrigins)) return false;

  const first = (value: string | null | undefined): string | undefined =>
    clean(value ?? undefined)?.split(",")[0]?.trim() || undefined;
  const requestHost = first(request.forwardedHost) || first(request.host);
  if (!requestHost || requestHost.includes("/") || requestHost.includes("@")) return false;

  const hostIsLocal = isLoopback(requestHost.replace(/:\d+$/, "").toLowerCase());
  const forwardedProto = first(request.forwardedProto)?.toLowerCase();
  if (forwardedProto && forwardedProto !== "https" && forwardedProto !== "http") return false;
  const protocol = forwardedProto || (hostIsLocal ? "http" : "https");

  let requestOrigin: string | undefined;
  try {
    const candidate = requestHost.includes("://")
      ? requestHost
      : protocol + "://" + requestHost;
    requestOrigin = normalizeConfiguredOrigin(candidate, {
      allowHttpLocal: !policy.isProduction && !policy.isVercelPreview,
    });
  } catch {
    return false;
  }

  return Boolean(
    requestOrigin &&
    requestOrigin === sourceOrigin &&
    isTrustedOrigin(requestOrigin, policy.trustedOrigins),
  );
}
