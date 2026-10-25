#!/usr/bin/env node
/**
 * Real HTTP regression for the production auth guard when DATABASE_URL is absent.
 *
 * Runs the actual TanStack/Vite server on loopback with a production runtime
 * environment, deliberately removes database URLs from the child process, and
 * verifies that auth requests stop at the readiness gate instead of reaching
 * Better Auth's process-local PGLite fallback. This test never connects to or
 * changes any database.
 */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const rawBaseUrl =
  process.env.AUTH_UNAVAILABLE_TEST_BASE_URL?.trim() ||
  "http://127.0.0.1:8081";
const startupTimeoutMs = 60_000;

function assertSafeLoopbackUrl(rawUrl) {
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error("AUTH_UNAVAILABLE_TEST_BASE_URL must be a valid URL.");
  }

  const hostname = url.hostname.replace(/^\[|\]$/g, "");
  if (
    url.protocol !== "http:" ||
    !["localhost", "127.0.0.1", "::1"].includes(hostname) ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  ) {
    throw new Error(
      "Safety stop: auth-unavailable smoke tests only use an HTTP loopback origin without URL credentials or extra paths.",
    );
  }
  return url;
}

function sanitizedLogs(logs) {
  return logs
    .replace(/postgres(?:ql)?:\/\/[^\s"'<>]+/gi, "[redacted database URL]")
    .replace(/(password|secret)\s*[:=]\s*[^\s"'<>]+/gi, "$1=[redacted]")
    .slice(-7_000);
}

async function readJson(response) {
  const raw = await response.text();
  try {
    return JSON.parse(raw);
  } catch {
    return { _unparseable: true, raw };
  }
}

function setCookieHeaders(response) {
  if (typeof response.headers.getSetCookie === "function") {
    return response.headers.getSetCookie();
  }
  return [response.headers.get("set-cookie")].filter(Boolean);
}

async function waitForServer(server, logs, origin) {
  const deadline = Date.now() + startupTimeoutMs;
  let lastStatus = 0;

  while (Date.now() < deadline) {
    if (server.exitCode !== null) {
      throw new Error(
        "Vite exited before HTTP became ready (exit " +
          server.exitCode +
          ").\n" +
          sanitizedLogs(logs.value),
      );
    }

    try {
      const response = await fetch(origin + "/", {
        signal: AbortSignal.timeout(2_000),
      });
      lastStatus = response.status;
      await response.arrayBuffer();
      if (response.status < 500) return;
    } catch {
      // The server may still be compiling its SSR route tree.
    }

    await new Promise((resolve) => setTimeout(resolve, 300));
  }

  throw new Error(
    "Loopback server did not become ready (last HTTP status " +
      lastStatus +
      ").\n" +
      sanitizedLogs(logs.value),
  );
}

async function stopServer(server) {
  if (server.exitCode !== null) return;
  server.kill("SIGTERM");
  await Promise.race([
    new Promise((resolve) => server.once("exit", resolve)),
    new Promise((resolve) => setTimeout(resolve, 4_000)),
  ]);
  if (server.exitCode === null) server.kill("SIGKILL");
}

const baseUrl = assertSafeLoopbackUrl(rawBaseUrl).origin;
const base = new URL(baseUrl);
const port = base.port || "80";
const childEnv = { ...process.env };

// Do not let a developer/CI environment accidentally make this test connect to
// a real or disposable database: the child is explicitly DB-less.
delete childEnv.DATABASE_URL;
delete childEnv.DATABASE_URL_MIGRATIONS;
delete childEnv.DATABASE_URL_DIRECT;
delete childEnv.AUTH_TEST_DATABASE_URL;
delete childEnv.MIGRATION_TEST_DATABASE_URL;
Object.assign(childEnv, {
  NODE_ENV: "production",
  VERCEL_ENV: "production",
  VITE_AUTH_ENABLED: "true",
  BETTER_AUTH_URL: baseUrl,
  MCP_PUBLIC_URL: baseUrl,
});

const server = spawn(
  process.execPath,
  [
    join(root, "node_modules", "vite", "bin", "vite.js"),
    "dev",
    "--host",
    base.hostname.replace(/^\[|\]$/g, ""),
    "--port",
    port,
    "--strictPort",
  ],
  {
    cwd: root,
    env: childEnv,
    stdio: ["ignore", "pipe", "pipe"],
  },
);
const logs = { value: "" };
const capture = (chunk) => {
  logs.value = (logs.value + chunk.toString()).slice(-30_000);
};
server.stdout.on("data", capture);
server.stderr.on("data", capture);

try {
  await waitForServer(server, logs, baseUrl);

  const headers = {
    Origin: baseUrl,
    Referer: baseUrl + "/login",
  };

  // Exercise the live auth route: the guard must refuse before Better Auth can
  // fall through to process-local PGLite or issue a session cookie.
  const sessionResponse = await fetch(baseUrl + "/api/auth/get-session", {
    headers,
    signal: AbortSignal.timeout(10_000),
  });
  const sessionBody = await readJson(sessionResponse);
  assert.equal(
    sessionResponse.status,
    503,
    "production session endpoint must fail closed without DATABASE_URL (got HTTP " +
      sessionResponse.status +
      ").\n" +
      sanitizedLogs(logs.value),
  );
  assert.deepEqual(
    sessionBody,
    {
      code: "AUTH_DATABASE_NOT_CONFIGURED",
      message:
        "Account storage is not connected on this deployment yet. " +
        "A persistent database must be connected before accounts can be created or used.",
    },
    "missing-database response must be the stable sanitized client contract",
  );
  assert.equal(
    sessionResponse.headers.get("cache-control"),
    "no-store",
    "database readiness failures must not be cached",
  );
  assert.equal(
    setCookieHeaders(sessionResponse).length,
    0,
    "a failed readiness check must not create a session cookie",
  );

  const signupResponse = await fetch(baseUrl + "/api/auth/sign-up/email", {
    method: "POST",
    headers: {
      ...headers,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      name: "MVM3D No Database Test",
      email: "no-database-smoke@example.invalid",
      password: "must-not-be-stored-in-this-test",
      callbackURL: "/studio",
    }),
    signal: AbortSignal.timeout(10_000),
  });
  const signupBody = await readJson(signupResponse);
  assert.equal(
    signupResponse.status,
    503,
    "signup must be rejected before user creation when the persistent DB is missing",
  );
  assert.deepEqual(signupBody, sessionBody);
  assert.equal(
    setCookieHeaders(signupResponse).length,
    0,
    "an unavailable database must never issue signup/session cookies",
  );
  assert.doesNotMatch(
    JSON.stringify({ sessionBody, signupBody }),
    /postgres(?:ql)?:\/\/|password|secret|relation .* does not exist|syntax error|SELECT/i,
    "client readiness errors must not leak connection strings, SQL details, or credentials",
  );

  console.log(
    "[auth-no-db-smoke] PASS: real HTTP session and signup routes return sanitized 503 AUTH_DATABASE_NOT_CONFIGURED responses without accessing an external DB or issuing cookies.",
  );
} catch (error) {
  const message =
    error instanceof Error ? error.message : "Auth database-unavailable smoke test failed.";
  console.error("[auth-no-db-smoke] FAIL: " + sanitizedLogs(message));
  process.exitCode = 1;
} finally {
  await stopServer(server);
}
