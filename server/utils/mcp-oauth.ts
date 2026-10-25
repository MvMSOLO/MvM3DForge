import { getHeader } from "h3";
import type { H3Event } from "h3";
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

export function requestHeaders(event: H3Event): Headers {
  // Vercel's Nitro/Web adapter shape differs between local Node and production.
  // Read the complete Web Request headers first, then fall back to H3 and the
  // legacy Node adapter. Losing Cookie here creates an OAuth login loop.
  const headers = new Headers();
  const compatible = event as unknown as {
    req?: { headers?: Headers | Record<string, string | string[] | undefined> };
    web?: { request?: Request };
    runtime?: { node?: { req?: { headers?: Record<string, string | string[] | undefined> } } };
    node?: { req?: { headers?: Record<string, string | string[] | undefined> } };
  };

  const copyHeaders = (source: Headers | Record<string, string | string[] | undefined> | undefined) => {
    if (!source) return;
    if (typeof (source as Headers).forEach === "function") {
      (source as Headers).forEach((value, name) => {
        if (!headers.has(name)) headers.set(name, value);
      });
      return;
    }
    for (const [name, raw] of Object.entries(source)) {
      if (raw === undefined || headers.has(name)) continue;
      headers.set(name, Array.isArray(raw) ? raw.join(", ") : raw);
    }
  };

  copyHeaders(compatible.req?.headers);
  copyHeaders(compatible.web?.request?.headers);
  copyHeaders(compatible.runtime?.node?.req?.headers);
  copyHeaders(compatible.node?.req?.headers);

  for (const name of [
    "authorization",
    "cookie",
    "origin",
    "host",
    "user-agent",
    "referer",
    "x-forwarded-host",
    "x-forwarded-proto",
    "content-type",
  ]) {
    if (headers.has(name)) continue;
    const value = getHeader(event, name);
    if (value) headers.set(name, value);
  }
  return headers;
}

export function isSameOriginConsentRequest(event: H3Event): boolean {
  const headers = requestHeaders(event);
  const origin = headers.get("origin");
  // Browsers normally send Origin for a form POST. When it is absent (some
  // embedded clients omit it), retain the existing fallback; session + one-time
  // PKCE values are still validated by the consent handler.
  if (!origin) return true;

  try {
    const parsed = new URL(origin);
    if (parsed.protocol !== "https:" || parsed.username || parsed.password ||
        parsed.pathname !== "/" || parsed.search || parsed.hash) return false;

    // Vercel can expose the public alias in x-forwarded-host while the adapter's
    // Host header contains the deployment hostname. Comparing only Host caused
    // legitimate same-origin consent POSTs to be rejected on some deployments.
    const asOrigin = (value: string | null | undefined): string | null => {
      const candidate = value?.split(",")[0]?.trim();
      if (!candidate) return null;
      try {
        const normalized = new URL(candidate.includes("://") ? candidate : `https://${candidate}`);
        if (normalized.protocol !== "https:" || normalized.username || normalized.password ||
            normalized.pathname !== "/" || normalized.search || normalized.hash) return null;
        return normalized.origin.toLowerCase();
      } catch {
        return null;
      }
    };

    const allowedOrigins = new Set<string>();
    for (const candidate of [
      headers.get("x-forwarded-host"),
      headers.get("host"),
      process.env.VERCEL_URL,
      process.env.VERCEL_BRANCH_URL,
      process.env.VERCEL_PROJECT_PRODUCTION_URL,
      mcpPublicBaseUrl(),
    ]) {
      const normalized = asOrigin(candidate);
      if (normalized) allowedOrigins.add(normalized);
    }
    return allowedOrigins.has(parsed.origin.toLowerCase());
  } catch {
    return false;
  }
}

export async function getMcpOAuthSession(event: H3Event): Promise<{ id: string; name: string } | null> {
  const headers = requestHeaders(event);
  try {
    const session = await auth.api.getSession({ headers });
    if (!session?.user?.id) {
      // Log only presence metadata, never session cookies, tokens, or user IDs.
      console.warn("[mcp-oauth] authorize session missing", {
        host: headers.get("x-forwarded-host") || headers.get("host") || "unknown",
        hasCookieHeader: Boolean(headers.get("cookie")),
        hasSessionCookie: /(?:^|;\s*)__Host-grok-auth\.session_token=/.test(headers.get("cookie") || ""),
      });
      return null;
    }
    return {
      id: session.user.id,
      name: typeof session.user.name === "string" && session.user.name.trim() ? session.user.name.trim() : "MVM3D user",
    };
  } catch (error) {
    console.error("[mcp-oauth] authorize session lookup failed", {
      message: error instanceof Error ? error.message : "Unknown session lookup error",
      hasCookieHeader: Boolean(headers.get("cookie")),
    });
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
