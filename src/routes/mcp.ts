import { createFileRoute } from "@tanstack/react-router";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { createPersistedMcpServer } from "@/forge/remote-mcp-server.ts";
import { authenticateMcpApiKey } from "@/lib/mcp/api-keys.server.ts";
import { verifyMcpOAuthAccessToken } from "@/lib/mcp/oauth.server.ts";
import { mcpPublicBaseUrl } from "@/lib/mcp/oauth-config.ts";
import { databaseReadinessResponse, inspectDatabaseReadiness } from "@/lib/db-readiness.server";
import {
  isTrustedHost,
  isTrustedOrigin,
  normalizeConfiguredOrigin,
  normalizeHostHeader,
  resolveAuthOriginPolicy,
} from "@/lib/auth/origin-policy";
function authOriginPolicy() {
  return resolveAuthOriginPolicy({
    nodeEnv: process.env.NODE_ENV,
    vercelEnvironment: process.env.VERCEL_ENV,
    vercelUrl: process.env.VERCEL_URL,
    vercelBranchUrl: process.env.VERCEL_BRANCH_URL,
    vercelProjectProductionUrl: process.env.VERCEL_PROJECT_PRODUCTION_URL,
    explicitBaseURL: process.env.BETTER_AUTH_URL,
    grokProjectId: process.env.GROK_PROJECT_ID,
  });
}

function firstHeader(value: string | null): string | undefined {
  return value?.split(",")[0]?.trim() || undefined;
}

function requestHost(request: Request): string | undefined {
  const candidate = firstHeader(request.headers.get("x-forwarded-host")) || new URL(request.url).host;
  return normalizeHostHeader(candidate);
}

function hostAllowed(request: Request): boolean {
  const policy = authOriginPolicy();
  const host = requestHost(request);
  if (host && isTrustedHost(host, policy.allowedHosts)) return true;

  const configured = (process.env.MCP_ALLOWED_HOSTS || "")
    .split(",")
    .map((value) => normalizeHostHeader(value.trim()))
    .filter((value): value is string => Boolean(value));
  return Boolean(host && configured.includes(host));
}

function originAllowed(request: Request): boolean {
  const rawOrigin = request.headers.get("origin");
  // Native/server MCP clients commonly omit Origin; Host validation and bearer
  // authentication still apply. A present Origin must be valid and explicitly trusted.
  if (!rawOrigin) return true;

  const policy = authOriginPolicy();
  const origin = normalizeConfiguredOrigin(rawOrigin, {
    allowHttpLocal: !policy.isProduction && !policy.isVercelPreview,
  });
  if (!origin) return false;

  const host = requestHost(request);
  const forwardedProto = firstHeader(request.headers.get("x-forwarded-proto"))?.toLowerCase();
  if (forwardedProto && forwardedProto !== "http" && forwardedProto !== "https") return false;
  const local = host ? ["localhost", "127.0.0.1", "[::1]"].includes(host.replace(/:\d+$/, "").toLowerCase()) : false;
  const protocol = forwardedProto || (local ? "http" : "https");
  const effectiveOrigin = host
    ? normalizeConfiguredOrigin(protocol + "://" + host, {
        allowHttpLocal: !policy.isProduction && !policy.isVercelPreview,
      })
    : undefined;

  if (effectiveOrigin && origin === effectiveOrigin && isTrustedOrigin(origin, policy.trustedOrigins)) {
    return true;
  }

  // Optional browser-client exceptions are exact origins only; no URL paths or
  // wildcard patterns are accepted.
  const configured = (process.env.MCP_ALLOWED_ORIGINS || "")
    .split(",")
    .map((value) => normalizeConfiguredOrigin(value.trim(), {
      allowHttpLocal: !policy.isProduction && !policy.isVercelPreview,
    }))
    .filter((value): value is string => Boolean(value));
  return configured.includes(origin);
}

function corsHeaders(origin?: string | null): Headers {
  const headers = new Headers({
    "access-control-allow-methods": "GET, POST, DELETE, OPTIONS",
    "access-control-allow-headers": "Authorization, Content-Type, Mcp-Session-Id, Mcp-Protocol-Version, Last-Event-Id",
    "access-control-expose-headers": "Mcp-Session-Id, Mcp-Protocol-Version",
    "cache-control": "no-store",
    "vary": "Origin",
  });
  headers.set("access-control-allow-origin", origin || "*");
  return headers;
}

function withCors(response: Response, request?: Request): Response {
  const headers = new Headers(response.headers);
  const origin = request?.headers.get("origin") || null;
  const allowed = !request || (hostAllowed(request) && originAllowed(request));
  corsHeaders(origin && allowed ? origin : null).forEach((value, key) => {
    if (key === "cache-control" || key === "vary" || !headers.has(key)) headers.set(key, value);
  });
  if (origin && !allowed) headers.delete("access-control-allow-origin");
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

async function handleMcp(request: Request): Promise<Response> {
  const origin = request.headers.get("origin");
  if (!hostAllowed(request) || !originAllowed(request)) {
    return withCors(Response.json({ error: "Origin or host is not allowed." }, { status: 403 }), request);
  }
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders(origin) });
  }
  if (!["GET", "POST", "DELETE"].includes(request.method)) {
    return withCors(Response.json({ error: "Method not allowed." }, { status: 405 }), request);
  }
  const readiness = await inspectDatabaseReadiness();
  if (!readiness.ok) return withCors(databaseReadinessResponse(readiness), request);
  const authorization = request.headers.get("authorization") ?? "";
  const keyMatch = /^Bearer\s+(mvmf_live_[A-Za-z0-9_-]{32,160})$/.exec(authorization);
  const oauthMatch = /^Bearer\s+(mvm3d_oauth_[A-Za-z0-9._-]{80,4096})$/.exec(authorization);
  let userId = "";
  let scopes: string[] = [];

  if (keyMatch) {
    let identity: Awaited<ReturnType<typeof authenticateMcpApiKey>>;
    try {
      identity = await authenticateMcpApiKey(keyMatch[1]);
    } catch {
      return withCors(Response.json({ error: "MCP authentication service is temporarily unavailable." }, { status: 503 }), request);
    }
    if (identity) {
      userId = identity.userId;
      scopes = identity.scopes;
    }
  } else if (oauthMatch) {
    try {
      const identity = await verifyMcpOAuthAccessToken(oauthMatch[1]);
      if (identity) {
        userId = identity.userId;
        scopes = identity.scopes;
      }
    } catch (error) {
      // Never log the bearer token itself; the verifier error is enough to
      // distinguish expiry, issuer/audience mismatch, and signing-secret issues.
      console.error("[mcp] OAuth bearer verification failed", {
        message: error instanceof Error ? error.message.slice(0, 300) : "Unknown verification error",
      });
    }
  }

  if (!userId) {
    const resourceMetadata = `${mcpPublicBaseUrl()}/.well-known/oauth-protected-resource/mcp`;
    console.warn("[mcp] request rejected: missing or invalid bearer credential", {
      method: request.method,
      credentialType: keyMatch ? "api-key" : oauthMatch ? "oauth" : authorization.startsWith("Bearer ") ? "unknown-bearer" : "missing",
    });
    return withCors(Response.json(
      { error: "Authentication required. Reconnect MVM3D in your MCP client, then retry the tool call." },
      {
        status: 401,
        headers: {
          "www-authenticate": `Bearer realm="MvM 3D MCP", resource_metadata="${resourceMetadata}", error="invalid_token"`,
        },
      },
    ), request);
  }
  try {
    const server = createPersistedMcpServer({ userId, scopes });
    const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    await server.connect(transport);
    return withCors(await transport.handleRequest(request), request);
  } catch (error) {
    const rawCode = error && typeof error === "object" && "code" in error ? error.code : undefined;
    const driverCode = typeof rawCode === "string" && /^[A-Za-z0-9_-]{2,16}$/.test(rawCode)
      ? rawCode
      : undefined;
    console.error("[mcp] transport request failed after readiness probe", {
      method: request.method,
      ...(driverCode ? { driverCode } : {}),
    });
    return withCors(Response.json(
      { error: "MCP request failed. Please retry later." },
      { status: 500 },
    ), request);
  }
}
export const Route = createFileRoute("/mcp")({
  server: { handlers: {
    GET: ({ request }) => handleMcp(request),
    POST: ({ request }) => handleMcp(request),
    DELETE: ({ request }) => handleMcp(request),
    OPTIONS: ({ request }) => handleMcp(request),
  } },
});
