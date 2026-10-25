import { createFileRoute } from "@tanstack/react-router";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { createPersistedMcpServer } from "@/forge/remote-mcp-server.ts";
import { authenticateMcpApiKey } from "@/lib/mcp/api-keys.server.ts";
import { verifyMcpOAuthAccessToken } from "@/lib/mcp/oauth.server.ts";
import { mcpPublicBaseUrl } from "@/lib/mcp/oauth-config.ts";
import { databaseReadinessResponse, inspectDatabaseReadiness } from "@/lib/db-readiness.server";
import {
  isAllowedMcpHost,
  isAllowedMcpRequestOrigin,
  resolveMcpRequestHost,
} from "@/lib/mcp/origin-policy";
function requestHost(request: Request): string | null {
  return resolveMcpRequestHost(
    request.headers.get("x-forwarded-host"),
    request.headers.get("host") || new URL(request.url).host,
  );
}

function hostAllowed(request: Request): boolean {
  const host = requestHost(request);
  return Boolean(host && isAllowedMcpHost(host, process.env));
}

function originAllowed(request: Request): boolean {
  return isAllowedMcpRequestOrigin({
    origin: request.headers.get("origin"),
    forwardedHost: request.headers.get("x-forwarded-host"),
    host: request.headers.get("host") || new URL(request.url).host,
    forwardedProto: request.headers.get("x-forwarded-proto"),
  }, process.env);
}

function corsHeaders(request?: Request): Headers {
  const headers = new Headers({
    "access-control-allow-methods": "GET, POST, DELETE, OPTIONS",
    "access-control-allow-headers": "Authorization, Content-Type, Mcp-Session-Id, Mcp-Protocol-Version, Last-Event-Id",
    "access-control-expose-headers": "Mcp-Session-Id, Mcp-Protocol-Version",
    "cache-control": "no-store",
    "vary": "Origin",
  });
  if (!request || !request.headers.get("origin")) {
    headers.set("access-control-allow-origin", "*");
  } else if (hostAllowed(request) && originAllowed(request)) {
    headers.set("access-control-allow-origin", request.headers.get("origin")!);
  }
  return headers;
}

function withCors(response: Response, request?: Request): Response {
  const headers = new Headers(response.headers);
  const cors = corsHeaders(request);
  for (const [key, value] of cors.entries()) {
    if (key !== "access-control-allow-origin") {
      headers.set(key, value);
    }
  }

  const origin = request?.headers.get("origin");
  if (origin && hostAllowed(request!) && originAllowed(request!)) {
    headers.set("access-control-allow-origin", origin);
  } else if (origin) {
    // Never reflect a rejected origin and never retain an ACAO header from a
    // downstream transport on an error response.
    headers.delete("access-control-allow-origin");
  } else {
    headers.set("access-control-allow-origin", "*");
  }
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

async function handleMcp(request: Request): Promise<Response> {
  if (!hostAllowed(request) || !originAllowed(request)) {
    return withCors(Response.json({ error: "Origin or host is not allowed." }, { status: 403 }), request);
  }
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders(request) });
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
