import { defineEventHandler, getHeader, getMethod, readBody } from "h3";
import type { H3Event } from "h3";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { createPersistedMcpServer } from "@/forge/remote-mcp-server";
import { dbSource } from "@/lib/db";
import { validateMcpRequestAuth } from "@/lib/auth/mcp-auth";

const DEFAULT_ORIGIN = "https://mvm3d.vercel.app";
const DEFAULT_HOSTS = [
  "mvm3d.vercel.app",
  "mvm3d-mvmsolos-projects.vercel.app",
  "mvm3d-git-main-mvmsolos-projects.vercel.app",
];

function configuredList(value: string | undefined, fallback: string[]): string[] {
  const parsed = value?.split(",").map((item) => item.trim().toLowerCase()).filter(Boolean) ?? [];
  return parsed.length ? parsed : fallback;
}

function getRequestHost(event: H3Event): string {
  const host = getHeader(event, "host") || getHeader(event, "x-forwarded-host") || "";
  return host.toLowerCase().split(":")[0];
}

function originAllowed(event: H3Event): boolean {
  const origin = getHeader(event, "origin");
  if (!origin) return true;
  let parsed: URL;
  try {
    parsed = new URL(origin);
  } catch {
    return false;
  }
  if (parsed.protocol !== "https:" && parsed.hostname !== "localhost" && parsed.hostname !== "127.0.0.1") return false;
  const allowed = configuredList(process.env.MCP_ALLOWED_ORIGINS, [DEFAULT_ORIGIN]);
  return parsed.hostname.toLowerCase() === getRequestHost(event) || allowed.includes(parsed.origin.toLowerCase());
}

function hostAllowed(event: H3Event): boolean {
  const host = getRequestHost(event);
  const allowed = configuredList(process.env.MCP_ALLOWED_HOSTS, DEFAULT_HOSTS);
  const vercelProjectHost = host.startsWith("mvm3d-") && host.endsWith("-mvmsolos-projects.vercel.app");
  return Boolean(host) && (allowed.includes(host) || vercelProjectHost);
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

  // A serverless process-local database is not durable. Do not allow OAuth
  // registrations or project mutations to silently use ephemeral storage.
  if (process.env.NODE_ENV === "production" && dbSource !== "neon") {
    return jsonRpcError(503, -32000, "Remote MCP requires a persistent DATABASE_URL. Configure the production Postgres connection.", origin);
  }

  const auth = await validateMcpRequestAuth(event);
  if (!auth.authenticated) {
    if (auth.unavailable) return jsonRpcError(503, -32000, auth.error || "MCP authentication is temporarily unavailable.", origin);
    const resourceMetadata = "https://mvm3d.vercel.app/.well-known/oauth-protected-resource/mcp";
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
