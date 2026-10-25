# MVM3D deployment environment requirements

This document describes the intended production deployment at `https://mvm3d.vercel.app`. The `mvm3d` Vercel project is the active project for this app; do not point its OAuth/MCP configuration at the separate `3dmvm` or `mvm3dforge` projects.

## Environment matrix

| Variable | Local development | Vercel Preview | Vercel Production |
|---|---|---|---|
| `DATABASE_URL` | Optional for local-only work; set a developer-owned PostgreSQL URL to test durable auth/data. Without it, local storage may use in-process PGlite and is not durable. | Required for persistent account, OAuth-client, token, and project data. Must point to an isolated Preview database, never the Production database. Currently no Preview-target value is configured. | Required. A sensitive Production-target Vercel variable already exists. Remote MCP fails closed if the runtime does not select persistent PostgreSQL. |
| `DATABASE_URL_MIGRATIONS` | Optional; if your database provider supplies a direct/unpooled endpoint, use it for migrations. Otherwise the migrator falls back to `DATABASE_URL`. | Optional; use a Preview-only direct/unpooled endpoint when provided. Otherwise falls back to the isolated Preview `DATABASE_URL`. | Optional but recommended for managed PostgreSQL/Neon when a direct/unpooled migration endpoint is available. Sensitive/server-only; falls back to `DATABASE_URL` when unset. |
| `BETTER_AUTH_URL` | Usually omit for dynamic localhost development, or use `http://localhost:8080` for explicit local testing. | Do not copy the Production value. The app derives/trusts the actual Preview host at runtime. | Currently unset on the `mvm3d` project; if explicitly configured, use `https://mvm3d.vercel.app`. |
| `MCP_PUBLIC_URL` | Usually omit; local fallback is `http://localhost:8080`. | Usually omit; OAuth metadata derives the branch/deployment hostname. An explicit value must be that exact Preview origin, not the Production origin. | Currently unset on the `mvm3d` project; OAuth/MCP metadata derives the Vercel production host. If explicitly configured, use `https://mvm3d.vercel.app`. |
| `MCP_ALLOWED_HOSTS` | Optional exact comma-separated host allow-list; loopback development hosts are allowed by default. | Optional exact host override. Without it, the app trusts only `MCP_PUBLIC_URL`, `VERCEL_BRANCH_URL`, and `VERCEL_URL`. | Optional exact host override. Without it, the app trusts `https://mvm3d.vercel.app`, `VERCEL_PROJECT_PRODUCTION_URL`, and `VERCEL_URL`. No broad Vercel suffix patterns or aliases for other projects are accepted. |
| `MCP_ALLOWED_ORIGINS` | Optional comma-separated exact origins. Local HTTP is limited to loopback development. | Optional comma-separated exact HTTPS origins for trusted browser clients. | Optional comma-separated exact HTTPS origins for trusted browser clients. A configured list replaces inferred defaults; malformed non-empty configuration fails closed. |
| `BETTER_AUTH_SECRET` | Optional; use a stable local secret if needed. | Optional; if configured, use a Preview-only stable secret. | Optional in the current implementation: when unset with a Production `DATABASE_URL`, the server derives a stable secret from that DB URL. If an explicit secret is added or changed, existing sessions can be invalidated. |

The build-time migrator uses `DATABASE_URL_MIGRATIONS` when set, otherwise `DATABASE_URL`. If Neon supplies both pooled and direct URLs, keep the pooled URL for normal serverless application traffic and prefer the direct/unpooled URL for schema migrations. All migration statements are transaction-scoped and do not depend on session-level locks.

All database URLs, explicit auth secrets, API credentials, and tokens must remain server-only. Never prefix them with `VITE_`, add them to source files, or print them in logs. `DATABASE_URL` must be a sensitive/encrypted Vercel environment variable.

## What is configured now

The Vercel project was inspected without decrypting secrets:

- `BETTER_AUTH_URL` and `MCP_PUBLIC_URL`: currently unset on the `mvm3d` project. The app can infer the production host from Vercel metadata; if either variable is intentionally set for Production, set it to `https://mvm3d.vercel.app`.
- `DATABASE_URL`: a sensitive Production-target Vercel variable exists; no Preview-target entry is configured.
- Read-only checks of `https://mvm3d.vercel.app/.well-known/oauth-authorization-server` and `/.well-known/oauth-protected-resource` return HTTP 200 and advertise `https://mvm3d.vercel.app` as the issuer/resource origin. `GET /api/auth/get-session` returns HTTP 200 with `null` for an unauthenticated visitor. These checks do not replace a signed-in OAuth/token/MCP end-to-end test.
- No environment values were changed and no secrets were decrypted, copied, or exposed.

## Required Vercel dashboard steps

1. Open the Vercel team that owns the active `mvm3d` project, then **Project → Settings → Environment Variables**.
2. For **Production**, confirm `DATABASE_URL` is a sensitive value pointing to the intended persistent PostgreSQL database, and that its role can run the repository migrations and read/write the auth, OAuth, and project tables. The existing entry is Production-only. If its value needs correction, replace it with the real provider-issued URL; do not create a guessed URL. Redeploy Production after changing it. `BETTER_AUTH_URL` and `MCP_PUBLIC_URL` are optional while the app correctly infers the Vercel production hostname; if you set them explicitly, use `https://mvm3d.vercel.app` for both.
3. For **Preview**, provision a separate PostgreSQL/Neon database first. Add its provider-issued URL as a sensitive `DATABASE_URL` targeted to Preview (or to a limited branch-specific Preview environment). Do not reuse Production's database: Preview tools can create projects and OAuth registrations. If Preview storage is not provisioned, leave `DATABASE_URL` unset and accept the fail-closed `503` on remote MCP instead of allowing ephemeral storage.
4. Do not set Preview `BETTER_AUTH_URL` or `MCP_PUBLIC_URL` to the Production origin `https://mvm3d.vercel.app`. Preview derives its own host from Vercel's branch/deployment variables; if you intentionally set either variable, use the exact verified Preview origin.
5. For local development, keep `.env` ignored. Set a developer-owned `DATABASE_URL` only when local persistent DB testing is needed; use `http://localhost:8080` for explicit local auth/MCP origins. Never commit `.env`.

## Migration execution rules

- `migrations/*.sql` (top-level only) is the executable, ordered migration inventory.
- `migrations/0001_auth.sql` is the executable Better Auth schema. `migrations/auth/0001_auth.sql` is its reference/source copy and must stay byte-identical. The runner intentionally does not recurse into `migrations/auth/`; both copies have the same basename and recursively applying both would collide in the migration ledger.
- A configured database with a missing/empty migration inventory or a missing auth migration fails before running SQL. Vercel Production (and non-Preview production builds) also fails if `DATABASE_URL` is missing; only local and Vercel Preview builds may skip the build-time migration step without a database.
- Each file's SQL and its `_migrations` ledger record are committed in the same transaction. A transaction-scoped advisory lock and a second ledger check protect concurrent deployments, and transient connection/serialization errors can retry the complete pass. The runner never drops or resets existing tables.
- The CI migration regression starts a fresh, disposable PostgreSQL service, runs the actual migrator twice, verifies auth/project/MCP tables and ledger entries, and checks that a sentinel project row survives the rerun. It does not connect to the Production database.

## Runtime database readiness (Task 6)

The server-only `inspectDatabaseReadiness()` probe runs before Better Auth and remote MCP handlers. It performs a lightweight `SELECT 1` connectivity query and verifies the required migration ledger, auth, project, API-key, execution-job, and OAuth tables. In Production, a missing/blank `DATABASE_URL` is rejected before the process-local PGLite fallback can be used for requests.

Internal logs contain one of the following stable categories, with repeated identical errors throttled per warm process:

| Internal category | Meaning | Structured log context |
|---|---|---|
| `DATABASE_URL_MISSING` | Production runtime has no nonblank `DATABASE_URL`. | Fixed configuration warning; never the variable value. |
| `DATABASE_UNREACHABLE` | The connection query failed or the driver reported a connection/server error during the schema probe. | Backend name and a sanitized driver error code only. |
| `DATABASE_SCHEMA_MISSING` | Connection works, but one or more required relations are absent. | Exact source-controlled table names missing from the required schema. |
| `DATABASE_SCHEMA_CHECK_FAILED` | The database is reachable, but the schema probe itself failed for a non-connection reason (for example, permission denied). | Backend and sanitized driver code only. |

Client-facing auth responses expose only a stable code and safe message. MCP receives a generic sanitized 503/JSON-RPC error. URLs, usernames, passwords, SQL text, exception messages, and stack traces are never serialized into these readiness responses. Fix the issue indicated by server logs; do not bypass the production guard.

The probe verifies current connectivity and schema shape, not whether the database provider has backups, high availability, or correct retention. A green readiness result is not itself proof of account/session end-to-end behavior.

## Origin and domain allow-list (Task 10)

- Production uses the canonical `https://mvm3d.vercel.app` origin plus only the exact audited project aliases and Vercel-reported Production hosts. The unrelated `3dmvm` and `mvm3dforge` projects, arbitrary Vercel suffixes, wildcard host entries, and non-standard external ports are not trusted.
- Vercel Preview uses only its own `VERCEL_BRANCH_URL` / `VERCEL_URL` hosts. A stale Production `BETTER_AUTH_URL` or `MCP_PUBLIC_URL` value is ignored/rejected rather than added to Preview's origin or host allow-list. Production-only aliases are not accepted as Preview origins.
- The OAuth/MCP issuer remains `https://mvm3d.vercel.app` by default. An explicit `MCP_PUBLIC_URL` must be a strict root origin with no credentials/path/query/fragment/wildcard/foreign port; Production accepts only the canonical or exact verified Vercel origins, and Preview accepts only its exact branch/deployment origin.
- Both MCP route implementations prefer Vercel's `x-forwarded-host` public host and compare it to an exact allow-list. They reject an untrusted Host before database/auth work. When a browser Origin is present it must match that public request origin, unless an operator explicitly sets the exact `MCP_ALLOWED_ORIGINS` allow-list for cross-origin browser clients. Native MCP transports may omit Origin, but still must pass host and bearer authentication checks.
- OAuth consent is stricter than general MCP cross-origin access: it requires a valid same-origin `Origin` or a strict matching `Referer` when Origin is absent. `Origin: null`, missing both headers, foreign origins, a Host/forwarded-host mismatch, malformed URLs, and stale Production origins in Preview are rejected.
- `MCP_ALLOWED_HOSTS` and `MCP_ALLOWED_ORIGINS` are exact comma-separated allow-lists, not glob/prefix/suffix patterns. A non-empty malformed list fails closed as a whole, rather than partially accepting only its valid entries. Origins containing credentials, paths, queries, fragments, unexpected ports, or non-HTTPS external schemes are rejected.
- CORS responses never reflect a rejected Origin through `Access-Control-Allow-Origin`. Better Auth's trusted origins are scoped per environment: Production excludes loopback and sandbox-preview wildcards; Vercel Preview excludes Production hosts; local/test keeps loopback origins. The `https://*.grok-sandbox.com` wildcard is retained only for the documented non-Vercel workspace-preview/local runtime.

## Smoke-test interpretation

The credential-free production smoke test checks OAuth discovery, protected-resource metadata, login route availability, safe rejection of an incomplete authorization request, CORS preflight, and the unauthenticated MCP challenge. It does not register a client, submit consent, read/write project data, or prove database credentials by itself. A separate real-user OAuth consent → token exchange → authenticated MCP tool-call remains required before claiming full end-to-end verification.
