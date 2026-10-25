#!/usr/bin/env node
/**
 * Deploy-time database migrator (node-postgres, pg).
 *
 * Runs after the Vite build on Vercel. Only migrations/*.sql are executable;
 * migrations/auth/0001_auth.sql is a byte-identical reference copy of the
 * executable migrations/0001_auth.sql. Per-file DDL and its _migrations row are
 * atomic. A transaction-scoped advisory lock + a second ledger check prevents
 * two concurrent deploys from applying the same file twice, including when
 * DATABASE_URL points at a transaction-pooled PostgreSQL endpoint.
 *
 * Local and Vercel Preview builds may skip this build-time step without a DB.
 * Vercel Production (and other non-Preview production builds) fail closed when
 * DATABASE_URL is missing. PGLite startup is not durable production storage.
 */
import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import pg from "pg";
import {
  isMigrationFile,
  isRetryableMigrationError,
  migrationInventoryFailures,
  pendingMigrations,
  requiresDatabaseForMigrations,
} from "./migration-plan.mjs";

const env = (key) => process.env[key]?.trim() || undefined;
const databaseUrl = env("DATABASE_URL");
const migrationDatabaseUrl = env("DATABASE_URL_MIGRATIONS") ?? databaseUrl;
const mustHaveDatabase = requiresDatabaseForMigrations(process.env);
const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), "..", "migrations");

// A namespaced, transaction-scoped lock. Unlike pg_advisory_lock(), this lock
// is released automatically at COMMIT/ROLLBACK and works through transaction
// poolers such as PgBouncer.
const MIGRATION_LOCK_NAMESPACE = 0x4d564d33; // "MVM3"
const MIGRATION_LOCK_ID = 1;
const MAX_ATTEMPTS = 3;

if (!databaseUrl) {
  if (mustHaveDatabase) {
    console.error(
      "[migrate] DATABASE_URL is required for Production builds. Refusing to skip database migrations.",
    );
    process.exit(1);
  }

  console.log(
    "[migrate] DATABASE_URL not set — skipping build-time SQL migrations for local/Preview. " +
      "The PGLite fallback is not durable production storage.",
  );
  process.exit(0);
}

/** Read only executable top-level migrations and validate the auth source copy. */
async function loadMigrationInventory() {
  let entries;
  try {
    entries = await readdir(migrationsDir);
  } catch (err) {
    if (err?.code === "ENOENT") {
      throw new Error("[migrate] required migrations/ directory is missing.");
    }
    throw err;
  }

  const failures = migrationInventoryFailures(entries, { requireAuthSchema: true });
  if (failures.length) throw new Error(`[migrate] invalid migration inventory: ${failures.join(" ")}`);

  const rootAuthPath = join(migrationsDir, "0001_auth.sql");
  const authSourcePath = join(migrationsDir, "auth", "0001_auth.sql");
  let rootAuth;
  let authSource;
  try {
    [rootAuth, authSource] = await Promise.all([
      readFile(rootAuthPath, "utf8"),
      readFile(authSourcePath, "utf8"),
    ]);
  } catch {
    throw new Error(
      "[migrate] auth migration is incomplete: both migrations/0001_auth.sql and " +
        "migrations/auth/0001_auth.sql must exist.",
    );
  }
  if (rootAuth !== authSource) {
    throw new Error(
      "[migrate] auth migration copies differ. Keep migrations/0001_auth.sql byte-identical " +
        "to migrations/auth/0001_auth.sql; refusing to apply a potentially stale auth schema.",
    );
  }

  return entries.filter(isMigrationFile).sort((a, b) => a.localeCompare(b));
}

/** Run work atomically and roll back if any statement fails. */
async function inTransaction(client, work) {
  let began = false;
  try {
    await client.query("BEGIN");
    began = true;
    const result = await work();
    await client.query("COMMIT");
    began = false;
    return result;
  } catch (err) {
    if (began) {
      try {
        await client.query("ROLLBACK");
      } catch {
        // Preserve the original failure if the connection has already dropped.
      }
    }
    throw err;
  }
}

async function acquireMigrationLock(client) {
  await client.query("SELECT pg_advisory_xact_lock($1, $2)", [
    MIGRATION_LOCK_NAMESPACE,
    MIGRATION_LOCK_ID,
  ]);
}

/** Create the ledger under the same transaction lock so first deploys cannot race. */
async function ensureMigrationLedger(client) {
  await inTransaction(client, async () => {
    await acquireMigrationLock(client);
    await client.query(
      "CREATE TABLE IF NOT EXISTS _migrations (name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())",
    );
  });
}

async function applyOneMigration(client, migration, sql) {
  return inTransaction(client, async () => {
    await acquireMigrationLock(client);

    // Re-check under the lock: another deployment may have applied this file
    // after our initial ledger read.
    const existing = await client.query(
      "SELECT 1 FROM _migrations WHERE name = $1",
      [migration.name],
    );
    if (existing.rowCount > 0) return false;

    // SQL files may contain multiple statements; node-postgres uses the simple
    // query protocol for this call. The ledger row commits in the same tx.
    await client.query(sql);
    await client.query("INSERT INTO _migrations (name) VALUES ($1)", [migration.name]);
    return true;
  });
}

async function runMigrationAttempt(entries) {
  const pool = new pg.Pool({
    connectionString: migrationDatabaseUrl,
    max: 1,
    connectionTimeoutMillis: 10_000,
  });
  let client;
  let attemptError;

  try {
    client = await pool.connect();
    await client.query("SELECT 1");
    await ensureMigrationLedger(client);

    const appliedRows = await client.query("SELECT name FROM _migrations");
    const applied = appliedRows.rows.map((row) => row.name);
    const pending = pendingMigrations(entries, applied);
    let count = 0;

    for (const migration of pending) {
      // File I/O stays outside the SQL transaction to avoid holding locks while
      // reading from disk. The file's DDL + ledger row are applied atomically.
      const sql = await readFile(join(migrationsDir, migration.path), "utf8");
      const didApply = await applyOneMigration(client, migration, sql);
      if (didApply) {
        console.log(`[migrate] applied ${migration.name}`);
        count += 1;
      } else {
        console.log(`[migrate] skipped ${migration.name} (already applied by another deploy)`);
      }
    }

    console.log(
      count
        ? `[migrate] done — ${count} migration(s) applied.`
        : "[migrate] up to date.",
    );
  } catch (err) {
    attemptError = err;
    throw err;
  } finally {
    if (client) client.release(attemptError instanceof Error ? attemptError : undefined);
    await pool.end();
  }
}

async function main() {
  const entries = await loadMigrationInventory();
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    try {
      await runMigrationAttempt(entries);
      return;
    } catch (err) {
      if (attempt >= MAX_ATTEMPTS || !isRetryableMigrationError(err)) throw err;
      const code = typeof err?.code === "string" ? err.code : "transient connection error";
      console.warn(
        `[migrate] transient database failure (${code}); retrying a ledger-safe pass ${attempt}/${MAX_ATTEMPTS - 1}.`,
      );
      await delay(250 * attempt);
    }
  }
}

main().catch((err) => {
  console.error("[migrate] failed:", err?.message || err);
  for (const key of ["code", "detail", "hint", "position", "where"]) {
    if (err?.[key] != null) console.error(`[migrate]   ${key}: ${err[key]}`);
  }
  process.exit(1);
});
