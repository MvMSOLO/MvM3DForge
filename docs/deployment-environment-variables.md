# MVM3D deployment environment requirements

This document describes the current environment configuration for the active deployment, `https://3dmvm.vercel.app`. Do not use the retired `mvm3d.vercel.app` hostname for new OAuth/MCP setup.

## Environment matrix

| Variable | Local development | Vercel Preview | Vercel Production |
|---|---|---|---|
| `DATABASE_URL` | Optional for local-only work; set a developer-owned PostgreSQL URL to test durable auth/data. Without it, local storage may use in-process PGlite and is not durable. | Required for persistent account, OAuth-client, token, and project data. Must point to an isolated Preview database, never the Production database. Currently no Preview-target value is configured. | Required. A sensitive Production-target Vercel variable already exists. Remote MCP fails closed if the runtime does not select persistent PostgreSQL. |
| `BETTER_AUTH_URL` | Usually omit for dynamic localhost development, or use `http://localhost:8080` for explicit local testing. | Do not copy the Production value. The app derives/trusts the actual Preview host at runtime. | Configured as `https://3dmvm.vercel.app`. |
| `MCP_PUBLIC_URL` | Usually omit; local fallback is `http://localhost:8080`. | Usually omit; OAuth metadata derives the branch/deployment hostname. An explicit value must be that exact Preview origin, not the Production origin. | Configured as `https://3dmvm.vercel.app`. |
| `BETTER_AUTH_SECRET` | Optional; use a stable local secret if needed. | Optional; if configured, use a Preview-only stable secret. | Optional in the current implementation: when unset with a Production `DATABASE_URL`, the server derives a stable secret from that DB URL. If an explicit secret is added or changed, existing sessions can be invalidated. |
| `MCP_ALLOWED_ORIGINS`, `MCP_ALLOWED_HOSTS` | Usually omit. | Only add exact Preview origins/hosts if a real integration requires them. | Usually omit because the known Production origin/hosts are handled by the app. Never use broad wildcards to suppress origin errors. |

All database URLs, explicit auth secrets, API credentials, and tokens must remain server-only. Never prefix them with `VITE_`, add them to source files, or print them in logs. `DATABASE_URL` must be a sensitive/encrypted Vercel environment variable.

## What is configured now

The Vercel project was inspected without decrypting secrets:

- `MCP_PUBLIC_URL`: Production target only, set to `https://3dmvm.vercel.app`.
- `BETTER_AUTH_URL`: Production target only, set to `https://3dmvm.vercel.app`.
- `DATABASE_URL`: a sensitive Production-target entry exists; no Preview-target entry is configured.
- The OAuth/MCP smoke test receives the expected unauthenticated `401` + Bearer challenge instead of the route's `503` for missing persistent storage. This indicates the Production runtime selects the PostgreSQL path, but it is not a substitute for a live DB query or signed-in OAuth end-to-end test.
- No environment values were changed as part of this task. The existing Production secrets were not decrypted, copied, or exposed.

## Required Vercel dashboard steps

1. Open the Vercel team that owns the active `3dmvm` project, then **Project → Settings → Environment Variables**.
2. For **Production**, confirm `DATABASE_URL` is a sensitive value pointing to the intended persistent PostgreSQL database, and that its role can run the repository migrations and read/write the auth, OAuth, and project tables. The existing entry is Production-only. If its value needs correction, replace it with the real provider-issued URL; do not create a guessed URL. Redeploy Production after changing it.
3. For **Preview**, provision a separate PostgreSQL/Neon database first. Add its provider-issued URL as a sensitive `DATABASE_URL` targeted to Preview (or to a limited branch-specific Preview environment). Do not reuse Production's database: Preview tools can create projects and OAuth registrations. If Preview storage is not provisioned, leave `DATABASE_URL` unset and accept the fail-closed `503` on remote MCP instead of allowing ephemeral storage.
4. Do not set Preview `BETTER_AUTH_URL` or `MCP_PUBLIC_URL` to `https://3dmvm.vercel.app`. Preview derives its own host from Vercel's branch/deployment variables; if you intentionally set either variable, use the exact verified Preview origin.
5. For local development, keep `.env` ignored. Set a developer-owned `DATABASE_URL` only when local persistent DB testing is needed; use `http://localhost:8080` for explicit local auth/MCP origins. Never commit `.env`.

## Smoke-test interpretation

The credential-free production smoke test checks OAuth discovery, protected-resource metadata, login route availability, safe rejection of an incomplete authorization request, CORS preflight, and the unauthenticated MCP challenge. It does not register a client, submit consent, read/write project data, or prove database credentials by itself. A separate real-user OAuth consent → token exchange → authenticated MCP tool-call remains required before claiming full end-to-end verification.
