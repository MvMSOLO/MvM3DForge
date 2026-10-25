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
  return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>MVM3D OAuth</title><body style="background:#081018;color:#eaf2f8;font:16px system-ui;padding:32px"><main style="max-width:620px;margin:8vh auto"><h1>Authorization not completed</h1><p>${safe}</p><p>Return to the AI client and retry Connect. If the problem persists, this screen now identifies the failure rather than silently doing nothing.</p><a style="color:#83f0ce" href="https://mvm3d.vercel.app">Return to MVM3D</a></main></body></html>`;
}

function redirectAfterPost(event: H3Event, location: string) {
  // Use H3's response helper so the adapter always emits a real Location header
  // and ends the form POST with an explicit Post/Redirect/Get response.
  setHeader(event, "Cache-Control", "no-store");
  return sendRedirect(event, location, 303);
}

function safeCallbackDescription(value: string) {
  try {
    const url = new URL(value);
    return { host: url.host, path: url.pathname };
  } catch {
    return { host: "invalid", path: "" };
  }
}

export default defineEventHandler(async (event) => {
  setHeader(event, "Cache-Control", "no-store");
  const startedAt = Date.now();
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
    console.warn("[mcp-oauth] consent rejected: origin mismatch", { originHost });
    return errorPage(event, 403, "This connection came from an untrusted origin. Restart Connect from the official MVM3D address.");
  }

  let body: Record<string, string>;
  try {
    body = await readFormBody(event);
  } catch (error) {
    console.error("[mcp-oauth] consent form parsing failed", {
      message: error instanceof Error ? error.message : "Unknown form parsing error",
    });
    return errorPage(event, 400, "The consent form could not be read. Return to the AI client and retry Connect.");
  }

  const clientId = body.client_id || "";
  const redirectUri = body.redirect_uri || "";
  const state = body.state || "";
  const challenge = body.code_challenge || "";
  const challengeMethod = body.code_challenge_method || "";
  const resource = body.resource || "";
  const requestedScopes = normalizeOAuthScopes(body.requested_scope);
  const scopes = body.scope?.trim() ? normalizeOAuthScopes(body.scope) : [];

  console.info("[mcp-oauth] consent form parsed", {
    decision: body.decision === "allow" || body.decision === "deny" ? body.decision : "missing",
    hasClientId: Boolean(clientId),
    hasRedirectUri: Boolean(redirectUri),
    ...safeCallbackDescription(redirectUri),
    hasState: Boolean(state),
    hasPkceChallenge: Boolean(challenge),
    requestedScopeCount: (body.requested_scope || "").split(/\\s+/).filter(Boolean).length,
    selectedScopeCount: (body.scope || "").split(/\\s+/).filter(Boolean).length,
  });

  let client;
  try {
    client = await getRegisteredClient(clientId);
    console.info("[mcp-oauth] consent client lookup completed", {
      found: Boolean(client),
      elapsedMs: Date.now() - startedAt,
    });
  } catch (error) {
    console.error("[mcp-oauth] consent client lookup threw", {
      message: error instanceof Error ? error.message : "Unknown client lookup error",
      elapsedMs: Date.now() - startedAt,
    });
    return errorPage(event, 503, "MVM3D could not verify this AI client. Retry Connect.");
  }

  if (!client || !isSafeOAuthRedirectUri(redirectUri) || !client.redirect_uris.includes(redirectUri) ||
      !state || state.length > 1024 || challengeMethod !== "S256" ||
      !/^[A-Za-z0-9_-]{43}$/.test(challenge) || !requestedScopes ||
      (resource && resource !== mcpResourceUrl())) {
    console.warn("[mcp-oauth] consent request rejected: validation failed", {
      knownClient: Boolean(client),
      safeRedirect: isSafeOAuthRedirectUri(redirectUri),
      redirectRegistered: Boolean(client?.redirect_uris.includes(redirectUri)),
      hasState: Boolean(state),
      stateLengthValid: state.length > 0 && state.length <= 1024,
      pkceValid: challengeMethod === "S256" && /^[A-Za-z0-9_-]{43}$/.test(challenge),
      requestedScopesValid: Boolean(requestedScopes),
      resourceValid: !resource || resource === mcpResourceUrl(),
    });
    return errorPage(event, 400, "The authorization request is invalid or has expired. Disconnect the old MVM3D connection and start a fresh Connect flow.");
  }

  if (body.decision === "allow" && (!scopes || !scopes.length || scopes.some((scope) => !requestedScopes.includes(scope)))) {
    console.warn("[mcp-oauth] consent rejected: invalid selected scopes", {
      selectedScopeCount: scopes?.length ?? 0,
      requestedScopeCount: requestedScopes.length,
    });
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
    console.info("[mcp-oauth] consent denied; redirecting to client", {
      callback: safeCallbackDescription(callback.toString()),
      elapsedMs: Date.now() - startedAt,
    });
    return redirectAfterPost(event, callback.toString());
  }

  let session;
  try {
    session = await getMcpOAuthSession(event);
    console.info("[mcp-oauth] consent session lookup completed", {
      found: Boolean(session),
      elapsedMs: Date.now() - startedAt,
    });
  } catch (error) {
    console.error("[mcp-oauth] consent session lookup threw", {
      message: error instanceof Error ? error.message : "Unknown session lookup error",
      elapsedMs: Date.now() - startedAt,
    });
    return errorPage(event, 503, "MVM3D could not verify your login session. Open MVM3D in the same browser and retry Connect.");
  }

  if (!session) {
    const search = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: "code",
      state,
      scope: scopes.join(" "),
      code_challenge: challenge,
      code_challenge_method: "S256",
      mvm3d_login_gate: "1",
    });
    if (resource) search.set("resource", resource);
    console.warn("[mcp-oauth] consent session missing; return to login", {
      elapsedMs: Date.now() - startedAt,
    });
    return redirectAfterPost(event, `/login?next=${encodeURIComponent("/oauth/authorize?" + search.toString())}`);
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

    console.info("[mcp-oauth] authorization code stored; redirecting to client", {
      callback: safeCallbackDescription(callback.toString()),
      scopeCount: scopes.length,
      elapsedMs: Date.now() - startedAt,
    });
    return redirectAfterPost(event, callback.toString());
  } catch (error) {
    console.error("[mcp-oauth] authorization-code issuance failed", {
      message: error instanceof Error ? error.message : "Unknown authorization-code error",
      elapsedMs: Date.now() - startedAt,
    });
    return errorPage(event, 503, "MVM3D could not issue an authorization code. Please retry Connect.");
  }
});
