import assert from "node:assert/strict";
import { test } from "node:test";
import {
  CANONICAL_PRODUCTION_ORIGIN,
  isTrustedHost,
  isTrustedOrigin,
  isTrustedSameOriginPost,
  normalizeHostHeader,
  resolveAuthOriginPolicy,
} from "./origin-policy.ts";

test("production trusts the canonical MVM3D domain and exact platform-reported hosts only", () => {
  const policy = resolveAuthOriginPolicy({
    nodeEnv: "production",
    vercelEnvironment: "production",
    vercelProjectProductionUrl: "mvm3d.vercel.app",
    vercelUrl: "mvm3d-a1b2c3-mvmsolos-projects.vercel.app",
    vercelBranchUrl: "mvm3d-git-feature-mvmsolos-projects.vercel.app",
  });

  assert.ok(policy.trustedOrigins.includes(CANONICAL_PRODUCTION_ORIGIN));
  assert.ok(policy.trustedOrigins.includes("https://mvm3d-a1b2c3-mvmsolos-projects.vercel.app"));
  assert.equal(
    policy.trustedOrigins.includes("https://mvm3d-git-feature-mvmsolos-projects.vercel.app"),
    false,
    "production must not trust a branch-preview origin",
  );
  assert.equal(policy.trustedOrigins.includes("https://*.grok-sandbox.com"), false);
  assert.equal(policy.allowedHosts.includes("*.grok-sandbox.com"), false);
});

test("production process without Vercel metadata never enables workspace wildcards", () => {
  const policy = resolveAuthOriginPolicy({ nodeEnv: "production" });
  assert.equal(policy.isProduction, true);
  assert.equal(policy.isWorkspacePreview, false);
  assert.equal(policy.trustedOrigins.includes("https://*.grok-sandbox.com"), false);
  assert.equal(policy.allowedHosts.includes("*.grok-sandbox.com"), false);
  assert.ok(policy.trustedOrigins.includes(CANONICAL_PRODUCTION_ORIGIN));
});

test("Vercel Preview trusts its own branch/deployment hosts but not production", () => {
  const policy = resolveAuthOriginPolicy({
    nodeEnv: "production",
    vercelEnvironment: "preview",
    vercelProjectProductionUrl: "mvm3d.vercel.app",
    vercelBranchUrl: "mvm3d-git-task-10-mvmsolos-projects.vercel.app",
    vercelUrl: "mvm3d-deployment-123-mvmsolos-projects.vercel.app",
  });

  assert.deepEqual(policy.trustedOrigins.sort(), [
    "https://mvm3d-deployment-123-mvmsolos-projects.vercel.app",
    "https://mvm3d-git-task-10-mvmsolos-projects.vercel.app",
  ]);
  assert.equal(policy.trustedOrigins.includes(CANONICAL_PRODUCTION_ORIGIN), false);
  assert.equal(policy.trustedOrigins.includes("https://mvm3d.vercel.app"), false);
  assert.equal(policy.trustedOrigins.some((origin) => origin.includes("*")), false);
});

test("local dev keeps loopback origins even when the PostgreSQL harness sets VERCEL_ENV=preview", () => {
  const policy = resolveAuthOriginPolicy({
    nodeEnv: "development",
    vercelEnvironment: "preview",
    explicitBaseURL: "http://127.0.0.1:8080",
  });

  assert.equal(policy.isVercelPreview, false);
  assert.equal(policy.explicitBaseURL, "http://127.0.0.1:8080");
  assert.ok(policy.allowedHosts.includes("127.0.0.1:8080"));
  assert.ok(policy.trustedOrigins.includes("http://127.0.0.1:8080"));
  assert.equal(policy.trustedOrigins.includes("https://*.grok-sandbox.com"), false);
});

test("Preview ignores a stale production BETTER_AUTH_URL instead of trusting it", () => {
  const policy = resolveAuthOriginPolicy({
    nodeEnv: "production",
    vercelEnvironment: "preview",
    explicitBaseURL: "https://mvm3d.vercel.app",
    vercelProjectProductionUrl: "mvm3d.vercel.app",
    vercelBranchUrl: "mvm3d-git-task-10-mvmsolos-projects.vercel.app",
  });

  assert.equal(policy.explicitBaseURL, undefined);
  assert.deepEqual(policy.trustedOrigins, [
    "https://mvm3d-git-task-10-mvmsolos-projects.vercel.app",
  ]);
});

test("Preview accepts an explicit base URL only when it matches that Preview", () => {
  const policy = resolveAuthOriginPolicy({
    nodeEnv: "production",
    vercelEnvironment: "preview",
    explicitBaseURL: "https://mvm3d-git-task-10-mvmsolos-projects.vercel.app/",
    vercelBranchUrl: "mvm3d-git-task-10-mvmsolos-projects.vercel.app",
  });

  assert.equal(policy.explicitBaseURL, "https://mvm3d-git-task-10-mvmsolos-projects.vercel.app");
});

test("malformed explicit URLs and non-Vercel platform host values fail closed", () => {
  const policy = resolveAuthOriginPolicy({
    nodeEnv: "production",
    vercelEnvironment: "preview",
    explicitBaseURL: "https://attacker.example/path",
    vercelUrl: "https://attacker.example",
    vercelBranchUrl: "mvm3d.preview.example",
    vercelProjectProductionUrl: "mvm3d.vercel.app",
  });

  assert.deepEqual(policy.trustedOrigins, []);
  assert.deepEqual(policy.allowedHosts, []);
});

test("workspace preview keeps its required HTTPS wildcard, but not arbitrary origins", () => {
  const policy = resolveAuthOriginPolicy({
    nodeEnv: "development",
  });

  assert.ok(policy.trustedOrigins.includes("https://*.grok-sandbox.com"));
  assert.equal(policy.trustedOrigins.includes("*.grok-sandbox.com"), false, "schemeless sandbox wildcard must not enable HTTP");
  assert.equal(isTrustedOrigin("https://studio-123.grok-sandbox.com", policy.trustedOrigins), true);
  assert.equal(isTrustedOrigin("http://studio-123.grok-sandbox.com", policy.trustedOrigins), false);
  assert.equal(isTrustedOrigin("https://grok-sandbox.com", policy.trustedOrigins), false);
  assert.equal(isTrustedOrigin("https://attacker.example", policy.trustedOrigins), false);
});

test("production consent accepts the official same-origin POST", () => {
  const policy = resolveAuthOriginPolicy({
    nodeEnv: "production",
    vercelEnvironment: "production",
    vercelProjectProductionUrl: "mvm3d.vercel.app",
  });

  assert.equal(isTrustedSameOriginPost({
    origin: "https://mvm3d.vercel.app",
    forwardedHost: "mvm3d.vercel.app",
    host: "mvm3d-internal.vercel.app",
    forwardedProto: "https",
  }, policy), true);
});

test("production consent rejects foreign Origin even when a caller supplies a matching Host", () => {
  const policy = resolveAuthOriginPolicy({
    nodeEnv: "production",
    vercelEnvironment: "production",
    vercelProjectProductionUrl: "mvm3d.vercel.app",
  });

  assert.equal(isTrustedSameOriginPost({
    origin: "https://attacker.example",
    forwardedHost: "attacker.example",
    host: "attacker.example",
    forwardedProto: "https",
  }, policy), false);
  assert.equal(isTrustedSameOriginPost({
    origin: "https://mvm3d.vercel.app",
    forwardedHost: "attacker.example",
    host: "mvm3d.vercel.app",
    forwardedProto: "https",
  }, policy), false);
});

test("missing Origin requires a trusted same-origin Referer; Origin:null is rejected", () => {
  const policy = resolveAuthOriginPolicy({
    nodeEnv: "production",
    vercelEnvironment: "production",
    vercelProjectProductionUrl: "mvm3d.vercel.app",
  });

  assert.equal(isTrustedSameOriginPost({
    referer: "https://mvm3d.vercel.app/oauth/authorize",
    forwardedHost: "mvm3d.vercel.app",
    forwardedProto: "https",
  }, policy), true);
  assert.equal(isTrustedSameOriginPost({
    forwardedHost: "mvm3d.vercel.app",
    forwardedProto: "https",
  }, policy), false);
  assert.equal(isTrustedSameOriginPost({
    origin: "null",
    referer: "https://mvm3d.vercel.app/oauth/authorize",
    forwardedHost: "mvm3d.vercel.app",
    forwardedProto: "https",
  }, policy), false);
});

test("Preview consent works on the verified branch host and rejects production as a source", () => {
  const policy = resolveAuthOriginPolicy({
    nodeEnv: "production",
    vercelEnvironment: "preview",
    vercelProjectProductionUrl: "mvm3d.vercel.app",
    vercelBranchUrl: "mvm3d-git-task-10-mvmsolos-projects.vercel.app",
  });

  assert.equal(isTrustedSameOriginPost({
    origin: "https://mvm3d-git-task-10-mvmsolos-projects.vercel.app",
    forwardedHost: "mvm3d-git-task-10-mvmsolos-projects.vercel.app",
    forwardedProto: "https",
  }, policy), true);
  assert.equal(isTrustedSameOriginPost({
    origin: "https://mvm3d.vercel.app",
    forwardedHost: "mvm3d-git-task-10-mvmsolos-projects.vercel.app",
    forwardedProto: "https",
  }, policy), false);
});

test("host allow-list uses exact hosts and rejects stale projects and wildcard overrides", () => {
  const policy = resolveAuthOriginPolicy({
    nodeEnv: "production",
    vercelEnvironment: "production",
    vercelProjectProductionUrl: "mvm3d.vercel.app",
  });

  assert.equal(isTrustedHost("mvm3d.vercel.app", policy.allowedHosts), true);
  assert.equal(isTrustedHost("mvm3d-mvmsolos-projects.vercel.app", policy.allowedHosts), true);
  assert.equal(isTrustedHost("mvm3d-random-mvmsolos-projects.vercel.app", policy.allowedHosts), false);
  assert.equal(isTrustedHost("3dmvm.vercel.app", policy.allowedHosts), false);
  assert.equal(isTrustedHost("attacker.example", policy.allowedHosts), false);
  assert.equal(normalizeHostHeader("mvm3d.vercel.app/path"), undefined);
  assert.equal(normalizeHostHeader("attacker@ mvm3d.vercel.app"), undefined);
  assert.equal(normalizeHostHeader("*.vercel.app"), undefined);
  assert.equal(isTrustedHost("studio-123.grok-sandbox.com", policy.allowedHosts), false);
});

test("workspace host wildcard accepts HTTPS subdomains only", () => {
  const policy = resolveAuthOriginPolicy({ nodeEnv: "development" });
  assert.equal(isTrustedHost("studio-123.grok-sandbox.com", policy.allowedHosts), true);
  assert.equal(isTrustedHost("grok-sandbox.com", policy.allowedHosts), false);
  assert.equal(isTrustedHost("attacker.example", policy.allowedHosts), false);
});
