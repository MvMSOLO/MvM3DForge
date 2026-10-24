import { getHeader } from "h3";
import type { H3Event } from "h3";
import type { IncomingMessage } from "node:http";
import { auth } from "@/lib/auth/server";
import {
  createMcpOAuthCode,
  exchangeMcpOAuthCode,
  createMcpOAuthRefreshToken,
  exchangeMcpOAuthRefreshToken,
  issueMcpOAuthAccessToken,
  MCP_OAUTH_REFRESH_TOKEN_SECONDS,
  registerMcpOAuthClient,
} from "@/lib/mcp/oauth.server";
import type { McpOAuthScope } from "@/lib/mcp/oauth.server";
import {
  MCP_OAUTH_SCOPES,
  isSafeOAuthRedirectUri,
  mcpPublicBaseUrl,
  mcpResourceUrl,
  normalizeOAuthScopes,
  resolveMcpOAuthClient,
} from "@/lib/mcp/oauth.server";

export {
  MCP_OAUTH_SCOPES,
  isSafeOAuthRedirectUri,
  mcpPublicBaseUrl,
  mcpResourceUrl,
  normalizeOAuthScopes,
  resolveMcpOAuthClient,
  createMcpOAuthCode,
  exchangeMcpOAuthCode,
  createMcpOAuthRefreshToken,
  exchangeMcpOAuthRefreshToken,
  issueMcpOAuthAccessToken,
  MCP_OAUTH_REFRESH_TOKEN_SECONDS,
  registerMcpOAuthClient,
};
export type { McpOAuthScope };

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
  const hidden = Object.entries(input.params).map(([key, value]) => {
    const name = key === "scope" ? "requested_scope" : key;
    return '<input type="hidden" name="' + htmlEscape(name) + '" value="' + htmlEscape(value) + '">';
  }).join("");
  const details: Record<string, { title: string; description: string }> = {
    "project:read": { title: "View your 3D projects", description: "List and inspect your saved projects, objects, and scene data." },
    "scene:write": { title: "Create and edit scenes", description: "Create projects and make edits to scene objects." },
    "scene:execute": { title: "Run scene scripts", description: "Run scripts in the MVM3D sandbox and read diagnostics." },
    "assets:export": { title: "Export 3D assets", description: "Export an authorized scene as a GLB file." },
    "offline_access": { title: "Keep this connection active", description: "Allow the client to refresh its access token without another sign-in every hour." },
  };
  const checkboxes = input.scopeNames.map((scope) => {
    const item = details[scope] || { title: scope, description: "Permission requested by this AI client." };
    return '<label class="permission"><input type="checkbox" name="scope" value="' + htmlEscape(scope) + '" checked>' +
      '<span><strong>' + htmlEscape(item.title) + '</strong><small>' + htmlEscape(item.description) +
      '</small><code>' + htmlEscape(scope) + '</code></span></label>';
  }).join("");
  return [
    '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Connect to MVM3D</title><style>',
    '*{box-sizing:border-box}body{margin:0;background:#070c11;color:#eaf2f8;font:15px/1.5 system-ui,-apple-system,sans-serif;display:grid;min-height:100vh;place-items:center;padding:20px}',
    'main{width:min(100%,540px);padding:clamp(22px,5vw,30px);border:1px solid #293744;border-radius:22px;background:radial-gradient(circle at 90% 0%,#17332f 0,transparent 40%),linear-gradient(145deg,#111d28,#0b121a);box-shadow:0 24px 90px #0008}',
    '.brand{font-size:11px;letter-spacing:.18em;color:#83f0ce;font-weight:800}h1{font-size:28px;line-height:1.12;letter-spacing:-.04em;margin:18px 0 8px}p{color:#a4b4c3}.client{color:#83f0ce;font-weight:700;overflow-wrap:anywhere}.permissions{display:grid;gap:9px;margin:18px 0}.permission{display:flex;gap:12px;padding:13px;border:1px solid #263643;border-radius:13px;background:#070d13;cursor:pointer}.permission input{width:17px;height:17px;accent-color:#83f0ce;margin:3px 0 0;flex:none}.permission strong{display:block;font-size:13px}.permission small{display:block;color:#9aabb9;font-size:12px;margin-top:3px}.permission code{display:inline-block;color:#83dabe;font-size:10px;margin-top:5px}.who{font-size:12px;margin:18px 0}.buttons{display:flex;gap:10px;margin-top:20px}.buttons button{border-radius:10px;padding:12px 15px;font-weight:750;cursor:pointer;border:1px solid #324555}.allow{flex:1;background:#83f0ce;color:#071511;border-color:#83f0ce!important}.deny{background:transparent;color:#eaf2f8}.notice{font-size:11px;color:#7f93a3;margin-top:15px}',
    '</style></head><body><main><div class="brand">MVM 3D FORGE · SECURE CONNECTION</div>',
    '<h1>Connect your AI client?</h1><p><span class="client">' + htmlEscape(input.clientName) +
    '</span> is requesting access to your MVM3D workspace. Review each permission before continuing.</p>',
    '<form action="/oauth/consent" method="post">' + hidden + '<div class="permissions"><strong>Requested permissions</strong>' + checkboxes + '</div>',
    '<p class="who">Signed in as ' + htmlEscape(input.userName) +
    '. Your password is never shared with the AI client. You can disconnect this client later.</p>',
    '<div class="buttons"><button class="deny" name="decision" value="deny" type="submit">Deny</button><button class="allow" name="decision" value="allow" type="submit">Connect MVM3D</button></div></form>',
    '<p class="notice">Only selected permissions will be granted. Access is limited to your own workspace.</p></main></body></html>'
  ].join("");
}

export async function readFormBody(event: H3Event): Promise<Record<string, string>> {
  const type = (getHeader(event, "content-type") || "").split(";")[0].trim().toLowerCase();
  if (type === "application/x-www-form-urlencoded") {
    const { readRawBody } = await import("h3");
    const raw = await readRawBody(event, "utf8");
    const form = new URLSearchParams(typeof raw === "string" ? raw : "");
    const result: Record<string, string> = {};
    for (const key of new Set(Array.from(form.keys()))) {
      const values = form.getAll(key);
      result[key] = key === "scope" ? values.join(" ") : (values[values.length - 1] ?? "");
    }
    return result;
  }
  const { readBody } = await import("h3");
  const body = await readBody(event);
  if (!body || typeof body !== "object" || Array.isArray(body)) return {};
  return Object.fromEntries(Object.entries(body).map(([key, value]) => [key, String(value)]));
}

export async function getRegisteredClient(clientId: string) {
  return resolveMcpOAuthClient(clientId);
}
