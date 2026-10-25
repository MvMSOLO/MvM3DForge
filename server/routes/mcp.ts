import { defineEventHandler, getHeader, getMethod, readBody } from "h3";
import type { H3Event } from "h3";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { createPersistedMcpServer } from "@/forge/remote-mcp-server";
import { validateMcpRequestAuth } from "@/lib/auth/mcp-auth";
import { mcpPublicBaseUrl } from "@/lib/mcp/oauth-config";
import { inspectDatabaseReadiness } from "@/lib/db-readiness.server";

import {
  isAllowedMcpHost,
  isAllowedMcpRequestOrigin,
  resolveMcpRequestHost,
} from "@/lib/mcp/origin-policy";

function getRequestHost(event: H3Event): string {
  return resolveMcpRequestHost(
    getHeader(event, "x-forwarded-host"),
    getHeader(event, "host"),
  ) ?? "";
}

function originAllowed(event: H3Event): boolean {
  const headers = requestHeaders(event);
  return isAllowedMcpRequestOrigin({
    origin: headers.get("origin"),
    forwardedHost: headers.get("x-forwarded-host"),
    host: headers.get("host"),
    forwardedProto: headers.get("x-forwarded-proto"),
  }, process.env);
}

function hostAllowed(event: H3Event): boolean {
  return isAllowedMcpHost(getRequestHost(event), process.env);
}

function withCors(response: Response, origin?: string | null): Response {
  const headers = new Headers(response.headers);
  if (origin === null) {
    headers.delete("Access-Control-Allow-Origin");
  } else {
    headers.set("Access-Control-Allow-Origin", origin === undefined ? "*" : origin);
  }
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
      return jsonRpcError(403, -32003, "Origin or host is not allowed.", null);
    }
    return withCors(new Response(null, { status: 204 }), origin);
  }

  if (!hostAllowed(event)) return jsonRpcError(403, -32003, "Untrusted Host header.", null);
  if (!originAllowed(event)) {
    return jsonRpcError(403, -32003, "Origin is not allowed. Configure MCP_ALLOWED_ORIGINS for trusted browser clients.", null);
  }
  if (!["GET", "POST", "DELETE"].includes(method)) {
    return jsonRpcError(405, -32000, "Method not allowed.", origin, { Allow: "GET, POST, DELETE, OPTIONS" });
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
    const forwardedProto = getHeader(event, "x-forwarded-proto")?.split(",", 1)[0]?.trim().toLowerCase();
    const isLoopbackHost = /^(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/.test(host);
    const protocol = forwardedProto === "http" && isLoopbackHost ? "http" : "https";
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
