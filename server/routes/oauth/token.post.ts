import { defineEventHandler, setHeader, setResponseStatus } from "h3";
import {
  exchangeMcpOAuthCode,
  issueMcpOAuthAccessToken,
  mcpResourceUrl,
  normalizeOAuthScopes,
  readFormBody,
} from "../../utils/mcp-oauth.ts";

export default defineEventHandler(async (event) => {
  setHeader(event, "Cache-Control", "no-store");
  setHeader(event, "Pragma", "no-cache");
  setHeader(event, "Access-Control-Allow-Origin", "*");
  let body: Record<string, string>;
  try {
    body = await readFormBody(event);
  } catch {
    setResponseStatus(event, 400);
    return { error: "invalid_request", error_description: "Expected an application/x-www-form-urlencoded token request." };
  }

  if (body.grant_type !== "authorization_code") {
    setResponseStatus(event, 400);
    return { error: "unsupported_grant_type", error_description: "Only authorization_code is supported." };
  }
  if (!body.code || !body.client_id || !body.redirect_uri || !body.code_verifier) {
    setResponseStatus(event, 400);
    return { error: "invalid_request", error_description: "code, client_id, redirect_uri and code_verifier are required." };
  }
  if (body.resource && body.resource !== mcpResourceUrl()) {
    setResponseStatus(event, 400);
    return { error: "invalid_target", error_description: "The resource must match this MCP server." };
  }
  try {
    const granted = await exchangeMcpOAuthCode({
      code: body.code,
      clientId: body.client_id,
      redirectUri: body.redirect_uri,
      verifier: body.code_verifier,
    });
    if (!granted) {
      setResponseStatus(event, 400);
      return { error: "invalid_grant", error_description: "The authorization code is invalid, expired, already used, or failed PKCE verification." };
    }
    const requestedScopes = body.scope ? normalizeOAuthScopes(body.scope) : granted.scopes;
    if (!requestedScopes || requestedScopes.some((scope) => !granted.scopes.includes(scope))) {
      setResponseStatus(event, 400);
      return { error: "invalid_scope", error_description: "The token request cannot expand the scopes approved by the user." };
    }
    const accessToken = await issueMcpOAuthAccessToken(granted.userId, body.client_id, requestedScopes);
    return {
      access_token: accessToken,
      token_type: "Bearer",
      expires_in: 3600,
      scope: requestedScopes.join(" "),
      ...(body.resource ? { resource: mcpResourceUrl() } : {}),
    };
  } catch {
    setResponseStatus(event, 503);
    return { error: "temporarily_unavailable", error_description: "The MCP token service is temporarily unavailable." };
  }
});
