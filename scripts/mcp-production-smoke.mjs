import assert from "node:assert/strict";

const origin = new URL(process.env.MCP_SMOKE_ORIGIN || "https://mvm3d.vercel.app");
assert.equal(origin.protocol, "https:", "MCP_SMOKE_ORIGIN must use HTTPS");
assert.equal(origin.pathname, "/", "MCP_SMOKE_ORIGIN must be an origin, not a path");
const base = origin.origin;

async function request(path, init = {}) {
  return fetch(new URL(path, base), {
    ...init,
    signal: AbortSignal.timeout(15_000),
  });
}

function pass(name) {
  console.log(`[mcp-production-smoke] PASS ${name}`);
}

const metadataResponse = await request("/.well-known/oauth-authorization-server", {
  headers: { accept: "application/json" },
});
assert.equal(metadataResponse.status, 200, "OAuth authorization-server metadata must return 200");
const metadata = await metadataResponse.json();
assert.equal(metadata.issuer, base, "OAuth issuer must match the production origin");
assert.equal(metadata.authorization_endpoint, `${base}/oauth/authorize`);
assert.equal(metadata.token_endpoint, `${base}/oauth/token`);
assert.equal(metadata.registration_endpoint, `${base}/oauth/register`);
assert.equal(metadata.resource, `${base}/mcp`);
assert.ok(metadata.code_challenge_methods_supported?.includes("S256"), "OAuth must advertise PKCE S256");
pass("authorization-server discovery");

const resourceResponse = await request("/.well-known/oauth-protected-resource/mcp", {
  headers: { accept: "application/json" },
});
assert.equal(resourceResponse.status, 200, "Protected-resource metadata must return 200");
const resource = await resourceResponse.json();
assert.equal(resource.resource, `${base}/mcp`);
assert.ok(resource.authorization_servers?.includes(base), "Resource metadata must name this OAuth issuer");
assert.ok(resource.bearer_methods_supported?.includes("header"));
pass("protected-resource discovery");

const loginResponse = await request("/login", { headers: { accept: "text/html" } });
assert.equal(loginResponse.status, 200, "Login route must be reachable");
assert.match(loginResponse.headers.get("content-type") || "", /text\/html/i);
assert.ok((await loginResponse.text()).length > 500, "Login HTML must not be empty");
pass("login route availability");

const authorizeResponse = await request("/oauth/authorize", {
  headers: { accept: "application/json" },
});
assert.equal(authorizeResponse.status, 400, "An incomplete authorize request must be rejected safely");
const authorizeBody = await authorizeResponse.json();
assert.equal(authorizeBody.error, "invalid_request");
pass("authorize rejects incomplete request");

// Credential-free negative check: the consent route must reject an attacker
// origin before reading the form, session, database, or issuing a code.
const foreignConsentResponse = await request("/oauth/consent", {
  method: "POST",
  headers: {
    origin: "https://attacker.example",
    "content-type": "application/x-www-form-urlencoded",
  },
  body: "decision=allow",
});
assert.equal(foreignConsentResponse.status, 403, "foreign-origin consent POST must be rejected");
assert.doesNotMatch(
  foreignConsentResponse.headers.get("access-control-allow-origin") || "",
  /attacker\.example/i,
  "a rejected origin must never be reflected in CORS headers",
);
assert.match(await foreignConsentResponse.text(), /untrusted origin/i);
pass("foreign-origin OAuth consent rejected without reflecting Origin");

for (const path of ["/oauth/register", "/oauth/token", "/mcp"]) {
  const response = await request(path, {
    method: "OPTIONS",
    headers: { origin: base, "access-control-request-method": "POST" },
  });
  assert.equal(response.status, 204, `OPTIONS ${path} must return 204`);
  assert.ok(response.headers.get("access-control-allow-methods"), `OPTIONS ${path} must describe allowed methods`);
}
pass("CORS preflight for register, token, and MCP");

const mcpResponse = await request("/mcp", {
  method: "POST",
  headers: {
    origin: base,
    "content-type": "application/json",
    accept: "application/json, text/event-stream",
  },
  body: JSON.stringify({
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "mvm3d-production-smoke", version: "1.0.0" },
    },
  }),
});
assert.equal(
  mcpResponse.status,
  401,
  "An unauthenticated MCP initialize request must be rejected with 401 (not 403/500/503)",
);
const challenge = mcpResponse.headers.get("www-authenticate") || "";
assert.match(challenge, /Bearer/i, "MCP 401 must include a Bearer challenge");
assert.ok(
  challenge.includes(`${base}/.well-known/oauth-protected-resource/mcp`),
  "MCP 401 must point AI clients to the protected-resource metadata",
);
const mcpBody = await mcpResponse.json();
assert.equal(mcpBody.jsonrpc, "2.0");
assert.ok(mcpBody.error, "MCP unauthenticated request must return a JSON-RPC error");
pass("MCP authentication boundary and OAuth challenge");

console.log("[mcp-production-smoke] All production smoke checks passed. No credentials or data mutations were used.");
