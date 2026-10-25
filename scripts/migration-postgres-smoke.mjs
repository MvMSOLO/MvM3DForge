#!/usr/bin/env node
/**
 * Disposable-PostgreSQL migration integration smoke test.
 *
 * This test never drops, truncates, or resets a database. It requires an
 * explicitly named local test database that has no app tables yet, runs the
 * real deploy migrator twice, and verifies schema, ledger stability, and data
 * survival. GitHub Actions supplies a fresh postgres service for each run.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { isMigrationFile } from "./migration-plan.mjs";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const migrationsDir = join(root, "migrations");
const rawTestUrl = process.env.MIGRATION_TEST_DATABASE_URL?.trim();

function assertSafeTestDatabase(rawUrl) {
  if (!rawUrl) {
    throw new Error(
      "Set MIGRATION_TEST_DATABASE_URL to a disposable local database named mvm3_migration_test.",
    );
  }

  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error("MIGRATION_TEST_DATABASE_URL is not a valid PostgreSQL URL.");
  }

  const databaseName = decodeURIComponent(url.pathname.replace(/^\/+/, ""));
  if (
    !["localhost", "127.0.0.1", "::1"].includes(url.hostname) ||
    databaseName !== "mvm3_migration_test"
  ) {
    throw new Error(
      "Safety stop: migration smoke tests only run against localhost/loopback database mvm3_migration_test.",
    );
  }

  return rawUrl;
}

function runMigrator(testUrl, pass) {
  const result = spawnSync(process.execPath, [join(root, "scripts", "migrate.mjs")], {
    cwd: root,
    encoding: "utf8",
    env: {
      ...process.env,
      DATABASE_URL: testUrl,
      DATABASE_URL_MIGRATIONS: testUrl,
      NODE_ENV: "test",
      VERCEL_ENV: "preview",
    },
    maxBuffer: 1024 * 1024,
  });

  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(
      `migration pass ${pass} failed (exit ${result.status}).\\n` +
        `stdout:\\n${result.stdout}\\nstderr:\\n${result.stderr}`,
    );
  }

  console.log(`[migration-smoke] migrator pass ${pass} succeeded.`);
}

const testUrl = assertSafeTestDatabase(rawTestUrl);
const expectedMigrations = readdirSync(migrationsDir)
  .filter(isMigrationFile)
  .sort((a, b) => a.localeCompare(b));
assert.ok(expectedMigrations.length > 0, "repository must contain top-level SQL migrations");
assert.ok(expectedMigrations.includes("0001_auth.sql"), "auth migration must be executable at the root");

const pool = new pg.Pool({ connectionString: testUrl, max: 1 });
try {
  // An existing ledger or application table means this is not a fresh test DB.
  // Abort rather than deleting anything from a potentially valuable database.
  const checkNames = [
    "public._migrations",
    'public."user"',
    "public.projects",
    "public.mcp_api_keys",
  ];
  for (const name of checkNames) {
    const result = await pool.query("SELECT to_regclass($1) AS relation", [name]);
    assert.equal(
      result.rows[0]?.relation ?? null,
      null,
      `Safety stop: ${name} already exists. Use a fresh local mvm3_migration_test database; this script will not reset it.`,
    );
  }
} finally {
  await pool.end();
}

runMigrator(testUrl, 1);

const verifyPool = new pg.Pool({ connectionString: testUrl, max: 1 });
const requiredRelations = [
  'public."user"',
  'public."session"',
  'public."account"',
  'public."verification"',
  "public.projects",
  "public.mcp_api_keys",
  "public.mcp_execution_jobs",
  "public.mcp_oauth_clients",
  "public.mcp_oauth_codes",
  "public.mcp_oauth_refresh_tokens",
];
const sentinelId = `migration-smoke-${randomUUID()}`;

try {
  for (const name of requiredRelations) {
    const result = await verifyPool.query("SELECT to_regclass($1) AS relation", [name]);
    assert.ok(result.rows[0]?.relation, `required schema relation is missing: ${name}`);
  }

  const applied = await verifyPool.query("SELECT name FROM _migrations");
  const appliedNames = applied.rows.map((row) => row.name).sort((a, b) => a.localeCompare(b));
  assert.deepEqual(appliedNames, expectedMigrations, "every root SQL migration must be recorded once");

  // Sentinel data proves a rerun neither resets nor replaces existing project data.
  await verifyPool.query(
    "INSERT INTO projects (id, user_id, name, scene_json, objects_json, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6, $6)",
    [sentinelId, "migration-smoke-user", "migration smoke sentinel", "{}", "[]", Date.now()],
  );

  runMigrator(testUrl, 2);

  const rowsAfterRerun = await verifyPool.query("SELECT name FROM _migrations");
  const namesAfterRerun = rowsAfterRerun.rows
    .map((row) => row.name)
    .sort((a, b) => a.localeCompare(b));
  assert.deepEqual(namesAfterRerun, expectedMigrations, "rerun must not duplicate migration ledger rows");

  const sentinel = await verifyPool.query("SELECT name FROM projects WHERE id = $1", [sentinelId]);
  assert.equal(sentinel.rows[0]?.name, "migration smoke sentinel", "rerun must preserve existing project data");

  console.log(
    `[migration-smoke] PASS: ${expectedMigrations.length} migration(s), required auth/MCP/project tables, safe rerun, and sentinel data preservation.`,
  );
} finally {
  await verifyPool.end();
}
