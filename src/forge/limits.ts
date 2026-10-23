/** Real budgets. Docs and the runtime both import this object — do not duplicate. */
export const LIMITS = {
  maxObjects: 400,
  maxTrianglesWarning: 250_000,
  maxTrianglesHard: 1_500_000,
  maxVerticesPerMesh: 100_000,
  maxDimension: 10_000,
  minDimension: 1e-5,
  maxSegments: 128,
  maxTubularSegments: 256,
  codeTimeoutMs: 2_500,
  maxCodeChars: 200_000,
  maxLogs: 200,
  maxLogChars: 4_000,
  maxTextureSize: 2048,
  maxTextures: 32,
  maxKeyframesPerTrack: 500,
  maxTracksPerClip: 64,
  maxClips: 32,
  maxUndo: 60,
  maxProjectBytesWarn: 40 * 1024 * 1024,
  maxNameLength: 120,
  shadowLights: 1,
} as const;

/**
 * Hard safety ceilings. Scripts may raise session budgets via mvm.runtime.budget()
 * up to these values — never above. AI-optional, code-first.
 */
export const BUDGET_CEILINGS = {
  maxObjects: 2_000,
  maxTextures: 64,
  maxTrianglesHard: 3_000_000,
  maxCodeChars: 400_000,
} as const;

export type BudgetProfileId = "default" | "studio" | "pro";

/** Named profiles for docs / UI. Defaults match LIMITS. */
export const BUDGET_PROFILES: Record<
  BudgetProfileId,
  { maxObjects: number; maxTextures: number; label: string }
> = {
  default: { maxObjects: 400, maxTextures: 32, label: "Default (safe)" },
  studio: { maxObjects: 800, maxTextures: 48, label: "Studio" },
  pro: { maxObjects: 1_500, maxTextures: 64, label: "Pro" },
};

export type SessionBudget = {
  maxObjects: number;
  maxTextures: number;
  maxTrianglesHard: number;
};

export function createSessionBudget(
  overrides?: Partial<SessionBudget>,
  profile: BudgetProfileId = "default",
): SessionBudget {
  const base = BUDGET_PROFILES[profile] ?? BUDGET_PROFILES.default;
  const maxObjects = Math.min(
    BUDGET_CEILINGS.maxObjects,
    Math.max(1, overrides?.maxObjects ?? base.maxObjects),
  );
  const maxTextures = Math.min(
    BUDGET_CEILINGS.maxTextures,
    Math.max(1, overrides?.maxTextures ?? base.maxTextures),
  );
  const maxTrianglesHard = Math.min(
    BUDGET_CEILINGS.maxTrianglesHard,
    Math.max(LIMITS.maxTrianglesWarning, overrides?.maxTrianglesHard ?? LIMITS.maxTrianglesHard),
  );
  return { maxObjects, maxTextures, maxTrianglesHard };
}
