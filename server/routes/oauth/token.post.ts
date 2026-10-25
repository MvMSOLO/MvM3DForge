import { defineEventHandler, setHeader, setResponseStatus } from "h3";
import type { H3Event } from "h3";
import type { McpOAuthScope } from "@/lib/mcp/oauth.server";
import {
  createMcpOAuthRefreshToken,
  exchangeMcpOAuthCode,
  exchangeMcpOAuthRefreshToken,
  issueMcpOAuthAccessToken,
  MCP_OAUTH_REFRESH_TOKEN_SECONDS,
  mcpResourceUrl,
  normalizeOAuthScopes,
  readFormBody,
  resolveMcpOAuthClient,
} from "../../utils/mcp-oauth.ts";

function oauthError(event: H3Event, status: number, error: string, description: string) {
  setResponseStatus(event, status);
  return { error, error_description: description };
}

export default defineEventHandler(async (event) => {
  setHeader(event, "Cache-Control", "no-store");
  setHeader(event, "Pragma", "no-cache");
  setHeader(event, "Access-Control-Allow-Origin", "*");
  setHeader(event, "Access-Control-Allow-Methods", "POST, OPTIONS");
  setHeader(event, "Access-Control-Allow-Headers", "Content-Type, Authorization");

  let body: Record<string, string>;
  try {
    body = await readFormBody(event);
  } catch {
    return oauthError(event, 400, "invalid_request", "Expected an application/x-www-form-urlencoded token request.");
  }
  if (!body.grant_type) return oauthError(event, 400, "invalid_request", "grant_type is required.");
  if (body.resource && body.resource !== mcpResourceUrl()) {
    return oauthError(event, 400, "invalid_target", "The resource must match this MCP server.");
  }
  if (!body.client_id) return oauthError(event, 400, "invalid_request", "client_id is required.");

  try {
    const client = await resolveMcpOAuthClient(body.client_id);
    if (!client) return oauthError(event, 400, "invalid_client", "This OAuth client is not registered. Reconnect the MCP server and choose automatic client registration.");

    let granted: { userId: string; scopes: McpOAuthScope[] } | null = null;
    if (body.grant_type === "authorization_code") {
      if (!client.grant_types.includes("authorization_code")) {
        return oauthError(event, 400, "unauthorized_client", "This client is not registered for authorization_code.");
      }
      if (!body.code || !body.redirect_uri || !body.code_verifier) {
        return oauthError(event, 400, "invalid_request", "code, redirect_uri and code_verifier are required.");
      }
      if (!client.redirect_uris.includes(body.redirect_uri)) {
        return oauthError(event, 400, "invalid_grant", "redirect_uri does not match the registered OAuth client.");
      }
      granted = await exchangeMcpOAuthCode({
        code: body.code,
        clientId: body.client_id,
        redirectUri: body.redirect_uri,
        verifier: body.code_verifier,
      });
      if (!granted) return oauthError(event, 400, "invalid_grant", "The authorization code is invalid, expired, already used, or failed PKCE verification.");
    } else if (body.grant_type === "refresh_token") {
      if (!client.grant_types.includes("refresh_token")) {
        return oauthError(event, 400, "unauthorized_client", "This client is not registered for refresh_token.");
      }
      if (!body.refresh_token) return oauthError(event, 400, "invalid_request", "refresh_token is required.");
      granted = await exchangeMcpOAuthRefreshToken({ refreshToken: body.refresh_token, clientId: body.client_id });
      if (!granted) return oauthError(event, 400, "invalid_grant", "The refresh token is invalid, expired, already used, or belongs to another client.");
    } else {
      return oauthError(event, 400, "unsupported_grant_type", "Only authorization_code and refresh_token are supported.");
    }

    const requestedScopes = body.scope ? normalizeOAuthScopes(body.scope) : granted.scopes;
    if (!requestedScopes || requestedScopes.some((scope) => !granted!.scopes.includes(scope))) {
      return oauthError(event, 400, "invalid_scope", "The token request cannot expand the scopes approved by the user.");
    }
    const accessToken = await issueMcpOAuthAccessToken(granted.userId, body.client_id, requestedScopes);
    const refreshToken = client.grant_types.includes("refresh_token") && requestedScopes.includes("offline_access")
      ? await createMcpOAuthRefreshToken(granted.userId, body.client_id, requestedScopes)
      : undefined;

    return {
      access_token: accessToken,
      token_type: "Bearer",
      expires_in: 3600,
      ...(refreshToken ? { refresh_token: refreshToken, refresh_token_expires_in: MCP_OAUTH_REFRESH_TOKEN_SECONDS } : {}),
      scope: requestedScopes.join(" "),
      ...(body.resource ? { resource: mcpResourceUrl() } : {}),
    };
  } catch {
    return oauthError(event, 503, "temporarily_unavailable", "The MCP token service is temporarily unavailable.");
  }
});
