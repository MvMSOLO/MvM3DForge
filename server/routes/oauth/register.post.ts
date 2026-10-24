import { defineEventHandler, readBody, setHeader, setResponseStatus } from "h3";
import { registerMcpOAuthClient } from "../../utils/mcp-oauth.ts";

export default defineEventHandler(async (event) => {
  setHeader(event, "Cache-Control", "no-store");
  setHeader(event, "Access-Control-Allow-Origin", "*");
  try {
    const body = await readBody(event);
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      setResponseStatus(event, 400);
      return { error: "invalid_client_metadata", error_description: "A JSON client metadata object is required." };
    }
    const client = await registerMcpOAuthClient(body);
    setResponseStatus(event, 201);
    return client;
  } catch (error) {
    setResponseStatus(event, 400);
    return {
      error: "invalid_client_metadata",
      error_description: error instanceof Error ? error.message : "Client registration failed.",
    };
  }
});
