# CRITICAL: Restore `src/forge/sdk/execute.ts`

A push accidentally replaced this file. Restore from the last good commit, then apply the physical-PBR patch.

```bash
git checkout 9d37dbc4c94b902c41b8520141fcdb41e56f5cee -- src/forge/sdk/execute.ts
patch -p1 < docs/patches/execute_physical.patch
git add src/forge/sdk/execute.ts
git commit -m "fix(sdk): restore execute.ts + physical PBR normalizeMaterial"
```

Or one-liner from GitHub web: open commit `9d37dbc`, restore `src/forge/sdk/execute.ts`, then apply the patch lines in `docs/patches/execute_physical.patch`.
