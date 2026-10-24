import { getHeader } from "h3";
import type { H3Event } from "h3";
import type { IncomingMessage } from "node:http";
import { auth } from "@/lib/auth/server";
import { MCP_OAUTH_SCOPES, isSafeOAuthRedirectUri, mcpPublicBaseUrl, mcpResourceUrl, normalizeOAuthScopes, resolveMcpOAuthClient } from "@/lib/mcp/oauth.server";

export { MCP_OAUTH_SCOPES, isSafeOAuthRedirectUri, mcpPublicBaseUrl, mcpResourceUrl, normalizeOAuthScopes, resolveMcpOAuthClient };

export function oauthResponseHeaders(event?: H3Event): void {
  if (!event) return;
  event.node.res.setHeader("Cache-Control", "no-store");
  event.node.res.setHeader("Pragma", "no-cache");
  event.node.res.setHeader("X-Content-Type-Options", "nosniff");
}

function incomingRequest(event: H3Event): IncomingMessage | undefined {
  // Nitro 3 / H3 v2 exposes native Node handles under event.runtime.node;
  // older H3 adapters expose them at event.node.
  const compatible = event as H3Event & {
    runtime?: { node?: { req?: IncomingMessage } };
    node?: { req?: IncomingMessage };
  };
  return compatible.runtime?.node?.req ?? compatible.node?.req;
}

export function requestHeaders(event: H3Event): Headers {
  const headers = new Headers();
  const request = incomingRequest(event);
  for (const [name, raw] of Object.entries(request?.headers ?? {})) {
    if (raw === undefined) continue;
    headers.set(name, Array.isArray(raw) ? raw.join(", ") : raw);
  }
  return headers;
}

export function isSameOriginConsentRequest(event: H3Event): boolean {
  const headers = requestHeaders(event);
  const origin = headers.get("origin");
  if (!origin) return true;
  try {
    const parsed = new URL(origin);
    const host = (headers.get("host") || "").toLowerCase().split(":")[0];
    return parsed.protocol === "https:" && parsed.hostname.toLowerCase() === host &&
      parsed.username === "" && parsed.password === "";
  } catch {
    return false;
  }
}

export async function getMcpOAuthSession(event: H3Event): Promise<{ id: string; name: string } | null> {
  try {
    const session = await auth.api.getSession({ headers: requestHeaders(event) });
    if (!session?.user?.id) return null;
    return {
      id: session.user.id,
      name: typeof session.user.name === "string" && session.user.name.trim() ? session.user.name.trim() : "MVM3D user",
    };
  } catch {
    return null;
  }
}

export function htmlEscape(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[character] ?? character);
}

export function createAuthorizationHtml(input: {
  clientName: string;
  scopeNames: string[];
  params: Record<string, string>;
  userName: string;
}): string {
  const hidden = Object.entries(input.params)
    .map(([key, value]) => `<input type="hidden" name="${htmlEscape(key)}" value="${htmlEscape(value)}">`)
    .join("");
  const scopes = input.scopeNames.map((scope) => `<li>${htmlEscape(scope)}</li>`).join("");
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Connect to MVM3D</title><style>
*{box-sizing:border-box}body{margin:0;background:#081018;color:#eaf2f8;font:15px/1.5 system-ui,-apple-system,sans-serif;display:grid;min-height:100vh;place-items:center;padding:24px}
main{width:min(100%,480px);padding:28px;border:1px solid #293744;border-radius:20px;background:linear-gradient(145deg,#111d28,#0b121a);box-shadow:0 24px 90px #0008}
.brand{font-size:12px;letter-spacing:.18em;color:#7debc8;font-weight:800}h1{font-size:27px;line-height:1.15;letter-spacing:-.04em;margin:16px 0 8px}p{color:#a4b4c3}.client{color:#7debc8;font-weight:700;overflow-wrap:anywhere}.scopes{border:1px solid #263643;border-radius:12px;padding:14px 18px;background:#070d13}.scopes li{margin:6px 0;color:#d3e0eb}.who{font-size:12px;margin:18px 0}.buttons{display:flex;gap:10px;margin-top:20px}.buttons button{border-radius:10px;padding:12px 15px;font-weight:700;cursor:pointer;border:1px solid #324555}.allow{flex:1;background:#7debc8;color:#071511;border-color:#7debc8!important}.deny{background:transparent;color:#eaf2f8}
</style></head><body><main><div class="brand">MVM 3D FORGE</div><h1>Connect your AI client?</h1><p><span class="client">${htmlEscape(input.clientName)}</span> is requesting access to your MVM3D workspace.</p><div class="scopes"><strong>Requested permissions</strong><ul>${scopes}</ul></div><p class="who">Signed in as ${htmlEscape(input.userName)}. Only grant access to clients you trust.</p><form action="/oauth/consent" method="post">${hidden}<div class="buttons"><button class="deny" name="decision" value="deny" type="submit">Deny</button><button class="allow" name="decision" value="allow" type="submit">Approve access</button></div></form></main></body></html>`;
}

export async function readFormBody(event: H3Event): Promise<Record<string, string>> {
  const type = (getHeader(event, "content-type") || "").split(";")[0].trim().toLowerCase();
  if (type === "application/x-www-form-urlencoded") {
    const { readRawBody } = await import("h3");
    const raw = await readRawBody(event, "utf8");
    const form = new URLSearchParams(typeof raw === "string" ? raw : "");
    return Object.fromEntries(form.entries());
  }
  const { readBody } = await import("h3");
  const body = await readBody(event);
  if (!body || typeof body !== "object" || Array.isArray(body)) return {};
  return Object.fromEntries(Object.entries(body).map(([key, value]) => [key, String(value)]));
}

export async function getRegisteredClient(clientId: string) {
  return resolveMcpOAuthClient(clientId);
}
