import { createFileRoute } from "@tanstack/react-router";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { createPersistedMcpServer } from "@/forge/remote-mcp-server.ts";
import { authenticateMcpApiKey } from "@/lib/mcp/api-keys.server.ts";
import { verifyMcpOAuthAccessToken } from "@/lib/mcp/oauth.server.ts";
import { dbSource } from "@/lib/db.ts";
function corsHeaders(): Headers {
  return new Headers({
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET, POST, DELETE, OPTIONS",
    "access-control-allow-headers": "Authorization, Content-Type, Mcp-Session-Id, Mcp-Protocol-Version, Last-Event-Id",
    "access-control-expose-headers": "Mcp-Session-Id, Mcp-Protocol-Version",
    "cache-control": "no-store",
  });
}
function withCors(response: Response): Response {
  const headers = new Headers(response.headers);
  corsHeaders().forEach((value, key) => { if (key === "cache-control" || !headers.has(key)) headers.set(key, value); });
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}
async function handleMcp(request: Request): Promise<Response> {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders() });
  if (!["GET", "POST", "DELETE"].includes(request.method)) return withCors(Response.json({ error: "Method not allowed." }, { status: 405 }));
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
      return withCors(Response.json({ error: "MCP authentication service is temporarily unavailable." }, { status: 503 }));
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
    } catch {
      // A failed OAuth verification must not bypass authentication.
    }
  }

  if (process.env.NODE_ENV === "production" && dbSource !== "neon") {
    return withCors(Response.json(
      { error: "Remote MCP requires a persistent Postgres DATABASE_URL; the endpoint will not use ephemeral storage." },
      { status: 503 },
    ));
  }

  if (!userId) {
    const resourceMetadata = "https://mvm3d.vercel.app/.well-known/oauth-protected-resource/mcp";
    return withCors(Response.json(
      { error: "Authentication required. Connect through the MVM3D OAuth flow or use an MCP API key." },
      {
        status: 401,
        headers: {
          "www-authenticate": `Bearer realm="MvM 3D MCP", resource_metadata="${resourceMetadata}", error="invalid_token"`,
        },
      },
    ));
  }
  try {
    const server = createPersistedMcpServer({ userId, scopes });
    const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    await server.connect(transport);
    return withCors(await transport.handleRequest(request));
  } catch (error) {
    return withCors(Response.json({ error: (error instanceof Error ? error.message : "MCP request failed.").slice(0, 1000) }, { status: 500 }));
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
