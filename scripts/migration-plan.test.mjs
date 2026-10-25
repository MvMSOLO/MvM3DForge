import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  isMigrationFile,
  isRetryableMigrationError,
  migrationInventoryFailures,
  migrationName,
  pendingMigrations,
  requiresDatabaseForMigrations,
} from "./migration-plan.mjs";
import { projectRoot } from "./with-app-env.mjs";

const AUTH_MIGRATION = "0001_auth.sql";

/** Return the executable auth migration and the reference copy, if both exist. */
function authSchemaCopy(root) {
  const copy = join(root, "migrations", AUTH_MIGRATION);
  const source = join(root, "migrations/auth", AUTH_MIGRATION);
  if (!existsSync(copy) || !existsSync(source)) return null;
  return { copy: readFileSync(copy, "utf8"), source: readFileSync(source, "utf8") };
}

test("_migrations keys on the basename", () => {
  assert.equal(migrationName("/migrations/0002_todos.sql"), "0002_todos.sql");
  assert.equal(migrationName("migrations/auth/0001_auth.sql"), "0001_auth.sql");
  assert.equal(migrationName("migrations\\auth\\0001_auth.sql"), "0001_auth.sql");
});

test("only top-level SQL files are executable migrations", () => {
  assert.equal(isMigrationFile("0001_auth.sql"), true);
  assert.equal(isMigrationFile("/migrations/0001_auth.sql"), true);
  assert.equal(isMigrationFile("migrations/auth/0001_auth.sql"), false);
  assert.equal(isMigrationFile("/migrations/auth/0001_auth.sql"), false);
  assert.equal(isMigrationFile("auth"), false);
  assert.equal(isMigrationFile("README.md"), false);

  // Even if a caller accidentally passes a recursive listing, the auth source
  // copy cannot collide with the executable root migration of the same name.
  assert.deepEqual(
    pendingMigrations(
      ["/migrations/0001_auth.sql", "/migrations/auth/0001_auth.sql"],
      [],
    ),
    [{ name: "0001_auth.sql", path: "/migrations/0001_auth.sql" }],
  );
});

test("a file already applied under the same basename is not re-applied", () => {
  assert.deepEqual(
    pendingMigrations(["/migrations/0001_auth.sql"], ["0001_auth.sql"]),
    [],
  );
});

test("pending migrations are returned in stable filename order", () => {
  assert.deepEqual(
    pendingMigrations(
      ["/migrations/0003_c.sql", "/migrations/0001_a.sql", "/migrations/0002_b.sql"],
      ["0001_a.sql"],
    ),
    [
      { name: "0002_b.sql", path: "/migrations/0002_b.sql" },
      { name: "0003_c.sql", path: "/migrations/0003_c.sql" },
    ],
  );
});

test("an empty production inventory or missing auth schema is rejected", () => {
  assert.deepEqual(migrationInventoryFailures(["auth", "README.md"]), [
    "No top-level SQL migrations found in migrations/.",
  ]);
  assert.deepEqual(
    migrationInventoryFailures(["0002_projects.sql"], { requireAuthSchema: true }),
    ["Required auth migration migrations/0001_auth.sql is missing."],
  );
  assert.deepEqual(
    migrationInventoryFailures(["0001_auth.sql", "0002_projects.sql"], {
      requireAuthSchema: true,
    }),
    [],
  );
});

test("production requires DATABASE_URL but Preview can explicitly build without it", () => {
  assert.equal(requiresDatabaseForMigrations({ VERCEL_ENV: "production" }), true);
  assert.equal(
    requiresDatabaseForMigrations({ NODE_ENV: "production" }),
    true,
  );
  assert.equal(
    requiresDatabaseForMigrations({ NODE_ENV: "production", VERCEL_ENV: "preview" }),
    false,
  );
  assert.equal(
    requiresDatabaseForMigrations({ NODE_ENV: "development", VERCEL_ENV: "development" }),
    false,
  );
});

test("only transient connection and serialization errors are retried", () => {
  assert.equal(isRetryableMigrationError({ code: "ECONNRESET" }), true);
  assert.equal(isRetryableMigrationError({ code: "08006" }), true);
  assert.equal(isRetryableMigrationError({ code: "40001" }), true);
  assert.equal(isRetryableMigrationError({ code: "40P01" }), true);
  assert.equal(isRetryableMigrationError({ code: "42P01" }), false);
  assert.equal(isRetryableMigrationError({ code: "42501" }), false);
  assert.equal(isRetryableMigrationError(null), false);
});

test("the repository ships the executable root migrations and a reference auth source", () => {
  const migrationsDir = join(projectRoot(), "migrations");
  const entries = readdirSync(migrationsDir);
  const rootSql = entries.filter(isMigrationFile).sort((a, b) => a.localeCompare(b));

  assert.ok(rootSql.length > 0, "top-level migrations/*.sql must exist");
  assert.ok(rootSql.includes(AUTH_MIGRATION), "auth schema must be on the executable root path");
  assert.ok(readdirSync(join(migrationsDir, "auth")).includes(AUTH_MIGRATION));
  assert.deepEqual(
    pendingMigrations(entries, []).map(({ name }) => name),
    rootSql,
  );
  assert.deepEqual(migrationInventoryFailures(entries, { requireAuthSchema: true }), []);

  // A recursive listing must still schedule this migration exactly once.
  assert.equal(
    pendingMigrations(
      [...entries, "/migrations/auth/0001_auth.sql"],
      [],
    ).filter(({ name }) => name === AUTH_MIGRATION).length,
    1,
  );
});

test("the executable auth migration remains byte-identical to its source copy", () => {
  const pair = authSchemaCopy(projectRoot());
  assert.ok(pair, "both migrations/0001_auth.sql and migrations/auth/0001_auth.sql must exist");
  assert.equal(
    pair.copy,
    pair.source,
    "migrations/0001_auth.sql must remain a verbatim copy of migrations/auth/0001_auth.sql",
  );
});

test("the copy check detects a drifted auth schema", () => {
  const root = mkdtempSync(join(tmpdir(), "auth-schema-"));
  mkdirSync(join(root, "migrations/auth"), { recursive: true });
  writeFileSync(join(root, "migrations/auth", AUTH_MIGRATION), "create table t ();\\n");
  assert.equal(authSchemaCopy(root), null);

  writeFileSync(join(root, "migrations", AUTH_MIGRATION), "create table t ();\\n");
  const same = authSchemaCopy(root);
  assert.ok(same);
  assert.equal(same.copy, same.source);

  writeFileSync(join(root, "migrations", AUTH_MIGRATION), "create table t (x int);\\n");
  const drifted = authSchemaCopy(root);
  assert.ok(drifted);
  assert.notEqual(drifted.copy, drifted.source);
});
