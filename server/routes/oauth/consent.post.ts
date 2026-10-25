import { defineEventHandler, sendRedirect, setHeader, setResponseStatus } from "h3";
import type { H3Event } from "h3";
import {
  createMcpOAuthCode,
  getMcpOAuthSession,
  getRegisteredClient,
  isSafeOAuthRedirectUri,
  isSameOriginConsentRequest,
  mcpPublicBaseUrl,
  mcpResourceUrl,
  normalizeOAuthScopes,
  readFormBody,
  requestHeaders,
} from "../../utils/mcp-oauth.ts";

function errorPage(event: H3Event, status: number, message: string) {
  setResponseStatus(event, status);
  setHeader(event, "Content-Type", "text/html; charset=utf-8");
  setHeader(event, "Cache-Control", "no-store");
  const safe = message.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[character] || character);
  return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>MVM3D OAuth</title><body style="background:#081018;color:#eaf2f8;font:16px system-ui;padding:32px"><h1>Authorization not completed</h1><p>${safe}</p><p>Return to MVM3D and try again.</p></body></html>`;
}

export default defineEventHandler(async (event) => {
  setHeader(event, "Cache-Control", "no-store");
  const requestHeadersForLog = requestHeaders(event);
  const originHost = (() => {
    try { return requestHeadersForLog.get("origin") ? new URL(requestHeadersForLog.get("origin")!).host : null; }
    catch { return "invalid-origin"; }
  })();
  console.info("[mcp-oauth] consent POST received", {
    method: event.method,
    host: requestHeadersForLog.get("x-forwarded-host") || requestHeadersForLog.get("host") || "unknown",
    originHost,
    hasCookieHeader: Boolean(requestHeadersForLog.get("cookie")),
    contentType: (requestHeadersForLog.get("content-type") || "").split(";")[0],
  });
  if (!isSameOriginConsentRequest(event)) {
    console.warn("[mcp-oauth] consent POST rejected by origin check", { originHost });
    return errorPage(event, 403, "This connection came from an untrusted origin. Restart Connect from the official MVM3D address.");
  }

  let body: Record<string, string>;
  try {
    body = await readFormBody(event);
  } catch (error) {
    console.error("[mcp-oauth] consent form parsing failed", {
      message: error instanceof Error ? error.message : "Unknown form parsing error",
      contentType: (requestHeadersForLog.get("content-type") || "").split(";")[0],
    });
    return errorPage(event, 400, "The consent form could not be read. Return to the AI client and retry Connect.");
  }
  console.info("[mcp-oauth] consent fields parsed", {
    decision: body.decision === "allow" || body.decision === "deny" ? body.decision : "missing",
    hasClientId: Boolean(body.client_id),
    hasRedirectUri: Boolean(body.redirect_uri),
    hasState: Boolean(body.state),
    hasPkceChallenge: Boolean(body.code_challenge),
    requestedScopeCount: (body.requested_scope || "").split(/\s+/).filter(Boolean).length,
    selectedScopeCount: (body.scope || "").split(/\s+/).filter(Boolean).length,
  });
  const clientId = body.client_id || "";
  const redirectUri = body.redirect_uri || "";
  const state = body.state || "";
  const challenge = body.code_challenge || "";
  const challengeMethod = body.code_challenge_method || "";
  const resource = body.resource || "";
  const requestedScopes = normalizeOAuthScopes(body.requested_scope);
  const scopes = body.scope?.trim() ? normalizeOAuthScopes(body.scope) : [];
  const client = await getRegisteredClient(clientId);

  if (!client || !isSafeOAuthRedirectUri(redirectUri) || !client.redirect_uris.includes(redirectUri) ||
      !state || state.length > 1024 || challengeMethod !== "S256" ||
      !/^[A-Za-z0-9_-]{43}$/.test(challenge) || !requestedScopes ||
      (resource && resource !== mcpResourceUrl())) {
    return errorPage(event, 400, "The authorization request is invalid or has expired.");
  }
  if (body.decision === "allow" && (!scopes || !scopes.length || scopes.some((scope) => !requestedScopes.includes(scope)))) {
    return errorPage(event, 400, "Select at least one permission and only permissions requested by this client.");
  }
  if (body.decision !== "allow" && Array.isArray(scopes) && scopes.some((scope) => !requestedScopes.includes(scope))) {
    return errorPage(event, 400, "The authorization request included an unrequested permission.");
  }

  if (body.decision !== "allow") {
    const callback = new URL(redirectUri);
    callback.searchParams.set("error", "access_denied");
    callback.searchParams.set("state", state);
    callback.searchParams.set("iss", mcpPublicBaseUrl());
    return sendRedirect(event, callback.toString(), 302);
  }

  const session = await getMcpOAuthSession(event);
  if (!session) {
    const search = new URLSearchParams({
      client_id: clientId, redirect_uri: redirectUri, response_type: "code", state,
      scope: scopes.join(" "), code_challenge: challenge, code_challenge_method: "S256",
    });
    if (resource) search.set("resource", resource);
    search.set("mvm3d_login_gate", "1");
    return sendRedirect(event, `/login?next=${encodeURIComponent("/oauth/authorize?" + search.toString())}`, 302);
  }

  try {
    const code = await createMcpOAuthCode({
      clientId,
      userId: session.id,
      redirectUri,
      challenge,
      scopes,
    });
    const callback = new URL(redirectUri);
    callback.searchParams.set("code", code);
    callback.searchParams.set("state", state);
    callback.searchParams.set("iss", mcpPublicBaseUrl());
    return sendRedirect(event, callback.toString(), 302);
  } catch (error) {
    // Keep the browser response generic, but make the real server-side cause observable.
    console.error("[mcp-oauth] Authorization-code issuance failed:", error instanceof Error ? error.stack || error.message : String(error));
    return errorPage(event, 503, "MVM3D could not issue an authorization code. Please retry.");
  }
});
