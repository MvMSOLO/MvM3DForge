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
  const escapeHtml = (value: string) => value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[character] || character);
  const safe = escapeHtml(message);
  const safeHomeUrl = escapeHtml(mcpPublicBaseUrl());
  return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>MVM3D OAuth</title><body style="background:#081018;color:#eaf2f8;font:16px system-ui;padding:32px"><main style="max-width:620px;margin:8vh auto"><h1>Authorization not completed</h1><p>${safe}</p><p>Return to the AI client and retry Connect. If the problem persists, this screen now identifies the failure rather than silently doing nothing.</p><a style="color:#83f0ce" href="${safeHomeUrl}">Return to MVM3D</a></main></body></html>`;
}

function redirectAfterPost(event: H3Event, location: string) {
  // Some embedded OAuth webviews submit the consent form successfully but do not
  // surface the cross-origin 303 navigation. Return a same-origin handoff page:
  // it visibly confirms the click, navigates in the current window, and leaves a
  // working link if the embedded browser blocks automatic script navigation.
  setHeader(event, "Cache-Control", "no-store");
  setHeader(event, "Content-Type", "text/html; charset=utf-8");
  setHeader(event, "Referrer-Policy", "no-referrer");
  setHeader(event, "Content-Security-Policy", "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'");
  setResponseStatus(event, 200);

  const safeHref = location.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[character] || character);
  const jsLocation = JSON.stringify(location)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026");

  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Returning to AI client · MVM3D</title><style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#070c11;color:#eaf2f8;font:15px/1.5 system-ui,sans-serif;padding:20px;box-sizing:border-box}main{width:min(100%,480px);padding:28px;border:1px solid #293744;border-radius:20px;background:#101923;box-shadow:0 24px 90px #0008}h1{font-size:24px;margin:0 0 10px}p{color:#a4b4c3}a{display:block;margin-top:20px;padding:13px 16px;border-radius:10px;background:#83f0ce;color:#071511;text-align:center;font-weight:750;text-decoration:none}.muted{font-size:12px;color:#7f93a3}</style></head><body><main><h1>Approval received</h1><p>MVM3D is returning you to your AI client to finish the connection.</p><a href="${safeHref}" rel="noreferrer">Continue to AI client</a><p class="muted">If the client does not reopen automatically, use the button above once.</p></main><script>window.location.replace(${jsLocation});</script></body></html>`;
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
  const parsedScopes = body.scope?.trim() ? normalizeOAuthScopes(body.scope) : [];
  // Normalize invalid/missing scope input to an empty list; the approval path below rejects it.
  const scopes = parsedScopes ?? [];

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

  let code: string;
  try {
    code = await createMcpOAuthCode({
      clientId,
      userId: session.id,
      redirectUri,
      challenge,
      scopes,
    });
  } catch (error) {
    const details = error as { name?: unknown; code?: unknown; message?: unknown } | null;
    console.error("[mcp-oauth] authorization-code persistence failed", {
      errorName: typeof details?.name === "string" ? details.name.slice(0, 120) : "UnknownError",
      databaseErrorCode: typeof details?.code === "string" ? details.code.slice(0, 32) : null,
      message: error instanceof Error ? error.message.slice(0, 500) : "Unknown authorization-code persistence error",
      elapsedMs: Date.now() - startedAt,
    });
    return errorPage(event, 503, "MVM3D could not save the authorization code. Please retry Connect.");
  }

  try {
    const callback = new URL(redirectUri);
    callback.searchParams.set("code", code);
    callback.searchParams.set("state", state);
    callback.searchParams.set("iss", mcpPublicBaseUrl());

    console.info("[mcp-oauth] authorization code stored; redirecting to client", {
      callback: safeCallbackDescription(callback.toString()),
      selectedScopeCount: scopes.length,
      elapsedMs: Date.now() - startedAt,
    });
    return redirectAfterPost(event, callback.toString());
  } catch (error) {
    const details = error as { name?: unknown; code?: unknown; message?: unknown } | null;
    console.error("[mcp-oauth] authorization callback preparation failed", {
      errorName: typeof details?.name === "string" ? details.name.slice(0, 120) : "UnknownError",
      message: error instanceof Error ? error.message.slice(0, 500) : "Unknown authorization callback error",
      elapsedMs: Date.now() - startedAt,
    });
    return errorPage(event, 503, "MVM3D saved the authorization code but could not prepare the return to your AI client. Disconnect and reconnect MVM3D, then retry.");
  }
});
