import { defineEventHandler, getRequestURL, sendRedirect, setHeader, setResponseStatus } from "h3";
import type { H3Event } from "h3";
import {
  createAuthorizationHtml,
  getMcpOAuthSession,
  getRegisteredClient,
  MCP_OAUTH_SCOPES,
  mcpResourceUrl,
  normalizeOAuthScopes,
} from "../../utils/mcp-oauth.ts";

function badRequest(event: H3Event, message: string) {
  setResponseStatus(event, 400);
  setHeader(event, "Cache-Control", "no-store");
  return { error: "invalid_request", error_description: message };
}

export default defineEventHandler(async (event) => {
  setHeader(event, "Cache-Control", "no-store");
  const url = getRequestURL(event);
  const query = url.searchParams;
  const clientId = query.get("client_id") || "";
  const redirectUri = query.get("redirect_uri") || "";
  const state = query.get("state") || "";
  const responseType = query.get("response_type") || "";
  const challenge = query.get("code_challenge") || "";
  const challengeMethod = query.get("code_challenge_method") || "";
  const resource = query.get("resource") || "";
  const client = await getRegisteredClient(clientId);

  if (!client) return badRequest(event, "Unknown OAuth client_id.");
  if (responseType !== "code") return badRequest(event, "Only response_type=code is supported.");
  if (!redirectUri || !client.redirect_uris.includes(redirectUri)) {
    return badRequest(event, "redirect_uri must exactly match a registered client redirect URI.");
  }
  if (!state || state.length > 1024) return badRequest(event, "A state value between 1 and 1024 characters is required.");
  if (challengeMethod !== "S256" || !/^[A-Za-z0-9_-]{43}$/.test(challenge)) {
    return badRequest(event, "A valid PKCE code_challenge with code_challenge_method=S256 is required.");
  }
  if (resource && resource !== mcpResourceUrl()) return badRequest(event, "The requested resource does not match this MCP server.");
  const scopes = normalizeOAuthScopes(query.get("scope") || client.scope || MCP_OAUTH_SCOPES.join(" "));
  const registeredScopes = normalizeOAuthScopes(client.scope || MCP_OAUTH_SCOPES.join(" "));
  if (!scopes || !registeredScopes || scopes.some((scope) => !registeredScopes.includes(scope))) {
    return badRequest(event, "The requested OAuth scope is invalid or exceeds this client's registered permissions.");
  }
  // Make the account step visible before showing OAuth permissions.
  // This marker prevents a login -> authorize redirect loop.
  if (query.get("mvm3d_login_gate") !== "1") {
    const loginParams = new URLSearchParams(query);
    loginParams.set("mvm3d_login_gate", "1");
    const loginReturn = `${url.pathname}?${loginParams.toString()}`;
    return sendRedirect(event, `/login?next=${encodeURIComponent(loginReturn)}`, 302);
  }

  const current = `${url.pathname}${url.search}`;
  const session = await getMcpOAuthSession(event);
  if (!session) {
    return sendRedirect(event, `/login?next=${encodeURIComponent(current)}`, 302);
  }

  const params: Record<string, string> = {
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    state,
    scope: scopes.join(" "),
    code_challenge: challenge,
    code_challenge_method: "S256",
  };
  if (resource) params.resource = resource;
  if (query.get("prompt")) params.prompt = query.get("prompt")!.slice(0, 40);
  if (query.get("login_hint")) params.login_hint = query.get("login_hint")!.slice(0, 254);

  setHeader(event, "Content-Type", "text/html; charset=utf-8");
  setHeader(event, "Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'");
  return createAuthorizationHtml({
    clientName: client.client_name,
    scopeNames: scopes,
    params,
    userName: session.name,
  });
});
