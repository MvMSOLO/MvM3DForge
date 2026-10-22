import { defineEventHandler, getHeader, getQuery, readBody, setResponseStatus } from "h3";
import type { H3Event } from "h3";
import { auth, authConfigured } from "@/lib/auth/server";
import { dbSource } from "@/lib/db";
import { createMcpApiKey, listMcpApiKeys, revokeMcpApiKey, MCP_SCOPES } from "@/lib/mcp/api-keys.server";

function requestHeaders(event: H3Event): Headers {
  const headers = new Headers();
  const raw = event.node?.req?.headers ?? {};
  for (const [name, value] of Object.entries(raw)) {
    if (value == null) continue;
    headers.set(name, Array.isArray(value) ? value.join(", ") : String(value));
  }
  return headers;
}

async function signedInUserId(event: H3Event): Promise<string | null> {
  if (!authConfigured) return null;
  const session = await auth.api.getSession({ headers: requestHeaders(event) });
  return session?.user?.id ?? null;
}

function originIsAllowed(event: H3Event): boolean {
  const origin = getHeader(event, "origin");
  if (!origin) return true;
  const host = getHeader(event, "host") || getHeader(event, "x-forwarded-host");
  if (!host) return false;
  try {
    return new URL(origin).host.toLowerCase() === host.split(",")[0].trim().toLowerCase();
  } catch {
    return false;
  }
}

export default defineEventHandler(async (event) => {
  const method = (event.node?.req?.method || "GET").toUpperCase();
  setResponseStatus(event, 200);

  if (!originIsAllowed(event)) {
    setResponseStatus(event, 403);
    return { error: "Cross-origin API-key management is not allowed." };
  }
  if (process.env.NODE_ENV === "production" && dbSource !== "neon") {
    setResponseStatus(event, 503);
    return { error: "Persistent database is required for production MCP API keys. Configure DATABASE_URL." };
  }

  let userId: string | null = null;
  try {
    userId = await signedInUserId(event);
  } catch {
    userId = null;
  }
  if (!userId) {
    setResponseStatus(event, 401);
    return { error: "Sign in to manage MCP API keys." };
  }

  if (method === "GET") {
    try {
      const keys = await listMcpApiKeys(userId);
      return { keys, supportedScopes: MCP_SCOPES };
    } catch (error) {
      console.error("[mcp-keys] list failed:", error instanceof Error ? error.message : "unknown error");
      setResponseStatus(event, 503);
      return { error: "Could not load API keys. Verify the database connection and migration." };
    }
  }

  if (method === "POST") {
    let body: unknown;
    try {
      body = await readBody(event);
    } catch {
      setResponseStatus(event, 400);
      return { error: "Request body must be valid JSON." };
    }
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      setResponseStatus(event, 400);
      return { error: "Request body must be a JSON object." };
    }
    const input = body as Record<string, unknown>;
    try {
      const created = await createMcpApiKey(userId, {
        name: typeof input.name === "string" ? input.name : "",
        scopes: input.scopes,
        expiresInDays: input.expiresInDays == null ? null : Number(input.expiresInDays),
      });
      // Secret is returned once; only the hash is ever persisted.
      return {
        key: created.key,
        warning: "Copy this key now. It cannot be displayed again.",
        apiKey: created.record,
      };
    } catch (error) {
      setResponseStatus(event, 400);
      return { error: error instanceof Error ? error.message : "Could not create API key." };
    }
  }

  if (method === "DELETE") {
    const id = String(getQuery(event).id || "");
    if (!id || id.length > 100) {
      setResponseStatus(event, 400);
      return { error: "A valid key id query parameter is required." };
    }
    try {
      const revoked = await revokeMcpApiKey(userId, id);
      if (!revoked) {
        setResponseStatus(event, 404);
        return { error: "API key not found, already revoked, or not owned by this user." };
      }
      return { success: true, revokedId: id };
    } catch (error) {
      console.error("[mcp-keys] revoke failed:", error instanceof Error ? error.message : "unknown error");
      setResponseStatus(event, 503);
      return { error: "Could not revoke API key." };
    }
  }

  setResponseStatus(event, 405);
  return { error: "Method Not Allowed", allowed: ["GET", "POST", "DELETE"] };
});
