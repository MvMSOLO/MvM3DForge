import { defineEventHandler, sendRedirect, setHeader, setResponseStatus } from "h3";
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
} from "../../utils/mcp-oauth.ts";

function errorPage(event: Parameters<Parameters<typeof defineEventHandler>[0]>[0], status: number, message: string) {
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
  if (!isSameOriginConsentRequest(event)) return errorPage(event, 403, "Cross-origin consent submissions are blocked.");

  let body: Record<string, string>;
  try {
    body = await readFormBody(event);
  } catch {
    return errorPage(event, 400, "The consent form could not be read.");
  }
  const clientId = body.client_id || "";
  const redirectUri = body.redirect_uri || "";
  const state = body.state || "";
  const challenge = body.code_challenge || "";
  const challengeMethod = body.code_challenge_method || "";
  const resource = body.resource || "";
  const scopes = normalizeOAuthScopes(body.scope);
  const client = await getRegisteredClient(clientId);

  if (!client || !isSafeOAuthRedirectUri(redirectUri) || !client.redirect_uris.includes(redirectUri) ||
      !state || state.length > 1024 || challengeMethod !== "S256" ||
      !/^[A-Za-z0-9_-]{43}$/.test(challenge) || !scopes ||
      (resource && resource !== mcpResourceUrl())) {
    return errorPage(event, 400, "The authorization request is invalid or has expired.");
  }

  if (body.decision !== "allow") {
    const callback = new URL(redirectUri);
    callback.searchParams.set("error", "access_denied");
    callback.searchParams.set("state", state);
    return sendRedirect(event, callback.toString(), 302);
  }

  const session = await getMcpOAuthSession(event);
  if (!session) {
    const search = new URLSearchParams({
      client_id: clientId, redirect_uri: redirectUri, response_type: "code", state,
      scope: scopes.join(" "), code_challenge: challenge, code_challenge_method: "S256",
    });
    if (resource) search.set("resource", resource);
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
    return sendRedirect(event, callback.toString(), 302);
  } catch {
    return errorPage(event, 503, "MVM3D could not issue an authorization code. Please retry.");
  }
});
