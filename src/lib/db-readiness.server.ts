import { dbSource, getSql } from "./db";
import {
  evaluateDatabaseReadiness,
  type DatabaseReadiness,
} from "./database-readiness";

let lastFailureKey = "";
let lastFailureAt = 0;
const FAILURE_LOG_INTERVAL_MS = 60_000;

function logReadinessFailure(result: Exclude<DatabaseReadiness, { ok: true }>): void {
  const logKey = [result.code, result.backend, result.missingTables?.join(",") ?? ""].join(":");
  const now = Date.now();
  if (logKey === lastFailureKey && now - lastFailureAt < FAILURE_LOG_INTERVAL_MS) return;
  lastFailureKey = logKey;
  lastFailureAt = now;

  if (result.code === "DATABASE_URL_MISSING") {
    console.error("[db-readiness] production requires persistent PostgreSQL; DATABASE_URL is missing.");
    return;
  }
  if (result.code === "DATABASE_SCHEMA_MISSING") {
    console.error("[db-readiness] required database schema is incomplete.", {
      code: result.code,
      backend: result.backend,
      missingTables: result.missingTables ?? [],
    });
    return;
  }
  console.error("[db-readiness] database readiness probe failed.", {
    code: result.code,
    backend: result.backend,
    ...(result.driverCode ? { driverCode: result.driverCode } : {}),
  });
}

/**
 * Runtime-only DB probe. It deliberately returns structured internal evidence
 * but callers must send only publicCode/publicMessage to clients.
 */
export async function inspectDatabaseReadiness(): Promise<DatabaseReadiness> {
  const result = await evaluateDatabaseReadiness({
    nodeEnv: process.env.NODE_ENV,
    databaseUrl: process.env.DATABASE_URL,
    backend: dbSource,
    query: async (statement, params = []) => {
      const sql = await getSql();
      return sql.query<Record<string, unknown>>(statement, params);
    },
  });

  if (result.ok) {
    lastFailureKey = "";
    lastFailureAt = 0;
  } else {
    logReadinessFailure(result);
  }
  return result;
}

/** Construct a safe 503 response without serializing internal table/driver details. */
export function databaseReadinessResponse(
  result: Exclude<DatabaseReadiness, { ok: true }>,
): Response {
  return Response.json(
    {
      code: result.publicCode,
      message: result.publicMessage,
    },
    {
      status: 503,
      headers: { "Cache-Control": "no-store" },
    },
  );
}
