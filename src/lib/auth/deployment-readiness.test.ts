import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { resolveAuthDatabaseReadiness } from "./deployment-readiness.ts";

describe("resolveAuthDatabaseReadiness", () => {
  it("allows local and preview development without DATABASE_URL", () => {
    assert.deepEqual(
      resolveAuthDatabaseReadiness({ nodeEnv: "development", databaseUrl: undefined }),
      { ok: true },
    );
    assert.deepEqual(
      resolveAuthDatabaseReadiness({ nodeEnv: "test", databaseUrl: "" }),
      { ok: true },
    );
  });

  it("requires persistent storage in production", () => {
    assert.deepEqual(
      resolveAuthDatabaseReadiness({ nodeEnv: "production", databaseUrl: undefined }),
      {
        ok: false,
        code: "AUTH_DATABASE_NOT_CONFIGURED",
        message:
          "Account storage is not connected on this deployment yet. " +
          "A persistent database must be connected before accounts can be created or used.",
      },
    );
    assert.equal(
      resolveAuthDatabaseReadiness({ nodeEnv: "production", databaseUrl: "   " }).ok,
      false,
    );
  });

  it("allows production authentication when a database URL exists", () => {
    assert.deepEqual(
      resolveAuthDatabaseReadiness({ nodeEnv: "production", databaseUrl: "postgres://redacted" }),
      { ok: true },
    );
  });
});
