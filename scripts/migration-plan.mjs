// @ts-check
/**
 * Migration bookkeeping shared by the deploy migrator (readdir) and PGLite
 * bootstrap (import.meta.glob).
 *
 * Only top-level migrations/*.sql files are executable. migrations/auth/
 * contains the source copy of the Better Auth schema and must not be traversed:
 * migrations/0001_auth.sql is its executable copy. Both files deliberately have
 * the same basename, and a recursive scan would schedule that migration twice.
 */

/**
 * The _migrations key for a migration path (or bare filename).
 * @param {string} path
 * @returns {string}
 */
export function migrationName(path) {
  return path.replace(/\\/g, "/").split("/").pop() ?? path;
}

/**
 * Whether path names a top-level SQL migration.
 *
 * Supported inputs are a bare filename from readdir() or the Vite glob form
 * /migrations/<filename>.sql. Nested directories are intentionally excluded.
 * @param {string} path
 * @returns {boolean}
 */
export function isMigrationFile(path) {
  if (typeof path !== "string" || !path.endsWith(".sql")) return false;
  const segments = path.replace(/\\/g, "/").split("/").filter(Boolean);
  return (
    segments.length === 1 ||
    (segments.length === 2 && segments[0] === "migrations")
  );
}

/**
 * Migrations in paths that are not yet in applied, in apply order.
 * @param {Iterable<string>} paths
 * @param {Iterable<string>} applied
 * @returns {Array<{ name: string, path: string }>}
 */
export function pendingMigrations(paths, applied) {
  const done = new Set(applied);
  return [...paths]
    .filter(isMigrationFile)
    .map((path) => ({ name: migrationName(path), path }))
    .sort((a, b) => a.name.localeCompare(b.name))
    .filter(({ name }) => !done.has(name));
}

/**
 * Production builds must not silently ship without a persistent database.
 * Vercel Preview is explicitly excluded so previews can be built without a DB;
 * the app's remote MCP storage guard remains fail-closed in that case.
 * @param {Record<string, string | undefined>} env
 * @returns {boolean}
 */
export function requiresDatabaseForMigrations(env = process.env) {
  const vercelEnv = env.VERCEL_ENV?.trim().toLowerCase();
  const nodeEnv = env.NODE_ENV?.trim().toLowerCase();
  return (
    vercelEnv === "production" ||
    (nodeEnv === "production" && vercelEnv !== "preview")
  );
}

/**
 * Validate the executable migration inventory before connecting to a database.
 * @param {Iterable<string>} paths
 * @param {{ requireAuthSchema?: boolean }} [options]
 * @returns {string[]}
 */
export function migrationInventoryFailures(paths, { requireAuthSchema = false } = {}) {
  const names = [...paths].filter(isMigrationFile).map(migrationName);
  const failures = [];
  if (names.length === 0) {
    failures.push("No top-level SQL migrations found in migrations/.");
  }
  if (requireAuthSchema && !names.includes("0001_auth.sql")) {
    failures.push("Required auth migration migrations/0001_auth.sql is missing.");
  }
  return failures;
}

/**
 * Transient connection/server errors and serialization conflicts can be retried
 * safely because each file and its _migrations ledger row commit atomically.
 * Do not retry SQL syntax, permissions, or schema errors.
 * @param {unknown} error
 * @returns {boolean}
 */
export function isRetryableMigrationError(error) {
  if (!error || typeof error !== "object") return false;
  const code = "code" in error && typeof error.code === "string" ? error.code : "";
  return (
    code.startsWith("08") ||
    [
      "40001",
      "40P01",
      "53300",
      "57P01",
      "57P02",
      "57P03",
      "ECONNRESET",
      "ECONNREFUSED",
      "ETIMEDOUT",
      "EPIPE",
      "EHOSTUNREACH",
      "ENETUNREACH",
      "ENOTFOUND",
    ].includes(code)
  );
}
