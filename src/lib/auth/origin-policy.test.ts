import assert from "node:assert/strict";
import { test } from "node:test";
import {
  CANONICAL_PRODUCTION_ORIGIN,
  normalizeAuthPlatformHost,
  resolveAuthOriginPolicy,
} from "./origin-policy.ts";

test("Production trusts only the canonical origin and exact Production platform hosts", () => {
  const policy = resolveAuthOriginPolicy({
    NODE_ENV: "production",
    VERCEL_ENV: "production",
    VERCEL_PROJECT_PRODUCTION_URL: "mvm3d.vercel.app",
    VERCEL_URL: "mvm3d-deployment-123.vercel.app",
    VERCEL_BRANCH_URL: "stale-preview.vercel.app",
  });
  assert.equal(policy.mode, "production");
  assert.deepEqual(new Set(policy.trustedOrigins), new Set([
    CANONICAL_PRODUCTION_ORIGIN,
    "https://mvm3d-deployment-123.vercel.app",
  ]));
  assert.ok(policy.dynamicAllowedHosts.includes("mvm3d.vercel.app"));
  assert.ok(policy.dynamicAllowedHosts.includes("mvm3d-deployment-123.vercel.app"));
  assert.ok(!policy.trustedOrigins.includes("https://stale-preview.vercel.app"));
  assert.ok(!policy.trustedOrigins.some((origin) => origin.includes("localhost")));
  assert.ok(!policy.trustedOrigins.some((origin) => origin.includes("grok-sandbox.com")));
});

test("Preview trusts its own branch and deployment hosts, not the Production project hostname", () => {
  const policy = resolveAuthOriginPolicy({
    NODE_ENV: "production",
    VERCEL_ENV: "preview",
    VERCEL_PROJECT_PRODUCTION_URL: "mvm3d.vercel.app",
    VERCEL_BRANCH_URL: "mvm3d-git-task-10-mvmsolos-projects.vercel.app",
    VERCEL_URL: "mvm3d-pr-10-mvmsolos-projects.vercel.app",
  });
  assert.equal(policy.mode, "preview");
  assert.ok(policy.trustedOrigins.includes("https://mvm3d-git-task-10-mvmsolos-projects.vercel.app"));
  assert.ok(policy.trustedOrigins.includes("https://mvm3d-pr-10-mvmsolos-projects.vercel.app"));
  assert.ok(!policy.trustedOrigins.includes(CANONICAL_PRODUCTION_ORIGIN));
  assert.ok(!policy.trustedOrigins.includes("https://mvm3d.vercel.app"));
  assert.ok(!policy.dynamicAllowedHosts.includes("mvm3d.vercel.app"));
});

test("Development retains loopback origins and the documented sandbox preview wildcard", () => {
  const policy = resolveAuthOriginPolicy({ NODE_ENV: "development" });
  assert.equal(policy.mode, "development");
  assert.ok(policy.trustedOrigins.includes("http://localhost:8080"));
  assert.ok(policy.trustedOrigins.includes("http://127.0.0.1:8080"));
  assert.ok(policy.trustedOrigins.includes("https://*.grok-sandbox.com"));
  assert.ok(policy.dynamicAllowedHosts.includes("*.grok-sandbox.com"));
  assert.ok(!policy.trustedOrigins.includes(CANONICAL_PRODUCTION_ORIGIN));
});

test("an explicit base URL is normalized to its exact origin", () => {
  const policy = resolveAuthOriginPolicy({
    NODE_ENV: "production",
    BETTER_AUTH_URL: "https://auth.example.test/",
  });
  assert.ok(policy.trustedOrigins.includes("https://auth.example.test"));
  assert.ok(policy.dynamicAllowedHosts.includes("auth.example.test"));
});

test("unsafe explicit origins are not trusted", () => {
  for (const value of [
    "http://auth.example.test",
    "https://user:pass@auth.example.test",
    "https://auth.example.test/path",
    "https://auth.example.test?next=/",
    "https://auth.example.test#fragment",
  ]) {
    const policy = resolveAuthOriginPolicy({
      NODE_ENV: "production",
      BETTER_AUTH_URL: value,
    });
    assert.ok(!policy.trustedOrigins.includes(value), value);
  }
});

test("unrelated 3dmvm domains and arbitrary wildcard domains are not in Production origins", () => {
  const policy = resolveAuthOriginPolicy({ NODE_ENV: "production" });
  assert.deepEqual(policy.trustedOrigins, [CANONICAL_PRODUCTION_ORIGIN]);
  assert.ok(!policy.trustedOrigins.includes("https://3dmvm.vercel.app"));
  assert.ok(!policy.trustedOrigins.some((origin) => origin === "https://*.vercel.app"));
});

test("platform host normalization rejects paths, credentials, and non-HTTPS URLs", () => {
  assert.equal(normalizeAuthPlatformHost("mvm3d.vercel.app"), "mvm3d.vercel.app");
  assert.equal(normalizeAuthPlatformHost("https://mvm3d.vercel.app/"), "mvm3d.vercel.app");
  assert.equal(normalizeAuthPlatformHost("http://mvm3d.vercel.app"), null);
  assert.equal(normalizeAuthPlatformHost("https://user@example.test"), null);
  assert.equal(normalizeAuthPlatformHost("mvm3d.vercel.app/unsafe"), null);
  assert.equal(normalizeAuthPlatformHost(""), null);
});
