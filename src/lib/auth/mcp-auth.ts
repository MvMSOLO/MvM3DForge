import type { H3Event } from "h3";
import { getHeader } from "h3";
import { getSessionUser, DEV_USER_ID, authConfigured } from "./verify.server";

export interface McpAuthResult {
  authenticated: boolean;
  userId: string;
  scopes: string[];
  error?: string;
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
      // Fall through if token verification fails
    }
  }

  if (!authConfigured && !process.env.REQUIRE_MCP_AUTH) {
    return {
      authenticated: true,
      userId: DEV_USER_ID,
      scopes: ["project:read", "scene:write", "assets:export"],
    };
  }

  if (token) {
    return {
      authenticated: false,
      userId: "",
      scopes: [],
      error: "Invalid or expired Bearer token.",
    };
  }

  return {
    authenticated: true,
    userId: DEV_USER_ID,
    scopes: ["project:read", "scene:write", "assets:export"],
  };
}

export function verifyProjectOwnership(userId: string, projectOwnerId?: string): boolean {
  if (!projectOwnerId || projectOwnerId === userId || userId === DEV_USER_ID) {
    return true;
  }
  return false;
}

export function checkScopePermission(scopes: string[], requiredScope: string): boolean {
  return scopes.includes(requiredScope) || scopes.includes("*");
}
