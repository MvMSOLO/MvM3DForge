import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  evaluateDatabaseReadiness,
  REQUIRED_DATABASE_TABLES,
} from "./database-readiness.ts";

const base = {
  nodeEnv: "production",
  databaseUrl: "postgres://placeholder.invalid/redacted",
  backend: "neon" as const,
};

describe("evaluateDatabaseReadiness", () => {
  it("fails closed on a missing production DATABASE_URL without querying PGLite", async () => {
    let calls = 0;
    const result = await evaluateDatabaseReadiness({
      ...base,
      databaseUrl: "   ",
      query: async () => {
        calls += 1;
        return [];
      },
    });

    assert.equal(calls, 0);
    assert.deepEqual(result, {
      ok: false,
      backend: "neon",
      code: "DATABASE_URL_MISSING",
      publicCode: "AUTH_DATABASE_NOT_CONFIGURED",
      publicMessage:
        "Account storage is not connected on this deployment yet. " +
        "A persistent database must be connected before accounts can be created or used.",
    });
  });

  it("distinguishes a database connection failure without leaking driver details", async () => {
    const result = await evaluateDatabaseReadiness({
      ...base,
      query: async () => {
        throw Object.assign(new Error("postgres://secret-user:secret-password@host/db"), {
          code: "ECONNREFUSED",
        });
      },
    });

    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.code, "DATABASE_UNREACHABLE");
    assert.equal(result.publicCode, "DATABASE_UNAVAILABLE");
    assert.equal(result.driverCode, "ECONNREFUSED");
    assert.ok(!result.publicMessage.includes("secret-password"));
    assert.ok(!result.publicMessage.includes("postgres://"));
  });

  it("reports missing auth/core tables as schema-not-ready", async () => {
    let queryCount = 0;
    const result = await evaluateDatabaseReadiness({
      ...base,
      query: async (_sql, params = []) => {
        queryCount += 1;
        if (queryCount === 1) return [{ ready: 1 }];
        assert.deepEqual(params[0], [...REQUIRED_DATABASE_TABLES]);
        return [{ name: "account" }, { name: "mcp_oauth_codes" }];
      },
    });

    assert.equal(queryCount, 2);
    assert.deepEqual(result, {
      ok: false,
      backend: "neon",
      code: "DATABASE_SCHEMA_MISSING",
      publicCode: "DATABASE_SCHEMA_NOT_READY",
      publicMessage: "Account storage is not ready yet. Please try again shortly.",
      missingTables: ["account", "mcp_oauth_codes"],
    });
  });

  it("does not mistake a healthy connection for a complete schema", async () => {
    let queryCount = 0;
    const result = await evaluateDatabaseReadiness({
      ...base,
      query: async () => {
        queryCount += 1;
        return queryCount === 1 ? [{ ready: 1 }] : [];
      },
    });

    assert.deepEqual(result, { ok: true, backend: "neon" });
  });

  it("allows local/preview PGLite while retaining the same schema check", async () => {
    const result = await evaluateDatabaseReadiness({
      nodeEnv: "development",
      databaseUrl: undefined,
      backend: "pglite",
      query: async (_sql) => [{ ready: 1 }],
    });
    assert.deepEqual(result, { ok: true, backend: "pglite" });
  });

  it("sanitizes a schema probe permission failure", async () => {
    let queryCount = 0;
    const result = await evaluateDatabaseReadiness({
      ...base,
      query: async () => {
        queryCount += 1;
        if (queryCount === 1) return [{ ready: 1 }];
        throw Object.assign(new Error("internal SQL statement with password"), { code: "42501" });
      },
    });

    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.code, "DATABASE_SCHEMA_CHECK_FAILED");
    assert.equal(result.publicCode, "DATABASE_UNAVAILABLE");
    assert.ok(!result.publicMessage.includes("password"));
    assert.ok(!result.publicMessage.includes("SELECT"));
  });
});
