#!/usr/bin/env node
/**
 * End-to-end OAuth → MCP regression against a disposable local PostgreSQL DB.
 *
 * The test starts the real Vite/TanStack auth endpoint and mounts the repository's
 * actual Nitro OAuth/MCP route handlers in a local H3 server. This exercises the
 * same account, consent, code, token, and MCP handlers without contacting or
 * mutating Production. It refuses non-loopback URLs and any pre-existing public
 * schema; it never drops or resets tables.
 */
import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { createServer as createViteServer } from "vite";
import { H3, serve } from "h3";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const rawTestUrl = process.env.OAUTH_TEST_DATABASE_URL?.trim();
const authOrigin = "http://127.0.0.1:8080";
const oauthOrigin = "http://127.0.0.1:8081";
const publicOrigin = "https://mvm3d.vercel.app";
const redirectUri = "http://127.0.0.1:9876/oauth/callback";
const scopes = [
  "project:read",
  "scene:write",
  "scene:execute",
  "assets:export",
  "offline_access",
];
const scopeString = scopes.join(" ");
const startupTimeoutMs = 60_000;

function assertSafeTestDatabase(rawUrl) {
  if (!rawUrl) {
    throw new Error(
      "Set OAUTH_TEST_DATABASE_URL to a disposable local PostgreSQL database named mvm3_oauth_test.",
    );
  }
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error("OAUTH_TEST_DATABASE_URL is not a valid PostgreSQL URL.");
  }
  const databaseName = decodeURIComponent(url.pathname.replace(/^\/+/, ""));
  if (
    !["localhost", "127.0.0.1", "::1"].includes(url.hostname) ||
    databaseName !== "mvm3_oauth_test"
  ) {
    throw new Error(
      "Safety stop: OAuth integration tests only run against loopback database mvm3_oauth_test.",
    );
  }
  return rawUrl;
}

function sanitizedLogs(logs) {
  return String(logs)
    .replace(/postgres(?:ql)?:\/\/[^\s"'<>]+/gi, "[redacted database URL]")
    .slice(-8_000);
}

function runMigrator(testUrl) {
  const result = spawnSync(process.execPath, [join(root, "scripts", "migrate.mjs")], {
    cwd: root,
    encoding: "utf8",
    env: {
      ...process.env,
      DATABASE_URL: testUrl,
      DATABASE_URL_MIGRATIONS: testUrl,
      NODE_ENV: "test",
      VERCEL_ENV: "preview",
    },
    maxBuffer: 1024 * 1024,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(
      "Repository migrations failed before the OAuth test (exit " + result.status + ").\n" +
        sanitizedLogs((result.stdout || "") + "\n" + (result.stderr || "")),
    );
  }
}

function cookiesFrom(response) {
  const cookies = typeof response.headers.getSetCookie === "function"
    ? response.headers.getSetCookie()
    : [response.headers.get("set-cookie")].filter(Boolean);
  return cookies
    .map((cookie) => String(cookie).split(";", 1)[0])
    .filter((cookie) => cookie.includes("="))
    .join("; ");
}

async function jsonOrText(response) {
  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch {
    return { _text: text };
  }
}

function trustedPublicHeaders(extra = {}) {
  return {
    host: "mvm3d.vercel.app",
    "x-forwarded-host": "mvm3d.vercel.app",
    "x-forwarded-proto": "https",
    ...extra,
  };
}

async function waitForAuth(viteServer, logs) {
  const deadline = Date.now() + startupTimeoutMs;
  let lastStatus = 0;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(authOrigin + "/api/auth/get-session", {
        headers: { origin: authOrigin },
        signal: AbortSignal.timeout(2_000),
      });
      lastStatus = response.status;
      await response.arrayBuffer();
      if (lastStatus < 500) return;
    } catch {
      // Let TanStack Start finish compiling its auth route.
    }
    if (viteServer.environments?.ssr?.pluginContainer?.options?.logger?.hasError) {
      throw new Error("Vite server encountered a startup error.\n" + sanitizedLogs(logs));
    }
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  throw new Error(
    "Auth endpoint did not become ready (last HTTP status " + lastStatus + ").\n" +
      sanitizedLogs(logs),
  );
}

async function parseMcpMessage(response, expectedId) {
  const raw = await response.text();
  if (!raw.trim()) return null;
  const contentType = response.headers.get("content-type") || "";
  if (contentType.includes("text/event-stream")) {
    const candidates = [];
    for (const line of raw.split(/\r?\n/)) {
      if (!line.startsWith("data:")) continue;
      try {
        candidates.push(JSON.parse(line.slice(5).trim()));
      } catch {
        // Ignore SSE heartbeats and non-JSON frames.
      }
    }
    return candidates.find((item) => item && item.id === expectedId) ??
      candidates.find((item) => item && (item.result || item.error)) ??
      { _raw: raw };
  }
  try {
    return JSON.parse(raw);
  } catch {
    return { _raw: raw };
  }
}

const testUrl = assertSafeTestDatabase(rawTestUrl);
const preflightPool = new pg.Pool({ connectionString: testUrl, max: 1 });
try {
  const existing = await preflightPool.query(
    "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE'",
  );
  assert.equal(
    existing.rows.length,
    0,
    "Safety stop: public schema already contains tables. Use a fresh loopback mvm3_oauth_test database; this test never resets it.",
  );
} finally {
  await preflightPool.end();
}

runMigrator(testUrl);

// Configure the imported auth and OAuth modules before loading them through Vite.
process.env.DATABASE_URL = testUrl;
process.env.DATABASE_URL_MIGRATIONS = testUrl;
process.env.BETTER_AUTH_URL = authOrigin;
process.env.MCP_PUBLIC_URL = publicOrigin;
process.env.VERCEL_ENV = "preview";
process.env.VERCEL_PROJECT_PRODUCTION_URL = "mvm3d.vercel.app";
process.env.VITE_AUTH_ENABLED = "true";
process.env.REQUIRE_MCP_AUTH = "true";

let vite;
let routeServer;
let testPool;
let logs = "";
let exitCode = 0;

try {
  vite = await createViteServer({
    configFile: join(root, "vite.config.ts"),
    mode: "development",
    logLevel: "error",
    server: { host: "127.0.0.1", port: 8080, strictPort: true },
  });
  vite.config.logger.info = ((original) => (...args) => {
    logs = (logs + args.map(String).join(" ") + "\n").slice(-30_000);
    original(...args);
  })(vite.config.logger.info.bind(vite.config.logger));
  vite.config.logger.error = ((original) => (...args) => {
    logs = (logs + args.map(String).join(" ") + "\n").slice(-30_000);
    original(...args);
  })(vite.config.logger.error.bind(vite.config.logger));
  await vite.listen();
  await waitForAuth(vite, logs);

  // Load the actual deployed route handlers from the repository source.
  const [registerModule, authorizeModule, consentModule, tokenModule, mcpModule] =
    await Promise.all([
      vite.ssrLoadModule("/server/routes/oauth/register.post.ts"),
      vite.ssrLoadModule("/server/routes/oauth/authorize.get.ts"),
      vite.ssrLoadModule("/server/routes/oauth/consent.post.ts"),
      vite.ssrLoadModule("/server/routes/oauth/token.post.ts"),
      vite.ssrLoadModule("/server/routes/mcp.ts"),
    ]);
  assert.equal(typeof registerModule.default, "function");
  assert.equal(typeof authorizeModule.default, "function");
  assert.equal(typeof consentModule.default, "function");
  assert.equal(typeof tokenModule.default, "function");
  assert.equal(typeof mcpModule.default, "function");

  const h3 = new H3();
  h3.post("/oauth/register", registerModule.default);
  h3.get("/oauth/authorize", authorizeModule.default);
  h3.post("/oauth/consent", consentModule.default);
  h3.post("/oauth/token", tokenModule.default);
  h3.all("/mcp", mcpModule.default);
  routeServer = serve(h3, { port: 8081, hostname: "127.0.0.1" });

  // Create an actual Better Auth user and obtain its real signed session cookie.
  const email = "task8-" + randomUUID() + "@example.com";
  const password = "Mvm3D-" + randomUUID() + "-Z8!";
  const signupResponse = await fetch(authOrigin + "/api/auth/sign-up/email", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: authOrigin,
      referer: authOrigin + "/login",
    },
    body: JSON.stringify({
      name: "MVM3D OAuth Test",
      email,
      password,
      callbackURL: "/studio",
    }),
    signal: AbortSignal.timeout(15_000),
  });
  const signupBody = await jsonOrText(signupResponse);
  assert.equal(
    signupResponse.status,
    200,
    "real signup must succeed before OAuth testing (HTTP " + signupResponse.status +
      "; code " + (signupBody?.code ?? signupBody?.error ?? "none") + ").\n" +
      sanitizedLogs(logs),
  );
  assert.equal(typeof signupBody?.user?.id, "string", "signup must return a real user id");
  const userId = signupBody.user.id;
  const sessionCookie = cookiesFrom(signupResponse);
  assert.ok(
    sessionCookie.includes("__Host-grok-auth.session_token="),
    "signup must set the real Better Auth session cookie",
  );

  const sessionResponse = await fetch(authOrigin + "/api/auth/get-session", {
    headers: { cookie: sessionCookie, origin: authOrigin },
    signal: AbortSignal.timeout(10_000),
  });
  const sessionBody = await jsonOrText(sessionResponse);
  assert.equal(sessionResponse.status, 200);
  assert.equal(sessionBody?.user?.id, userId, "session endpoint must read the newly created user");

  // Dynamic registration via the actual OAuth registration endpoint.
  const registrationResponse = await fetch(oauthOrigin + "/oauth/register", {
    method: "POST",
    headers: trustedPublicHeaders({ "content-type": "application/json", accept: "application/json" }),
    body: JSON.stringify({
      client_name: "MVM3D Task 8 Integration Test",
      redirect_uris: [redirectUri],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
      scope: scopeString,
    }),
    signal: AbortSignal.timeout(10_000),
  });
  const client = await jsonOrText(registrationResponse);
  assert.equal(
    registrationResponse.status,
    201,
    "dynamic OAuth client registration must persist (HTTP " + registrationResponse.status + ").",
  );
  assert.equal(typeof client.client_id, "string");
  assert.deepEqual(client.redirect_uris, [redirectUri]);

  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  const state = randomBytes(24).toString("base64url");
  const authorizeParams = new URLSearchParams({
    client_id: client.client_id,
    redirect_uri: redirectUri,
    response_type: "code",
    state,
    scope: scopeString,
    code_challenge: challenge,
    code_challenge_method: "S256",
    resource: publicOrigin + "/mcp",
  });
  const authorizePath = "/oauth/authorize?" + authorizeParams.toString();

  // The first authorize step must send users through the real login page before consent.
  const loginGate = await fetch(oauthOrigin + authorizePath, {
    redirect: "manual",
    headers: trustedPublicHeaders({ accept: "text/html" }),
    signal: AbortSignal.timeout(10_000),
  });
  assert.equal(loginGate.status, 302, "first authorization step must show the account/login gate");
  assert.ok(
    (loginGate.headers.get("location") || "").startsWith("/login?next="),
    "authorization must return the user to /login before consent",
  );

  // Simulate the browser returning from /login with the genuine account session.
  const consentResponse = await fetch(
    oauthOrigin + authorizePath + "&mvm3d_login_gate=1",
    {
      redirect: "manual",
      headers: trustedPublicHeaders({ accept: "text/html", cookie: sessionCookie }),
      signal: AbortSignal.timeout(10_000),
    },
  );
  assert.equal(consentResponse.status, 200, "signed-in user must see the consent page");
  const consentHtml = await consentResponse.text();
  assert.match(consentHtml, /Connect your AI client\?/);
  assert.match(consentHtml, /MVM3D Task 8 Integration Test/);
  assert.match(consentHtml, /Signed in as MVM3D OAuth Test/);

  const consentForm = new URLSearchParams();
  consentForm.set("client_id", client.client_id);
  consentForm.set("redirect_uri", redirectUri);
  consentForm.set("response_type", "code");
  consentForm.set("state", state);
  consentForm.set("requested_scope", scopeString);
  consentForm.set("code_challenge", challenge);
  consentForm.set("code_challenge_method", "S256");
  consentForm.set("resource", publicOrigin + "/mcp");
  for (const scope of scopes) consentForm.append("scope", scope);
  consentForm.set("decision", "allow");

  const consentPost = await fetch(oauthOrigin + "/oauth/consent", {
    method: "POST",
    headers: trustedPublicHeaders({
      origin: publicOrigin,
      referer: publicOrigin + authorizePath,
      cookie: sessionCookie,
      "content-type": "application/x-www-form-urlencoded",
      accept: "text/html",
    }),
    body: consentForm,
    signal: AbortSignal.timeout(15_000),
  });
  assert.equal(
    consentPost.status,
    200,
    "consent must return a successful callback handoff (HTTP " + consentPost.status + ").\n" +
      sanitizedLogs(logs),
  );
  const handoffHtml = await consentPost.text();
  assert.match(handoffHtml, /Approval received/);
  const callbackAnchor = handoffHtml.match(/<a href="([^"]+)" rel="noreferrer">Continue to AI client<\/a>/);
  assert.ok(callbackAnchor, "consent must render a usable callback link");
  const callbackUrl = new URL(callbackAnchor[1].replaceAll("&amp;", "&"));
  const code = callbackUrl.searchParams.get("code") || "";
  assert.equal(callbackUrl.searchParams.get("state"), state, "OAuth state must survive the callback");
  assert.equal(callbackUrl.searchParams.get("iss"), publicOrigin, "callback issuer must be canonical");
  assert.ok(code.length >= 40, "consent must issue a real high-entropy authorization code");

  testPool = new pg.Pool({ connectionString: testUrl, max: 1 });
  const storedCode = await testPool.query(
    "SELECT code_hash, user_id, consumed_at FROM mcp_oauth_codes WHERE client_id = $1 ORDER BY created_at DESC LIMIT 1",
    [client.client_id],
  );
  assert.equal(storedCode.rowCount, 1, "authorization code row must be persisted");
  assert.equal(storedCode.rows[0].user_id, userId);
  assert.notEqual(storedCode.rows[0].code_hash, code, "only the authorization code digest may be stored");
  assert.equal(storedCode.rows[0].consumed_at, null);

  async function tokenRequest(form) {
    const response = await fetch(oauthOrigin + "/oauth/token", {
      method: "POST",
      headers: trustedPublicHeaders({
        "content-type": "application/x-www-form-urlencoded",
        accept: "application/json",
      }),
      body: form,
      signal: AbortSignal.timeout(15_000),
    });
    return { response, body: await jsonOrText(response) };
  }

  // A wrong PKCE verifier must not mint a token or consume the valid code.
  const badPkce = new URLSearchParams({
    grant_type: "authorization_code",
    client_id: client.client_id,
    redirect_uri: redirectUri,
    code,
    code_verifier: "A".repeat(43),
    resource: publicOrigin + "/mcp",
  });
  const rejectedPkce = await tokenRequest(badPkce);
  assert.equal(rejectedPkce.response.status, 400);
  assert.equal(rejectedPkce.body.error, "invalid_grant");

  const exchange = new URLSearchParams({
    grant_type: "authorization_code",
    client_id: client.client_id,
    redirect_uri: redirectUri,
    code,
    code_verifier: verifier,
    resource: publicOrigin + "/mcp",
  });
  const exchangeResult = await tokenRequest(exchange);
  assert.equal(
    exchangeResult.response.status,
    200,
    "valid authorization code and PKCE verifier must exchange for a token. Response: " +
      JSON.stringify(exchangeResult.body).slice(0, 600) + "\n" + sanitizedLogs(logs),
  );
  const accessToken = exchangeResult.body.access_token;
  const refreshToken = exchangeResult.body.refresh_token;
  assert.match(accessToken, /^mvm3d_oauth_/);
  assert.equal(exchangeResult.body.token_type, "Bearer");
  assert.equal(exchangeResult.body.resource, publicOrigin + "/mcp");
  assert.equal(exchangeResult.body.scope, scopeString);
  assert.match(refreshToken, /^mvm3d_refresh_/);

  const consumedCode = await testPool.query(
    "SELECT consumed_at FROM mcp_oauth_codes WHERE client_id = $1 ORDER BY created_at DESC LIMIT 1",
    [client.client_id],
  );
  assert.ok(Number(consumedCode.rows[0].consumed_at) > 0, "successful code exchange must consume the code");

  const replayedCode = await tokenRequest(exchange);
  assert.equal(replayedCode.response.status, 400, "authorization code must be single-use");
  assert.equal(replayedCode.body.error, "invalid_grant");

  const refreshForm = new URLSearchParams({
    grant_type: "refresh_token",
    client_id: client.client_id,
    refresh_token: refreshToken,
    resource: publicOrigin + "/mcp",
  });
  const refreshed = await tokenRequest(refreshForm);
  assert.equal(refreshed.response.status, 200, "offline_access refresh must work");
  assert.match(refreshed.body.access_token, /^mvm3d_oauth_/);
  assert.notEqual(refreshed.body.refresh_token, refreshToken, "refresh tokens must rotate");

  const replayedRefresh = await tokenRequest(refreshForm);
  assert.equal(replayedRefresh.response.status, 400, "refresh token must be single-use");
  assert.equal(replayedRefresh.body.error, "invalid_grant");

  // Use the newly issued bearer token against the actual MCP endpoint.
  async function mcpRequest(body, token, id) {
    const response = await fetch(oauthOrigin + "/mcp", {
      method: "POST",
      headers: trustedPublicHeaders({
        origin: publicOrigin,
        authorization: "Bearer " + token,
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        "mcp-protocol-version": "2025-06-18",
      }),
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    });
    const message = await parseMcpMessage(response, id);
    return { response, message };
  }

  const initialize = await mcpRequest({
    jsonrpc: "2.0",
    id: 11,
    method: "initialize",
    params: {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "mvm3d-task8-oauth-smoke", version: "1.0.0" },
    },
  }, accessToken, 11);
  assert.equal(
    initialize.response.status,
    200,
    "a valid OAuth bearer token must authenticate the MCP initialize request (HTTP " +
      initialize.response.status + "). Message: " + JSON.stringify(initialize.message).slice(0, 600),
  );
  assert.equal(initialize.message?.jsonrpc, "2.0");
  assert.ok(initialize.message?.result?.serverInfo, "MCP initialize must return real server info");

  const listTools = await mcpRequest({
    jsonrpc: "2.0",
    id: 12,
    method: "tools/list",
    params: {},
  }, accessToken, 12);
  assert.equal(
    listTools.response.status,
    200,
    "an authenticated MCP tools/list request must succeed in stateless HTTP mode (HTTP " +
      listTools.response.status + "). Message: " + JSON.stringify(listTools.message).slice(0, 800),
  );
  const toolNames = (listTools.message?.result?.tools || []).map((tool) => tool.name);
  assert.ok(toolNames.includes("list_projects"), "the real authenticated MCP tool catalog must be returned");

  const invalidBearer = await mcpRequest({
    jsonrpc: "2.0",
    id: 13,
    method: "initialize",
    params: {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "mvm3d-task8-invalid-token", version: "1.0.0" },
    },
  }, "mvm3d_oauth_invalid.invalid.invalid", 13);
  assert.equal(invalidBearer.response.status, 401, "invalid OAuth bearer must fail closed");

  const credentialRows = await testPool.query(
    "SELECT count(*)::int AS count FROM mcp_oauth_clients WHERE client_id = $1",
    [client.client_id],
  );
  assert.equal(credentialRows.rows[0].count, 1);

  console.log(
    "[oauth-smoke] PASS: real signup/session → dynamic client registration → login gate → consent → persisted PKCE code → token exchange → one-time code/refresh rotation → authenticated MCP initialize/tools/list, plus invalid bearer rejection.",
  );
} catch (error) {
  const message = error instanceof Error ? error.message : "OAuth integration failed.";
  console.error("[oauth-smoke] FAIL: " + sanitizedLogs(message + "\n" + logs));
  exitCode = 1;
} finally {
  if (testPool) await testPool.end().catch(() => undefined);
  try {
    await routeServer?.close?.();
  } catch {
    // Continue closing Vite if the H3 listener already stopped.
  }
  try {
    await vite?.close();
  } catch {
    // Preserve the failure reason above.
  }
}

process.exitCode = exitCode;
