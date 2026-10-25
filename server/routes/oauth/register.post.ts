import { defineEventHandler, readBody, setHeader, setResponseStatus } from "h3";
import { registerMcpOAuthClient } from "../../utils/mcp-oauth.ts";
import { inspectDatabaseReadiness } from "@/lib/db-readiness.server";

export default defineEventHandler(async (event) => {
  setHeader(event, "Cache-Control", "no-store");
  setHeader(event, "Access-Control-Allow-Origin", "*");
  setHeader(event, "Access-Control-Allow-Methods", "POST, OPTIONS");
  setHeader(event, "Access-Control-Allow-Headers", "Content-Type, Authorization");

  const readiness = await inspectDatabaseReadiness();
  if (!readiness.ok) {
    setResponseStatus(event, 503);
    return { error: "temporarily_unavailable", error_description: readiness.publicMessage };
  }
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
    const validationMessages = new Set([
      "redirect_uris must contain 1–12 valid HTTPS or loopback redirect URLs.",
      "Only authorization_code (optionally refresh_token) with PKCE and token_endpoint_auth_method=none is supported.",
      "The requested OAuth scope contains an unsupported permission.",
    ]);
    if (error instanceof Error && validationMessages.has(error.message)) {
      setResponseStatus(event, 400);
      return { error: "invalid_client_metadata", error_description: error.message };
    }
    const rawCode = error && typeof error === "object" && "code" in error ? error.code : undefined;
    const driverCode = typeof rawCode === "string" && /^[A-Za-z0-9_-]{2,16}$/.test(rawCode)
      ? rawCode
      : undefined;
    console.error("[mcp-oauth] client registration storage operation failed", {
      ...(driverCode ? { driverCode } : {}),
    });
    setResponseStatus(event, 503);
    return {
      error: "temporarily_unavailable",
      error_description: "The MCP registration service is temporarily unavailable.",
    };
  }
});
