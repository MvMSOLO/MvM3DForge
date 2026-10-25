# MVM3D Production Release & Live Verification Checklist

**Status as of 2026-10-25: code/CI gates passed; full signed-in Production E2E remains BLOCKED.**

Canonical Production origin: https://mvm3d.vercel.app  
Vercel project: `mvm3d` in `mvmsolos-projects`  
Repository: https://github.com/MvMSOLO/MvM3DForge

This is an evidence log and release checklist. It intentionally does not change Production settings, deploy/merge an unapproved PR, decrypt secrets, or create a Production test account.

## What was verified

- Vercel reports Production deployment `dpl_FNQMDdFNR1NiTnM27rYZs3usK5Sd` as `READY`, sourced from `main` commit `c3ea5f6da2473a7ce02432c980d0d741db4f3b14`, with `mvm3d.vercel.app` attached. This is the current verified Production deployment record; it is not the Task 12 PR head.
- GitHub Actions run [40206792891](https://github.com/MvMSOLO/MvM3DForge/actions/runs/40206792891) for Task 12 head `7fab3eec93c546cbfb2b682a07dbe05613ec7656` passed all three jobs: `forge-bridge`, `migration-regression`, and `production-mcp-smoke`.
- The credential-free production smoke script runs against `https://mvm3d.vercel.app`. It verifies OAuth authorization-server and protected-resource metadata (HTTP 200), the `/login` route (HTTP 200), safe rejection of an incomplete authorize request (HTTP 400), rejection of foreign-origin consent (HTTP 403 without reflecting the attacker Origin), CORS preflight (HTTP 204), and an unauthenticated `/mcp` initialize request (HTTP 401 with a Bearer challenge).
- The MCP route checks database readiness before authenticating the caller. Its expected live smoke response is 401 rather than a database-readiness 503, which is evidence the readiness gate passed during that check. It does **not** prove signup, signed-in sessions, or data persistence end to end.
- CI uses isolated PostgreSQL services to verify migration initialization and idempotent rerun/data preservation, signup, duplicate signup rejection, password storage and invalid credentials, session lookup across separate requests, sign-out, session revocation/stale-cookie replay rejection, and the fail-closed missing-database HTTP contract.
- The `mvm3d` Vercel environment-variable inventory was inspected without decrypting values: a sensitive `DATABASE_URL` exists for **Production**. No Preview-target environment variables were listed for the Task 12 branch. `BETTER_AUTH_URL` and `MCP_PUBLIC_URL` are unset and are inferred from the verified Vercel origin. No environment values were changed.
- The safe tracked `.env.example` template is included in this PR. `.env` and other `.env.*` files remain ignored; `.env.example` is explicitly exempted from the ignore rule.

## Why the release is not marked fully verified

1. The current Production deployment is from `main`, not the Task 12 head. Task PRs are still open/unmerged; nothing in this task silently merges them or moves the Production alias.
2. On Task 12 head `7fab3eec93c546cbfb2b682a07dbe05613ec7656`, the Vercel project checks report `build-rate-limit` for the connected projects. A successful GitHub Actions run is not a Vercel deployment.
3. Preview has no dedicated `DATABASE_URL`. Auth/session/project tests must not run against ephemeral PGLite or the Production database from a Preview deployment.
4. No owner-authorized live E2E test account/credentials were supplied. The Production smoke deliberately creates no user and performs no signed-in data mutations; CI's disposable test account is not a Production account.

## Required owner/release actions

- [ ] In Vercel Project → Settings → Environment Variables, confirm that the existing sensitive Production `DATABASE_URL` points to the intended persistent PostgreSQL database and the role can access the auth, OAuth, API-key, execution-job, and project schema. The secret has **not** been decrypted by this workflow.
- [ ] Provision an isolated Preview PostgreSQL database (for example, a separate provider-created database/branch), then add its real provider-issued URL as a sensitive Preview `DATABASE_URL`. Optionally set a Preview-only `DATABASE_URL_MIGRATIONS` for a direct/unpooled migration endpoint. Do **not** copy the Production database URL into Preview.
- [ ] Resolve the Vercel `build-rate-limit` block by waiting for quota reset or having the project owner decide whether to change the plan. No upgrade or paid action was taken here.
- [ ] Review and merge the feature stack in dependency order only after approval: PR #34 (consolidated Tasks 4–7, based on `main`) → PR #36 (Task 8) → PR #37 (Task 9) → PR #38 (Task 10) → PR #40 (Task 11) → PR #41 (Task 12). Recheck each dependent PR's base after the preceding merge. PRs #31–#33 are earlier Task 4–6 PRs referenced as open in PR #34; reconcile them with PR #34 before closing anything.
- [ ] After the intended commits are merged, confirm a new Production deployment is `READY` and its source SHA contains the reviewed changes. Check migration output and server readiness without printing connection strings or secrets.
- [ ] Run an owner-approved live E2E using an authorized account and appropriate mailbox: signup → sign-in → separate `get-session` request/refresh → private project read/write ownership → sign-out → stale-cookie replay denied → persistence across later requests and redeployment. Do not create a fake/demo Production account or log credentials.
- [ ] Verify the intended Preview branch separately using its isolated database before treating Preview as a safe release candidate.

## Related code and evidence

- Environment matrix and migration policy: [deployment-environment-variables.md](./deployment-environment-variables.md)
- Task 10 origin/domain policy: [PR #38](https://github.com/MvMSOLO/MvM3DForge/pull/38)
- Task 11 PostgreSQL/auth regression: [PR #40](https://github.com/MvMSOLO/MvM3DForge/pull/40)
- Task 12 Studio/MCP scope and ownership regression: [PR #41](https://github.com/MvMSOLO/MvM3DForge/pull/41)
- Task 12 complete CI run: [40206792891](https://github.com/MvMSOLO/MvM3DForge/actions/runs/40206792891)

**Release decision:** Not yet safe to claim the production signup/session persistence flow is fully verified. The remaining proof requires the owner-controlled Preview database, a deployable approved commit, and an authorized live E2E test.
