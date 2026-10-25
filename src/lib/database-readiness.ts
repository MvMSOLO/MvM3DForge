export type DatabaseBackend = "neon" | "pglite";

export type DatabaseReadinessFailureCode =
  | "DATABASE_URL_MISSING"
  | "DATABASE_UNREACHABLE"
  | "DATABASE_SCHEMA_MISSING"
  | "DATABASE_SCHEMA_CHECK_FAILED";

export type DatabaseReadiness =
  | { ok: true; backend: DatabaseBackend }
  | {
      ok: false;
      code: DatabaseReadinessFailureCode;
      publicCode: "AUTH_DATABASE_NOT_CONFIGURED" | "DATABASE_UNAVAILABLE" | "DATABASE_SCHEMA_NOT_READY";
      publicMessage: string;
      backend: DatabaseBackend;
      /** Safe structured fields for server logs only. Never serialize this whole result to clients. */
      missingTables?: string[];
      driverCode?: string;
    };

export type ReadinessQuery = (
  sql: string,
  params?: unknown[],
) => Promise<Array<Record<string, unknown>>>;

/**
 * Core relations required for production auth, project storage, and remote MCP.
 * Names are fixed source-controlled identifiers, never derived from request input.
 */
export const REQUIRED_DATABASE_TABLES = [
  "_migrations",
  "user",
  "session",
  "account",
  "verification",
  "projects",
  "mcp_api_keys",
  "mcp_execution_jobs",
  "mcp_oauth_clients",
  "mcp_oauth_codes",
  "mcp_oauth_refresh_tokens",
] as const;

const MISSING_DATABASE_MESSAGE =
  "Account storage is not connected on this deployment yet. " +
  "A persistent database must be connected before accounts can be created or used.";
const DATABASE_UNAVAILABLE_MESSAGE =
  "Database service is temporarily unavailable. Please try again shortly.";
const DATABASE_SCHEMA_MESSAGE =
  "Account storage is not ready yet. Please try again shortly.";

function databaseErrorCode(error: unknown): string | undefined {
  if (!error || typeof error !== "object" || !("code" in error)) return undefined;
  const code = error.code;
  if (typeof code !== "string" || !/^[A-Za-z0-9_-]{2,16}$/.test(code)) return undefined;
  return code;
}

function isConnectionError(code: string | undefined): boolean {
  if (!code) return false;
  return (
    code.startsWith("08") ||
    [
      "ECONNRESET",
      "ECONNREFUSED",
      "ETIMEDOUT",
      "EPIPE",
      "EHOSTUNREACH",
      "ENETUNREACH",
      "ENOTFOUND",
      "57P01",
      "57P02",
      "57P03",
      "53300",
    ].includes(code)
  );
}

function failure(
  backend: DatabaseBackend,
  code: DatabaseReadinessFailureCode,
  extras: { missingTables?: string[]; driverCode?: string } = {},
): DatabaseReadiness {
  if (code === "DATABASE_URL_MISSING") {
    return {
      ok: false,
      backend,
      code,
      publicCode: "AUTH_DATABASE_NOT_CONFIGURED",
      publicMessage: MISSING_DATABASE_MESSAGE,
      ...extras,
    };
  }

  if (code === "DATABASE_SCHEMA_MISSING") {
    return {
      ok: false,
      backend,
      code,
      publicCode: "DATABASE_SCHEMA_NOT_READY",
      publicMessage: DATABASE_SCHEMA_MESSAGE,
      ...extras,
    };
  }

  return {
    ok: false,
    backend,
    code,
    publicCode: "DATABASE_UNAVAILABLE",
    publicMessage: DATABASE_UNAVAILABLE_MESSAGE,
    ...extras,
  };
}

/**
 * Performs a lightweight connection probe and verifies required schema.
 * Caller supplies a server-side query function; this module never reads or
 * exposes connection strings itself, so it is safe to unit test with a fake DB.
 */
export async function evaluateDatabaseReadiness(input: {
  nodeEnv: string | undefined;
  databaseUrl: string | undefined;
  backend: DatabaseBackend;
  query: ReadinessQuery;
}): Promise<DatabaseReadiness> {
  const { nodeEnv, backend, query } = input;
  if (nodeEnv === "production" && !input.databaseUrl?.trim()) {
    return failure(backend, "DATABASE_URL_MISSING");
  }

  try {
    await query("SELECT 1 AS ready");
  } catch (error) {
    const driverCode = databaseErrorCode(error);
    return failure(backend, "DATABASE_UNREACHABLE", { driverCode });
  }

  try {
    const rows = await query(
      "SELECT name FROM unnest($1::text[]) AS required(name) WHERE to_regclass('public.' || quote_ident(required.name)) IS NULL ORDER BY name",
      [[...REQUIRED_DATABASE_TABLES]],
    );
    const missingTables = rows
      .map((row) => row.name)
      .filter((name): name is string => typeof name === "string");

    if (missingTables.length > 0) {
      return failure(backend, "DATABASE_SCHEMA_MISSING", { missingTables });
    }
  } catch (error) {
    const driverCode = databaseErrorCode(error);
    return failure(
      backend,
      isConnectionError(driverCode) ? "DATABASE_UNREACHABLE" : "DATABASE_SCHEMA_CHECK_FAILED",
      { driverCode },
    );
  }

  return { ok: true, backend };
}
