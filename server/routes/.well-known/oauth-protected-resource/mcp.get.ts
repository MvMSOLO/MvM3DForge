import { defineEventHandler, setHeader } from "h3";
import { MCP_OAUTH_SCOPES, mcpPublicBaseUrl, mcpResourceUrl } from "../../../utils/mcp-oauth.ts";

export default defineEventHandler(() => {
  setHeader("Cache-Control", "public, max-age=300");
  setHeader("Access-Control-Allow-Origin", "*");
  return {
    resource: mcpResourceUrl(),
    authorization_servers: [mcpPublicBaseUrl()],
    bearer_methods_supported: ["header"],
    scopes_supported: [...MCP_OAUTH_SCOPES],
  };
});
