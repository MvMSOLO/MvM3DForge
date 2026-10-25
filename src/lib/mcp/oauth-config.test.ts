import assert from "node:assert/strict";
import { test } from "node:test";
import { mcpPublicBaseUrl, mcpResourceUrl } from "./oauth-config.ts";

const keys = [
  "MCP_PUBLIC_URL",
  "VERCEL_ENV",
  "VERCEL_PROJECT_PRODUCTION_URL",
  "VERCEL_BRANCH_URL",
  "VERCEL_URL",
  "NODE_ENV",
];

function withEnv(values: Record<string, string | undefined>, run: () => void) {
  const previous = new Map<string, string | undefined>();
  for (const key of keys) previous.set(key, process.env[key]);
  for (const key of keys) delete process.env[key];
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    run();
  } finally {
    for (const key of keys) {
      const value = previous.get(key);
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

test("explicit MCP_PUBLIC_URL takes precedence in every environment", () => {
  withEnv({
    MCP_PUBLIC_URL: "https://preview.example.test/",
    VERCEL_ENV: "preview",
    VERCEL_PROJECT_PRODUCTION_URL: "mvm3d.vercel.app",
    VERCEL_BRANCH_URL: "mvm3d-git-review.vercel.app",
  }, () => {
    assert.equal(mcpPublicBaseUrl(), "https://preview.example.test");
    assert.equal(mcpResourceUrl(), "https://preview.example.test/mcp");
  });
});

test("preview uses its branch host rather than the production project host", () => {
  withEnv({
    VERCEL_ENV: "preview",
    VERCEL_PROJECT_PRODUCTION_URL: "mvm3d.vercel.app",
    VERCEL_BRANCH_URL: "mvm3d-git-feature-123.vercel.app",
    VERCEL_URL: "mvm3d-deployment-456.vercel.app",
  }, () => {
    assert.equal(mcpPublicBaseUrl(), "https://mvm3d-git-feature-123.vercel.app");
  });
});

test("preview falls back to its deployment host when no branch host exists", () => {
  withEnv({
    VERCEL_ENV: "preview",
    VERCEL_PROJECT_PRODUCTION_URL: "mvm3d.vercel.app",
    VERCEL_BRANCH_URL: undefined,
    VERCEL_URL: "mvm3d-deployment-456.vercel.app",
  }, () => {
    assert.equal(mcpPublicBaseUrl(), "https://mvm3d-deployment-456.vercel.app");
  });
});

test("preview fails closed instead of borrowing production when no preview host is available", () => {
  withEnv({
    VERCEL_ENV: "preview",
    VERCEL_PROJECT_PRODUCTION_URL: "mvm3d.vercel.app",
    VERCEL_BRANCH_URL: undefined,
    VERCEL_URL: undefined,
  }, () => {
    assert.throws(() => mcpPublicBaseUrl(), /could not be inferred for this Vercel preview deployment/i);
  });
});

test("production fallback uses mvm3d.vercel.app when Vercel host metadata is absent", () => {
  withEnv({
    NODE_ENV: "production",
    VERCEL_ENV: "production",
    VERCEL_PROJECT_PRODUCTION_URL: undefined,
    VERCEL_BRANCH_URL: undefined,
    VERCEL_URL: undefined,
  }, () => {
    assert.equal(mcpPublicBaseUrl(), "https://mvm3d.vercel.app");
    assert.equal(mcpResourceUrl(), "https://mvm3d.vercel.app/mcp");
  });
});

test("production fallback uses the stable production project host", () => {
  withEnv({
    VERCEL_ENV: "production",
    VERCEL_PROJECT_PRODUCTION_URL: "mvm3d.vercel.app",
    VERCEL_URL: "mvm3d-deployment-456.vercel.app",
    VERCEL_BRANCH_URL: undefined,
  }, () => {
    assert.equal(mcpPublicBaseUrl(), "https://mvm3d.vercel.app");
  });
});

test("local development defaults to localhost", () => {
  withEnv({ NODE_ENV: "development" }, () => {
    assert.equal(mcpPublicBaseUrl(), "http://localhost:8080");
  });
});
