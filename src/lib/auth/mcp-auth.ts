import type { H3Event } from "h3";
import { getHeader } from "h3";
import { getSessionUser, DEV_USER_ID, authConfigured } from "./verify.server";
import { allowMcpDevelopmentFallback, ownsMcpProject } from "./mcp-auth-policy";

export interface McpAuthResult {
  authenticated: boolean;
  userId: string;
  scopes: string[];
  error?: string;
}

function unauthenticated(error: string): McpAuthResult {
  return { authenticated: false, userId: "", scopes: [], error };
}

export async function validateMcpRequestAuth(event: H3Event): Promise<McpAuthResult> {
  const authHeader =
    getHeader(event, "authorization") ||
    getHeader(event, "x-api-key") ||
    getHeader(event, "x-mcp-api-key");

  let token: string | undefined;
  if (authHeader) {
    if (authHeader.startsWith("Bearer ")) {
      token = authHeader.substring(7).trim();
    } else {
      token = authHeader.trim();
    }
  }

  // Never silently downgrade a malformed, expired, or invalid supplied token
  // into the shared development identity.
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
    return unauthenticated("Invalid or expired Bearer token or API key.");
  }

  // A shared dev identity is permitted only on a local, non-production
  // development server with auth intentionally disabled.
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

  return unauthenticated("Authentication required. Provide a valid session Bearer token or API key.");
}

export function verifyProjectOwnership(userId: string, projectOwnerId?: string): boolean {
  // Keep local demo scenes usable, but never apply this exemption in production.
  if (process.env.NODE_ENV !== "production" && userId === DEV_USER_ID) {
    return true;
  }
  return ownsMcpProject(userId, projectOwnerId);
}

export function checkScopePermission(scopes: string[], requiredScope: string): boolean {
  return scopes.includes(requiredScope) || scopes.includes("*");
}
