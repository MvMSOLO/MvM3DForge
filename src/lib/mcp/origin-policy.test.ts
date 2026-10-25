import assert from "node:assert/strict";
import { test } from "node:test";
import {
  CANONICAL_MCP_ORIGIN,
  isAllowedMcpHost,
  isAllowedMcpOrigin,
  resolveAllowedMcpHosts,
  resolveAllowedMcpOrigins,
  resolveMcpRequestHost,
} from "./origin-policy.ts";

test("Production defaults to mvm3d.vercel.app and exact Vercel Production hosts", () => {
  const env = {
    NODE_ENV: "production",
    VERCEL_ENV: "production",
    VERCEL_PROJECT_PRODUCTION_URL: "mvm3d.vercel.app",
    VERCEL_URL: "mvm3d-deployment-123.vercel.app",
    VERCEL_BRANCH_URL: "stale-preview.vercel.app",
  };
  assert.deepEqual(new Set(resolveAllowedMcpHosts(env)), new Set([
    "mvm3d.vercel.app",
    "mvm3d-deployment-123.vercel.app",
  ]));
  assert.ok(!resolveAllowedMcpHosts(env).includes("stale-preview.vercel.app"));
  assert.ok(!resolveAllowedMcpHosts(env).some((host) => host.includes("3dmvm")));
  assert.ok(isAllowedMcpOrigin(CANONICAL_MCP_ORIGIN, env));
  assert.ok(!isAllowedMcpOrigin("https://mvm3d.vercel.app:444", env));
  assert.ok(!isAllowedMcpOrigin("http://mvm3d.vercel.app", env));
});

test("Preview accepts only its configured MCP issuer and Vercel Preview hostnames", () => {
  const env = {
    NODE_ENV: "production",
    VERCEL_ENV: "preview",
    MCP_PUBLIC_URL: "https://mvm3d-git-task-10-mvmsolos-projects.vercel.app",
    VERCEL_PROJECT_PRODUCTION_URL: "mvm3d.vercel.app",
    VERCEL_BRANCH_URL: "mvm3d-git-task-10-mvmsolos-projects.vercel.app",
    VERCEL_URL: "mvm3d-task-10-pr-456.vercel.app",
  };
  assert.ok(isAllowedMcpHost("mvm3d-git-task-10-mvmsolos-projects.vercel.app", env));
  assert.ok(isAllowedMcpHost("mvm3d-task-10-pr-456.vercel.app", env));
  assert.ok(!isAllowedMcpHost("mvm3d.vercel.app", env));
  assert.ok(!isAllowedMcpHost("3dmvm.vercel.app", env));
  assert.ok(isAllowedMcpOrigin("https://mvm3d-git-task-10-mvmsolos-projects.vercel.app", env));
  assert.ok(!isAllowedMcpOrigin(CANONICAL_MCP_ORIGIN, env));
});

test("explicit host allow-list is exact and replaces inferred defaults", () => {
  const env = {
    NODE_ENV: "production",
    MCP_ALLOWED_HOSTS: "Custom.Example.test, preview.example.test",
    VERCEL_PROJECT_PRODUCTION_URL: "mvm3d.vercel.app",
  };
  assert.deepEqual(resolveAllowedMcpHosts(env), ["custom.example.test", "preview.example.test"]);
  assert.ok(isAllowedMcpHost("custom.example.test", env));
  assert.ok(!isAllowedMcpHost("mvm3d.vercel.app", env));
  assert.ok(!isAllowedMcpHost("custom.example.test.evil.test", env));
  assert.ok(!isAllowedMcpHost("mvm3d-pr-123-mvmsolos-projects.vercel.app", env));
});

test("an invalid non-empty host override fails closed", () => {
  const env = {
    NODE_ENV: "production",
    MCP_ALLOWED_HOSTS: "https://user:secret@example.test/path",
  };
  assert.deepEqual(resolveAllowedMcpHosts(env), []);
  assert.ok(!isAllowedMcpHost("mvm3d.vercel.app", env));
});

test("Vercel forwarded host takes precedence over internal Host and uses first forwarded value", () => {
  assert.equal(
    resolveMcpRequestHost("mvm3d.vercel.app, internal-gateway.local", "internal-gateway.local"),
    "mvm3d.vercel.app",
  );
  assert.equal(
    resolveMcpRequestHost("mvm3d.vercel.app:443", "internal-gateway.local"),
    "mvm3d.vercel.app",
  );
  assert.equal(resolveMcpRequestHost(undefined, "MVM3D.VERCEL.APP"), "mvm3d.vercel.app");
});

test("malformed forwarded host fails closed instead of falling back to direct Host", () => {
  assert.equal(resolveMcpRequestHost("evil.example.test/path", "mvm3d.vercel.app"), null);
  assert.equal(resolveMcpRequestHost("user@evil.example.test", "mvm3d.vercel.app"), null);
  assert.equal(resolveMcpRequestHost(undefined, ""), null);
});

test("foreign origins and origins with unsafe URL components are rejected", () => {
  const env = { NODE_ENV: "production" };
  for (const origin of [
    "https://evil.example.test",
    "https://mvm3d.vercel.app:444",
    "http://mvm3d.vercel.app",
    "https://user@mvm3d.vercel.app",
    "https://mvm3d.vercel.app/path",
    "https://mvm3d.vercel.app?next=/",
    "https://mvm3d.vercel.app#x",
    "null",
    "",
  ]) {
    assert.ok(!isAllowedMcpOrigin(origin, env), origin);
  }
  assert.ok(isAllowedMcpOrigin(CANONICAL_MCP_ORIGIN, env));
  assert.ok(isAllowedMcpOrigin(undefined, env), "native clients may omit Origin");
});

test("explicit MCP_ALLOWED_ORIGINS is an exact allow-list and cannot be bypassed by host equality", () => {
  const env = {
    NODE_ENV: "production",
    MCP_ALLOWED_ORIGINS: "https://dashboard.example.test",
  };
  assert.deepEqual(resolveAllowedMcpOrigins(env), ["https://dashboard.example.test"]);
  assert.ok(isAllowedMcpOrigin("https://dashboard.example.test", env));
  assert.ok(!isAllowedMcpOrigin(CANONICAL_MCP_ORIGIN, env));
  assert.ok(!isAllowedMcpOrigin("https://dashboard.example.test:444", env));
});

test("malformed non-empty origin override fails closed", () => {
  const env = { NODE_ENV: "production", MCP_ALLOWED_ORIGINS: "https://evil.example.test/path" };
  assert.deepEqual(resolveAllowedMcpOrigins(env), []);
  assert.ok(!isAllowedMcpOrigin("https://evil.example.test", env));
});

test("HTTP loopback origin is accepted only in non-production on the default port", () => {
  const dev = { NODE_ENV: "development" };
  assert.ok(isAllowedMcpOrigin("http://127.0.0.1:8080", dev));
  assert.ok(isAllowedMcpOrigin("http://localhost:8080", dev));
  assert.ok(!isAllowedMcpOrigin("http://localhost:9999", dev));
  assert.ok(!isAllowedMcpOrigin("http://127.0.0.1:8080", { NODE_ENV: "production" }));
});
