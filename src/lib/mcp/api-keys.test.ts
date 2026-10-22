import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { hashMcpApiKey, normalizeMcpScopes } from "./api-keys-primitives.ts";

describe("MCP API key primitives", () => {
  it("hashes the key instead of exposing the original secret", () => {
    const first = hashMcpApiKey("mvmf_live_test-secret");
    assert.equal(first, hashMcpApiKey("mvmf_live_test-secret"));
    assert.notEqual(first, "mvmf_live_test-secret");
    assert.equal(first.length, 64);
  });

  it("accepts only known least-privilege scopes and removes duplicates", () => {
    assert.deepEqual(normalizeMcpScopes(["project:read", "project:read"]), ["project:read"]);
    assert.throws(() => normalizeMcpScopes(["*"]));
    assert.throws(() => normalizeMcpScopes([]));
    assert.throws(() => normalizeMcpScopes("project:read"));
  });
});
