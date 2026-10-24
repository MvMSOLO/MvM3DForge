import { defineEventHandler, setHeader } from "h3";
import { MCP_OAUTH_SCOPES, mcpPublicBaseUrl, mcpResourceUrl } from "@/lib/mcp/oauth-config.ts";

export default defineEventHandler((event) => {
  setHeader(event, "Cache-Control", "public, max-age=300");
  setHeader(event, "Access-Control-Allow-Origin", "*");
  return {
    resource: mcpResourceUrl(),
    authorization_servers: [mcpPublicBaseUrl()],
    bearer_methods_supported: ["header"],
    scopes_supported: [...MCP_OAUTH_SCOPES],
  };
});
