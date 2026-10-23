import { createFileRoute } from "@tanstack/react-router";
import { auth } from "@/lib/auth/server";
import { createMcpApiKey, listMcpApiKeys, revokeMcpApiKey } from "@/lib/mcp/api-keys.server";
function json(data: unknown, status = 200): Response {
  return Response.json(data, { status, headers: { "cache-control": "no-store" } });
}
async function signedInUserId(request: Request): Promise<string | null> {
  const session = await auth.api.getSession({ headers: request.headers });
  return session?.user?.id ?? null;
}
function isSameOriginMutation(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) return false;
  const fetchSite = request.headers.get("sec-fetch-site");
  return !fetchSite || fetchSite === "same-origin" || fetchSite === "none";
}
async function parseBody(request: Request): Promise<Record<string, unknown> | null> {
  if (Number(request.headers.get("content-length") || 0) > 32_000) return null;
  const text = await request.text();
  if (text.length > 32_000) return null;
  try {
    const value: unknown = JSON.parse(text);
    return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
  } catch { return null; }
}
export const Route = createFileRoute("/api/mcp-keys")({
  server: { handlers: {
    GET: async ({ request }) => {
      try {
        const userId = await signedInUserId(request);
        if (!userId) return json({ error: "Unauthorized. Sign in before managing MCP keys." }, 401);
        return json({ keys: await listMcpApiKeys(userId) });
      } catch (error) {
        return json({ error: error instanceof Error ? error.message : "Could not list MCP keys." }, 500);
      }
    },
    POST: async ({ request }) => {
      if (!isSameOriginMutation(request)) return json({ error: "Cross-origin request rejected." }, 403);
      try {
        const userId = await signedInUserId(request);
        if (!userId) return json({ error: "Unauthorized. Sign in before creating an MCP key." }, 401);
        const body = await parseBody(request);
        if (!body) return json({ error: "Expected a small JSON object." }, 400);
        if (typeof body.name !== "string" || body.name.trim().length < 2 || body.name.length > 80) return json({ error: "Key name must contain 2 to 80 characters." }, 400);
        if (!Array.isArray(body.scopes)) return json({ error: "Select one or more scopes." }, 400);
        const expiresInDays = body.expiresInDays == null ? null : Number(body.expiresInDays);
        const created = await createMcpApiKey(userId, { name: body.name, scopes: body.scopes, expiresInDays });
        return json(created, 201);
      } catch (error) {
        return json({ error: error instanceof Error ? error.message : "Could not create MCP key." }, 400);
      }
    },
    DELETE: async ({ request }) => {
      if (!isSameOriginMutation(request)) return json({ error: "Cross-origin request rejected." }, 403);
      try {
        const userId = await signedInUserId(request);
        if (!userId) return json({ error: "Unauthorized. Sign in before revoking an MCP key." }, 401);
        const id = new URL(request.url).searchParams.get("id");
        if (!id) return json({ error: "Missing API key id." }, 400);
        const revoked = await revokeMcpApiKey(userId, id);
        if (!revoked) return json({ error: "Key not found or already revoked." }, 404);
        return json({ ok: true });
      } catch (error) {
        return json({ error: error instanceof Error ? error.message : "Could not revoke MCP key." }, 500);
      }
    },
  } },
});
