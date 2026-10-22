import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { allowMcpDevelopmentFallback, ownsMcpProject } from "./mcp-auth-policy.ts";

describe("MCP authentication policy", () => {
  it("allows the shared developer identity only for local development without configured auth", () => {
    assert.equal(
      allowMcpDevelopmentFallback({
        hasToken: false,
        authConfigured: false,
        nodeEnv: "development",
      }),
      true,
    );
  });

  it("rejects missing credentials in production even when auth is not configured", () => {
    assert.equal(
      allowMcpDevelopmentFallback({
        hasToken: false,
        authConfigured: false,
        nodeEnv: "production",
      }),
      false,
    );
  });

  it("never falls back after a token was supplied", () => {
    assert.equal(
      allowMcpDevelopmentFallback({
        hasToken: true,
        authConfigured: false,
        nodeEnv: "development",
      }),
      false,
    );
  });

  it("respects an explicit REQUIRE_MCP_AUTH setting", () => {
    assert.equal(
      allowMcpDevelopmentFallback({
        hasToken: false,
        authConfigured: false,
        nodeEnv: "development",
        requireMcpAuth: "true",
      }),
      false,
    );
  });

  it("requires a non-empty project owner matching the verified user", () => {
    assert.equal(ownsMcpProject("alice", "alice"), true);
    assert.equal(ownsMcpProject("alice", "bob"), false);
    assert.equal(ownsMcpProject("alice", ""), false);
    assert.equal(ownsMcpProject("alice", undefined), false);
  });
});
