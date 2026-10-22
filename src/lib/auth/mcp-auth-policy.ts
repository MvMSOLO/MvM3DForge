export interface McpAuthPolicyInput {
  hasToken: boolean;
  authConfigured: boolean;
  nodeEnv?: string;
  requireMcpAuth?: string;
}

/**
 * Development identity is deliberately restricted to local, unauthenticated
 * development. Deployed environments must fail closed, even if auth is
 * accidentally disabled or REQUIRE_MCP_AUTH is omitted.
 */
export function allowMcpDevelopmentFallback(input: McpAuthPolicyInput): boolean {
  return (
    !input.hasToken &&
    input.nodeEnv !== "production" &&
    !input.authConfigured &&
    !input.requireMcpAuth?.trim()
  );
}

/** Missing/empty owner IDs are never evidence of project ownership. */
export function ownsMcpProject(userId: string, projectOwnerId?: string): boolean {
  return Boolean(userId && projectOwnerId && userId === projectOwnerId);
}
