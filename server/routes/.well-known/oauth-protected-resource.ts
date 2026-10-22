import { defineEventHandler, setHeader } from "h3";

export default defineEventHandler((event) => {
  setHeader(event, "Content-Type", "application/json");
  setHeader(event, "Access-Control-Allow-Origin", "*");

  return {
    resource: "https://mvm3dforge.vercel.app/mcp",
    authorization_servers: ["https://mvm3dforge.vercel.app"],
    scopes_supported: ["project:read", "scene:write", "assets:export"],
    bearer_methods_supported: ["header"],
    resource_documentation: "https://mvm3dforge.vercel.app/studio",
  };
});
