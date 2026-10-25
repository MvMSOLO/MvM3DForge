import type { H3Event } from "h3";
import { getHeader } from "h3";
import { getSessionUser, DEV_USER_ID, authConfigured } from "./verify.server";
import { allowMcpDevelopmentFallback, ownsMcpProject } from "./mcp-auth-policy";
import { authenticateMcpApiKey } from "@/lib/mcp/api-keys.server";
import { verifyMcpOAuthAccessToken } from "@/lib/mcp/oauth.server";

export interface McpAuthResult {
  authenticated: boolean;
  userId: string;
  scopes: string[];
  apiKeyId?: string;
  unavailable?: boolean;
  error?: string;
}

function unauthenticated(error: string, unavailable = false): McpAuthResult {
  return { authenticated: false, userId: "", scopes: [], error, unavailable };
}

export async function validateMcpRequestAuth(event: H3Event): Promise<McpAuthResult> {
  const authHeader =
    getHeader(event, "authorization") ||
    getHeader(event, "x-api-key") ||
    getHeader(event, "x-mcp-api-key");

  let token: string | undefined;
  if (authHeader) {
    token = authHeader.startsWith("Bearer ")
      ? authHeader.substring(7).trim()
      : authHeader.trim();
  }

  // API keys are stored as hashes and are scoped to a specific user.
  if (token?.startsWith("mvmf_live_")) {
    try {
      const apiKey = await authenticateMcpApiKey(token);
      if (apiKey) {
        return {
          authenticated: true,
          userId: apiKey.userId,
          scopes: apiKey.scopes,
          apiKeyId: apiKey.keyId,
        };
      }
    } catch {
      // Database failures must not become an authentication bypass.
      return unauthenticated("API key verification is temporarily unavailable.", true);
    }
    return unauthenticated("Invalid, expired, or revoked API key.");
  }

  // OAuth access tokens are distinct from long-lived API keys and Better Auth sessions.
  // Verify issuer, audience, signature, expiry, and granted scopes before trusting them.
  if (token?.startsWith("mvm3d_oauth_")) {
    try {
      const oauth = await verifyMcpOAuthAccessToken(token);
      if (oauth) return { authenticated: true, userId: oauth.userId, scopes: oauth.scopes };
    } catch {
      // Verification errors must never fall through to another identity system.
    }
    return unauthenticated("Invalid or expired MCP OAuth access token.");
  }

  // A Better Auth bearer session can also be used by trusted integrations.
  if (token) {
    try {
      const user = await getSessionUser(token);
      if (user) {
        return {
          authenticated: true,
          userId: user.id,
          scopes: ["project:read", "scene:write", "assets:export"],
        };
      }
    } catch {
      // Treat verification errors as failed authentication.
    }
    return unauthenticated("Invalid or expired Bearer token.");
  }

  // A shared development identity is only permitted on local, non-production
  // servers with auth intentionally disabled.
  if (
    allowMcpDevelopmentFallback({
      hasToken: false,
      authConfigured,
      nodeEnv: process.env.NODE_ENV,
      requireMcpAuth: process.env.REQUIRE_MCP_AUTH,
    })
  ) {
    return {
      authenticated: true,
      userId: DEV_USER_ID,
      scopes: ["project:read", "scene:write", "assets:export"],
    };
  }

  return unauthenticated("Authentication required. Provide an MvM 3D Forge API key.");
}

export function verifyProjectOwnership(userId: string, projectOwnerId?: string): boolean {
  if (process.env.NODE_ENV !== "production" && userId === DEV_USER_ID) {
    return true;
  }
  return ownsMcpProject(userId, projectOwnerId);
}

export function checkScopePermission(scopes: string[], requiredScope: string): boolean {
  return scopes.includes(requiredScope) || scopes.includes("*");
}
