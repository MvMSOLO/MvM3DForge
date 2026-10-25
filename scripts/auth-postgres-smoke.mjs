#!/usr/bin/env node
/**
 * Real Better Auth account-creation regression against a disposable PostgreSQL.
 *
 * The script refuses to touch anything except a fresh local database named
 * mvm3_auth_test. It does not drop/reset tables. It applies repository
 * migrations, boots the actual Vite/TanStack server, performs HTTP signup, and
 * verifies the persisted user, password hash, session cookie, and DB session.
 */
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const rawTestUrl = process.env.AUTH_TEST_DATABASE_URL?.trim();
const baseUrl = process.env.AUTH_TEST_BASE_URL?.trim() || "http://127.0.0.1:8080";
const startupTimeoutMs = 60_000;

function assertSafeTestDatabase(rawUrl) {
  if (!rawUrl) {
    throw new Error(
      "Set AUTH_TEST_DATABASE_URL to a disposable local PostgreSQL database named mvm3_auth_test.",
    );
  }

  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error("AUTH_TEST_DATABASE_URL is not a valid PostgreSQL URL.");
  }

  const databaseName = decodeURIComponent(url.pathname.replace(/^\/+/, ""));
  if (
    !["localhost", "127.0.0.1", "::1"].includes(url.hostname) ||
    databaseName !== "mvm3_auth_test"
  ) {
    throw new Error(
      "Safety stop: auth integration tests only run against localhost/loopback database mvm3_auth_test.",
    );
  }

  const appUrl = new URL(baseUrl);
  if (
    !["localhost", "127.0.0.1", "::1"].includes(appUrl.hostname) ||
    appUrl.protocol !== "http:"
  ) {
    throw new Error("Safety stop: AUTH_TEST_BASE_URL must be an HTTP loopback URL.");
  }

  return rawUrl;
}

function sanitizedLogs(logs) {
  return logs
    .replace(/postgres(?:ql)?:\/\/[^\s"'<>]+/gi, "[redacted database URL]")
    .slice(-7000);
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
      "Repository migrations failed before signup test (exit " + result.status + ").\n" +
        sanitizedLogs((result.stdout || "") + "\n" + (result.stderr || "")),
    );
  }
}

function cookieHeaderFrom(response) {
  const headers = typeof response.headers.getSetCookie === "function"
    ? response.headers.getSetCookie()
    : [response.headers.get("set-cookie")].filter(Boolean);
  return headers
    .map((cookie) => String(cookie).split(";", 1)[0])
    .filter((cookie) => cookie.includes("="))
    .join("; ");
}

async function readJson(response) {
  const raw = await response.text();
  try {
    return JSON.parse(raw);
  } catch {
    return { _unparseable: true };
  }
}

function spawnVite(testUrl) {
  const logs = { value: "" };
  const server = spawn(
    process.execPath,
    [join(root, "node_modules", "vite", "bin", "vite.js"), "dev", "--host", "127.0.0.1", "--port", "8080"],
    {
      cwd: root,
      env: {
        ...process.env,
        DATABASE_URL: testUrl,
        DATABASE_URL_MIGRATIONS: testUrl,
        BETTER_AUTH_URL: baseUrl,
        MCP_PUBLIC_URL: baseUrl,
        NODE_ENV: "development",
        VERCEL_ENV: "preview",
        VITE_AUTH_ENABLED: "true",
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );

  const capture = (chunk) => {
    logs.value = (logs.value + chunk.toString()).slice(-30_000);
  };
  server.stdout.on("data", capture);
  server.stderr.on("data", capture);
  return { server, logs };
}

async function waitForAuthRoute(server, logs) {
  const deadline = Date.now() + startupTimeoutMs;
  let lastStatus = 0;
  while (Date.now() < deadline) {
    if (server.exitCode !== null) {
      throw new Error(
        "Vite exited before the auth route was ready (exit " + server.exitCode + ").\n" +
          sanitizedLogs(logs.value),
      );
    }
    try {
      const response = await fetch(baseUrl + "/api/auth/get-session", {
        headers: { Origin: baseUrl },
        signal: AbortSignal.timeout(3_000),
      });
      lastStatus = response.status;
      await response.arrayBuffer();
      if (response.status < 500) return;
    } catch {
      // The server may still be compiling its SSR route tree.
    }
    await new Promise((resolve) => setTimeout(resolve, 350));
  }
  throw new Error(
    "Auth route did not become ready (last HTTP status " + lastStatus + ").\n" +
      sanitizedLogs(logs.value),
  );
}

const testUrl = assertSafeTestDatabase(rawTestUrl);
const pool = new pg.Pool({ connectionString: testUrl, max: 1 });

try {
  // Never clean/reset an existing DB; CI provisions a new service database.
  const existingRelations = [
    "public._migrations",
    'public."user"',
    'public."account"',
    'public."session"',
    'public."verification"',
    "public.projects",
    "public.mcp_api_keys",
    "public.mcp_execution_jobs",
    "public.mcp_oauth_clients",
    "public.mcp_oauth_codes",
    "public.mcp_oauth_refresh_tokens",
  ];
  for (const relation of existingRelations) {
    const result = await pool.query("SELECT to_regclass($1) AS relation", [relation]);
    assert.equal(
      result.rows[0]?.relation ?? null,
      null,
      "Safety stop: " + relation + " already exists. This test will not reset existing data.",
    );
  }
} finally {
  await pool.end();
}

runMigrator(testUrl);

const launched = spawnVite(testUrl);
const server = launched.server;
const logs = launched.logs;
let verificationPool;

try {
  await waitForAuthRoute(server, logs);

  const email = "task7-" + randomUUID() + "@example.com";
  const password = "Mvm3D-" + randomUUID() + "-A9!";
  const name = "MVM3D Account Test";

  const signupResponse = await fetch(baseUrl + "/api/auth/sign-up/email", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      Origin: baseUrl,
      Referer: baseUrl + "/login",
    },
    body: JSON.stringify({ name, email, password, callbackURL: "/studio" }),
    signal: AbortSignal.timeout(15_000),
  });
  const signupBody = await readJson(signupResponse);

  assert.equal(
    signupResponse.status,
    200,
    "real email signup should return HTTP 200 (got " + signupResponse.status +
      "; error code: " + (signupBody?.code ?? signupBody?.error ?? "none") + ").\n" +
      sanitizedLogs(logs.value),
  );
  assert.equal(
    typeof signupBody?.user?.id,
    "string",
    "Better Auth signup must return the persisted user, not a simulated success.",
  );
  const userId = signupBody.user.id;
  assert.equal(signupBody.user.email, email.toLowerCase());

  const sessionCookie = cookieHeaderFrom(signupResponse);
  assert.ok(
    sessionCookie.includes("__Host-grok-auth.session_token="),
    "signup must set the app's session cookie after successful account creation.",
  );

  // Verify through a separate HTTP request, not just the signup response.
  const sessionResponse = await fetch(baseUrl + "/api/auth/get-session", {
    headers: { Cookie: sessionCookie, Origin: baseUrl },
    signal: AbortSignal.timeout(10_000),
  });
  const sessionBody = await readJson(sessionResponse);
  assert.equal(sessionResponse.status, 200, "session endpoint must answer successfully after signup");
  assert.equal(sessionBody?.user?.id, userId, "fresh signup session must identify the new user");
  assert.equal(sessionBody?.user?.email, email.toLowerCase());

  verificationPool = new pg.Pool({ connectionString: testUrl, max: 1 });
  const users = await verificationPool.query(
    'SELECT "id", "name", "email" FROM public."user" WHERE "id" = $1',
    [userId],
  );
  assert.equal(users.rowCount, 1, "a real user row must be committed to PostgreSQL");
  assert.equal(users.rows[0].name, name);
  assert.equal(users.rows[0].email, email.toLowerCase());

  const credentials = await verificationPool.query(
    'SELECT "password" FROM public."account" WHERE "userId" = $1 AND "providerId" = $2 LIMIT 1',
    [userId, "credential"],
  );
  assert.equal(credentials.rowCount, 1, "Better Auth must create the credential account row");
  assert.equal(typeof credentials.rows[0].password, "string");
  assert.notEqual(credentials.rows[0].password, password, "password must not be stored as plaintext");
  assert.ok(credentials.rows[0].password.length > 20, "stored password value must look like a hash");

  const sessions = await verificationPool.query(
    'SELECT "userId" FROM public."session" WHERE "userId" = $1',
    [userId],
  );
  assert.ok(sessions.rowCount >= 1, "a persistent session row must exist in PostgreSQL");

  // Duplicate registration must not create a second user or falsely report success.
  const duplicateResponse = await fetch(baseUrl + "/api/auth/sign-up/email", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      Origin: baseUrl,
      Referer: baseUrl + "/login",
    },
    body: JSON.stringify({ name, email, password, callbackURL: "/studio" }),
    signal: AbortSignal.timeout(10_000),
  });
  assert.ok(
    duplicateResponse.status >= 400,
    "duplicate signup must be rejected (got HTTP " + duplicateResponse.status + ")",
  );
  const count = await verificationPool.query(
    'SELECT count(*)::int AS count FROM public."user" WHERE "email" = $1',
    [email.toLowerCase()],
  );
  assert.equal(count.rows[0].count, 1, "duplicate signup must not create a second user");

  console.log(
    "[auth-smoke] PASS: real email signup, PostgreSQL user + hashed credential + session persistence, session read on a separate request, and duplicate signup rejection.",
  );
} catch (error) {
  const message = error instanceof Error ? error.message : "Auth integration test failed.";
  console.error("[auth-smoke] FAIL: " + sanitizedLogs(message));
  process.exitCode = 1;
} finally {
  if (verificationPool) await verificationPool.end().catch(() => undefined);
  server.kill("SIGTERM");
  await new Promise((resolve) => {
    if (server.exitCode !== null) return resolve();
    const timer = setTimeout(() => resolve(), 5_000);
    server.once("exit", () => {
      clearTimeout(timer);
      resolve();
    });
  });
}
