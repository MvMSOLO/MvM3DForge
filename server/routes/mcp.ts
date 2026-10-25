import { defineEventHandler, getHeader, getMethod, readBody } from "h3";
import type { H3Event } from "h3";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { createPersistedMcpServer } from "@/forge/remote-mcp-server";
import { validateMcpRequestAuth } from "@/lib/auth/mcp-auth";
import { mcpPublicBaseUrl } from "@/lib/mcp/oauth-config";
import { inspectDatabaseReadiness } from "@/lib/db-readiness.server";
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

function firstHeader(event: H3Event, name: string): string | undefined {
  return getHeader(event, name)?.split(",")[0]?.trim() || undefined;
}

/** Prefer Vercel's public forwarded alias over its internal deployment Host. */
function getRequestHost(event: H3Event): string {
  return firstHeader(event, "x-forwarded-host") || firstHeader(event, "host") || "";
}

function hostAllowed(event: H3Event): boolean {
  const policy = authOriginPolicy();
  const host = getRequestHost(event);
  if (isTrustedHost(host, policy.allowedHosts)) return true;

  // Optional operator-configured additions are exact hosts only. Wildcards,
  // paths, schemes, comma-separated header injection, and credentials are rejected.
  const configured = (process.env.MCP_ALLOWED_HOSTS || "")
    .split(",")
    .map((value) => normalizeHostHeader(value.trim()))
    .filter((value): value is string => Boolean(value));
  const normalized = normalizeHostHeader(host);
  return Boolean(normalized && configured.includes(normalized));
}

function requestOrigin(event: H3Event): string | undefined {
  const policy = authOriginPolicy();
  const host = normalizeHostHeader(getRequestHost(event));
  if (!host) return undefined;
  const forwardedProto = firstHeader(event, "x-forwarded-proto")?.toLowerCase();
  if (forwardedProto && forwardedProto !== "https" && forwardedProto !== "http") return undefined;
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(host.replace(/:\\d+$/, "").toLowerCase());
  const protocol = forwardedProto || (local ? "http" : "https");
  return normalizeConfiguredOrigin(protocol + "://" + host, {
    allowHttpLocal: !policy.isProduction && !policy.isVercelPreview,
  });
}

function originAllowed(event: H3Event): boolean {
  const rawOrigin = getHeader(event, "origin");
  // Native/server MCP clients commonly omit Origin; host validation and bearer
  // authorization still apply. When Origin is present, fail closed on invalid
  // values and require same-origin or an explicit exact operator allow-list entry.
  if (!rawOrigin) return true;
  const policy = authOriginPolicy();
  const origin = normalizeConfiguredOrigin(rawOrigin, {
    allowHttpLocal: !policy.isProduction && !policy.isVercelPreview,
  });
  if (!origin || !isTrustedOrigin(origin, policy.trustedOrigins)) return false;
  const effectiveOrigin = requestOrigin(event);
  if (effectiveOrigin && origin === effectiveOrigin) return true;

  const configured = (process.env.MCP_ALLOWED_ORIGINS || "")
    .split(",")
    .map((value) => normalizeConfiguredOrigin(value.trim(), {
      allowHttpLocal: !policy.isProduction && !policy.isVercelPreview,
    }))
    .filter((value): value is string => Boolean(value));
  return configured.includes(origin);
}

function withCors(response: Response, origin?: string | null): Response {
  const headers = new Headers(response.headers);
  headers.set("Access-Control-Allow-Origin", origin || "*");
  headers.set("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
  headers.set("Access-Control-Allow-Headers", "Authorization, Content-Type, Accept, Mcp-Session-Id, Mcp-Protocol-Version, Last-Event-Id, X-API-Key");
  headers.set("Access-Control-Expose-Headers", "Mcp-Session-Id, Mcp-Protocol-Version, WWW-Authenticate");
  headers.set("Vary", "Origin");
  headers.set("Cache-Control", "no-store");
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

function jsonRpcError(status: number, code: number, message: string, origin?: string | null, headers?: HeadersInit): Response {
  const responseHeaders = new Headers(headers);
  responseHeaders.set("Content-Type", "application/json; charset=utf-8");
  return withCors(Response.json(
    { jsonrpc: "2.0", id: null, error: { code, message } },
    { status, headers: responseHeaders },
  ), origin);
}

function buildRequestHeaders(event: H3Event): Headers {
  const headers = new Headers();
  for (const name of [
    "authorization",
    "origin",
    "content-type",
    "accept",
    "mcp-protocol-version",
    "mcp-session-id",
    "last-event-id",
  ]) {
    const value = getHeader(event, name);
    if (value) headers.set(name, value);
  }
  return headers;
}

export default defineEventHandler(async (event) => {
  const method = getMethod(event).toUpperCase();
  const origin = getHeader(event, "origin");

  if (method === "OPTIONS") {
    if (!hostAllowed(event) || !originAllowed(event)) {
      return jsonRpcError(403, -32003, "Origin or host is not allowed.", origin);
    }
    return withCors(new Response(null, { status: 204 }), origin);
  }

  if (!["GET", "POST", "DELETE"].includes(method)) {
    return jsonRpcError(405, -32000, "Method not allowed.", origin, { Allow: "GET, POST, DELETE, OPTIONS" });
  }
  if (!hostAllowed(event)) return jsonRpcError(403, -32003, "Untrusted Host header.", origin);
  if (!originAllowed(event)) {
    return jsonRpcError(403, -32003, "Origin is not allowed. Configure MCP_ALLOWED_ORIGINS for trusted browser clients.", origin);
  }

  // Check both connectivity and required schema before auth/token reads. The
  // public JSON-RPC error is sanitized; the server-only probe logs the category.
  const readiness = await inspectDatabaseReadiness();
  if (!readiness.ok) {
    return jsonRpcError(503, -32000, readiness.publicMessage, origin);
  }

  const auth = await validateMcpRequestAuth(event);
  if (!auth.authenticated) {
    if (auth.unavailable) return jsonRpcError(503, -32000, auth.error || "MCP authentication is temporarily unavailable.", origin);
    const resourceMetadata = `${mcpPublicBaseUrl()}/.well-known/oauth-protected-resource/mcp`;
    return jsonRpcError(
      401,
      -32001,
      auth.error || "Authentication required. Start the MVM3D OAuth sign-in and consent flow from your MCP client.",
      origin,
      { "WWW-Authenticate": `Bearer realm="MVM3D MCP", resource_metadata="${resourceMetadata}"` },
    );
  }

  try {
    const host = getRequestHost(event);
    const forwardedProto = getHeader(event, "x-forwarded-proto");
    const protocol = forwardedProto === "http" && (host === "localhost" || host === "127.0.0.1") ? "http" : "https";
    const url = new URL(event.path || "/mcp", `${protocol}://${host}`);
    const headers = buildRequestHeaders(event);
    let body: BodyInit | undefined;
    if (method === "POST") {
      const parsedBody: unknown = await readBody(event);
      const serialized = typeof parsedBody === "string" ? parsedBody : JSON.stringify(parsedBody ?? {});
      body = serialized;
      if (!headers.has("content-type")) headers.set("content-type", "application/json");
    }

    const request = new Request(url, {
      method,
      headers,
      ...(body !== undefined ? { body } : {}),
    });
    const server = createPersistedMcpServer({ userId: auth.userId, scopes: auth.scopes });
    const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    await server.connect(transport);
    const response = await transport.handleRequest(request);
    return withCors(response, origin);
  } catch (error) {
    console.error("[mcp] Request failed:", error instanceof Error ? error.message : "unknown error");
    return jsonRpcError(500, -32603, "MCP request failed.", origin);
  }
});
