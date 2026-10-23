import { createHash } from "node:crypto";

export const MCP_SCOPES = ["project:read", "scene:write", "scene:execute", "assets:export"] as const;
export type McpScope = (typeof MCP_SCOPES)[number];

export function hashMcpApiKey(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export function normalizeMcpScopes(value: unknown): McpScope[] {
  if (!Array.isArray(value)) throw new Error("scopes must be an array.");
  const scopes = [...new Set(value)];
  if (scopes.length < 1 || scopes.some((scope) => typeof scope !== "string" || !MCP_SCOPES.includes(scope as McpScope))) {
    throw new Error("Select one or more supported scopes.");
  }
  return scopes as McpScope[];
}
