import { defineEventHandler, getHeader, readBody, setHeader, setResponseStatus } from "h3";
import type { H3Event } from "h3";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createPersistedMcpServer } from "@/forge/remote-mcp-server";
import { dbSource } from "@/lib/db";
import { validateMcpRequestAuth } from "@/lib/auth/mcp-auth";

const DEFAULT_ORIGIN = "https://mvm3dforge.vercel.app";
const DEFAULT_HOSTS = [
  "mvm3dforge.vercel.app",
  "mvm3dforge-mirzayevavazbek15-3491s-projects.vercel.app",
  "mvm3dforge-git-main-mirzayevavazbek15-3491s-projects.vercel.app",
];

function configuredList(value: string | undefined, fallback: string[]): string[] {
  const parsed = value?.split(",").map((item) => item.trim().toLowerCase()).filter(Boolean) ?? [];
  return parsed.length ? parsed : fallback;
}

function getRequestHost(event: H3Event): string {
  // Prefer the actual Host header; forwarded values are only a fallback behind a trusted proxy.
  const host = getHeader(event, "host") || getHeader(event, "x-forwarded-host") || "";
  return host.toLowerCase().split(":")[0];
}

function originAllowed(event: H3Event): boolean {
  const origin = getHeader(event, "origin");
  if (!origin) return true; // Server-to-server clients commonly omit Origin.
  let parsed: URL;
  try {
    parsed = new URL(origin);
  } catch {
    return false;
  }
  if (parsed.protocol !== "https:" && parsed.hostname !== "localhost" && parsed.hostname !== "127.0.0.1") return false;
  const allowed = configuredList(process.env.MCP_ALLOWED_ORIGINS, [DEFAULT_ORIGIN]);
  const requestHost = getRequestHost(event);
  return parsed.hostname.toLowerCase() === requestHost || allowed.includes(parsed.origin.toLowerCase());
}

function hostAllowed(event: H3Event): boolean {
  const host = getRequestHost(event);
  const allowed = configuredList(process.env.MCP_ALLOWED_HOSTS, DEFAULT_HOSTS);
  const vercelProjectHost = host.startsWith("mvm3dforge-") && host.endsWith("-mirzayevavazbek15-3491s-projects.vercel.app");
  return Boolean(host) && (allowed.includes(host) || vercelProjectHost);
}

function errorBody(code: number, message: string) {
  return { jsonrpc: "2.0", id: null, error: { code, message } };
}

export default defineEventHandler(async (event) => {
  const node = event.node;
  if (!node?.req || !node.res) {
    setResponseStatus(event, 500);
    return { error: "HTTP request context is unavailable." };
  }
  const req = node.req as unknown as IncomingMessage;
  const res = node.res as unknown as ServerResponse;
  const method = (req.method || "GET").toUpperCase();

  setHeader(event, "Vary", "Origin");
  setHeader(event, "Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  setHeader(event, "Access-Control-Allow-Headers", "Content-Type, Authorization, MCP-Protocol-Version, MCP-Session-Id, X-API-Key");
  setHeader(event, "Access-Control-Expose-Headers", "MCP-Protocol-Version, MCP-Session-Id");
  setHeader(event, "Cache-Control", "no-store");

  if (method === "OPTIONS") {
    if (!originAllowed(event) || !hostAllowed(event)) {
      setResponseStatus(event, 403);
      return { error: "Origin or host is not allowed." };
    }
    const origin = getHeader(event, "origin");
    if (origin) setHeader(event, "Access-Control-Allow-Origin", origin);
    setResponseStatus(event, 204);
    return "";
  }

  if (!hostAllowed(event)) {
    setResponseStatus(event, 403);
    return errorBody(-32003, "Untrusted Host header.");
  }
  if (!originAllowed(event)) {
    setResponseStatus(event, 403);
    return errorBody(-32003, "Origin is not allowed. Configure MCP_ALLOWED_ORIGINS for trusted browser clients.");
  }
  const origin = getHeader(event, "origin");
  if (origin) setHeader(event, "Access-Control-Allow-Origin", origin);

  if (method !== "POST" && method !== "GET") {
    setHeader(event, "Allow", "GET, POST, OPTIONS");
    setResponseStatus(event, 405);
    return errorBody(-32000, "Method not allowed.");
  }

  // A process-local embedded database resets across serverless instances. Do
  // not advertise a durable remote MCP API unless Neon/Postgres is configured.
  if (process.env.NODE_ENV === "production" && dbSource !== "neon") {
    setResponseStatus(event, 503);
    return errorBody(-32000, "Remote MCP requires a persistent DATABASE_URL. Configure the production Postgres connection.");
  }

  const auth = await validateMcpRequestAuth(event);
  if (!auth.authenticated) {
    if (auth.unavailable) {
      setResponseStatus(event, 503);
      return errorBody(-32000, auth.error || "MCP authentication is temporarily unavailable.");
    }
    setHeader(event, "WWW-Authenticate", 'Bearer realm="mvm3dforge-mcp", error="invalid_token"');
    setResponseStatus(event, 401);
    return errorBody(-32001, auth.error || "Authentication required.");
  }

  let server: McpServer | undefined;
  let transport: StreamableHTTPServerTransport | undefined;
  try {
    server = createPersistedMcpServer({ userId: auth.userId, scopes: auth.scopes });
    transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    await server.connect(transport);
    res.on("close", () => {
      void transport?.close().catch(() => undefined);
      void server?.close().catch(() => undefined);
    });

    // Passing parsedBody to the SDK prevents the transport and H3 from both
    // attempting to consume the same request stream.
    const body = method === "POST" ? await readBody(event) : undefined;
    await transport.handleRequest(req, res, body);
    return;
  } catch (error) {
    console.error("[mcp] Request failed:", error instanceof Error ? error.message : "unknown error");
    if (!res.headersSent) {
      res.writeHead(500, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
      res.end(JSON.stringify(errorBody(-32603, "MCP request failed.")));
    }
    return;
  }
});
