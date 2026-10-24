import { defineEventHandler, setHeader } from "h3";
import { MCP_OAUTH_SCOPES, mcpPublicBaseUrl, mcpResourceUrl } from "../../utils/mcp-oauth.ts";

export default defineEventHandler(() => {
  const issuer = mcpPublicBaseUrl();
  setHeader("Cache-Control", "public, max-age=300");
  setHeader("Access-Control-Allow-Origin", "*");
  return {
    issuer,
    authorization_endpoint: `${issuer}/oauth/authorize`,
    token_endpoint: `${issuer}/oauth/token`,
    registration_endpoint: `${issuer}/oauth/register`,
    response_types_supported: ["code"],
    response_modes_supported: ["query"],
    grant_types_supported: ["authorization_code"],
    token_endpoint_auth_methods_supported: ["none"],
    code_challenge_methods_supported: ["S256"],
    scopes_supported: [...MCP_OAUTH_SCOPES],
    client_id_metadata_document_supported: true,
    authorization_response_iss_parameter_supported: true,
    service_documentation: `${issuer}/docs/mcp-client-setup`,
    resource: mcpResourceUrl(),
  };
});
