import type { ForgeIssue, IssueSeverity } from "./types.ts";

export class ForgeError extends Error {
  code: string;
  severity: IssueSeverity;
  recoveryHint?: string;
  context?: Record<string, string | number | boolean | null>;
  line?: number;
  column?: number;

  constructor(
    code: string,
    message: string,
    extra?: {
      severity?: IssueSeverity;
      recoveryHint?: string;
      context?: Record<string, string | number | boolean | null>;
      line?: number;
      column?: number;
    },
  ) {
    super(message);
    this.name = "ForgeError";
    this.code = code;
    this.severity = extra?.severity ?? "error";
    this.recoveryHint = extra?.recoveryHint;
    this.context = extra?.context;
    this.line = extra?.line;
    this.column = extra?.column;
  }
}

export function issue(
  code: string,
  message: string,
  extra?: {
    severity?: IssueSeverity;
    recoveryHint?: string;
    context?: Record<string, string | number | boolean | null>;
    line?: number;
    column?: number;
  },
): ForgeIssue {
  return {
    code,
    message,
    severity: extra?.severity ?? "error",
    recoveryHint: extra?.recoveryHint,
    context: extra?.context,
    line: extra?.line,
    column: extra?.column,
    timestamp: Date.now(),
  };
}

export function errorToIssue(error: unknown, fallbackCode = "MVM_E_RUN_FAILED"): ForgeIssue {
  if (error instanceof ForgeError) {
    return issue(error.code, error.message, {
      severity: error.severity,
      recoveryHint: error.recoveryHint,
      context: error.context,
      line: error.line,
      column: error.column,
    });
  }
  if (error instanceof Error) {
    const loc = parseAnonymousLocation(error.stack || error.message);
    const syntax = error instanceof SyntaxError;
    return issue(syntax ? "MVM_E_SYNTAX" : fallbackCode, error.message, {
      line: loc?.line,
      column: loc?.column,
      recoveryHint: syntax
        ? "Fix the syntax error at the reported line. The runtime executes JavaScript, not TypeScript."
        : "Read the message and the console stack. Previous scene is unchanged if this run failed.",
    });
  }
  return issue(fallbackCode, String(error));
}

/** Lines V8 inserts before user code: wrapper plus the sandbox prelude. */
export const PRELUDE_LINES = 8;

export function parseAnonymousLocation(text: string): { line: number; column: number } | null {
  const match = /<anonymous>:(\d+):(\d+)/.exec(text);
  if (!match) return null;
  const rawLine = Number(match[1]);
  const column = Number(match[2]);
  const line = Math.max(1, rawLine - PRELUDE_LINES);
  return { line, column };
}

export const ERROR_CATALOG: { code: string; summary: string; recovery: string }[] = [
  {
    code: "MVM_E_GEOMETRY_DIMENSION_INVALID",
    summary: "A geometry dimension was missing, negative, zero, or not finite.",
    recovery: "Pass a positive finite number. Example: mvm.geometry.box({ width: 1, height: 1, depth: 1 }).",
  },
  {
    code: "MVM_E_GEOMETRY_SEGMENTS_INVALID",
    summary: "A segment count was out of range.",
    recovery: "Use an integer inside the documented min/max for that parameter.",
  },
  {
    code: "MVM_E_GEOMETRY_CUSTOM_INVALID",
    summary: "Custom mesh positions, indices, normals, or UVs failed validation.",
    recovery: "positions length must be a multiple of 3. Indices must reference existing vertices.",
  },
  {
    code: "MVM_E_TRANSFORM_NON_FINITE",
    summary: "A position, rotation, or scale component was NaN or Infinity.",
    recovery: "Assign finite numbers. Rotation is Euler XYZ in degrees.",
  },
  {
    code: "MVM_E_MATERIAL_COLOR_INVALID",
    summary: "A color was not a #RGB or #RRGGBB hex string.",
    recovery: "Use hex colors such as #43C8F5. CSS names are not accepted.",
  },
  {
    code: "MVM_E_MATERIAL_RANGE",
    summary: "A material scalar was outside the accepted range.",
    recovery: "roughness, metalness, and opacity are 0–1. emissiveIntensity is 0–50.",
  },
  {
    code: "MVM_E_UV_MISSING",
    summary: "A texture is bound but the mesh has no UVs.",
    recovery: "Use a primitive (UVs are built in) or supply a uvs array on custom meshes.",
  },
  {
    code: "MVM_E_OBJECT_LIMIT",
    summary: "The scene exceeded the object budget.",
    recovery: "Remove objects or split the build. See LIMITS.maxObjects.",
  },
  {
    code: "MVM_E_TRIANGLE_LIMIT",
    summary: "The scene exceeded the hard triangle budget.",
    recovery: "Lower segment counts. A warning is issued earlier, before the hard stop.",
  },
  {
    code: "MVM_E_TEXTURE_LIMIT",
    summary: "Too many textures, or a texture exceeds the maximum resolution.",
    recovery: "Stay within LIMITS.maxTextures and LIMITS.maxTextureSize.",
  },
  {
    code: "MVM_E_RUN_TIMEOUT",
    summary: "User code exceeded the time budget and the sandbox was terminated.",
    recovery: "Remove infinite loops. The previous committed scene is kept.",
  },
  {
    code: "MVM_E_SYNTAX",
    summary: "JavaScript syntax error before execution.",
    recovery: "The editor language is JavaScript. Type annotations are not executed.",
  },
  {
    code: "MVM_E_EXPORT_FAILED",
    summary: "GLB exporter threw or the binary failed the structural check.",
    recovery: "Read the message. Do not treat the download as successful.",
  },
  {
    code: "MVM_E_EXPORT_EMPTY",
    summary: "There is no visible mesh to export.",
    recovery: "Add geometry or disable Visible only.",
  },
  {
    code: "MVM_E_STORAGE_QUOTA",
    summary: "IndexedDB refused the save, usually because the origin is over quota.",
    recovery: "Download a project JSON backup, then delete old projects.",
  },
  {
    code: "MVM_E_PROJECT_SCHEMA",
    summary: "Project schemaVersion is missing or newer than this build.",
    recovery: "Open the file in a build that supports that schema. This build migrates only version 1.",
  },
  {
    code: "MVM_E_IMPORT_FAILED",
    summary: "GLB, glTF, OBJ, STL, or project JSON could not be read.",
    recovery: "Confirm the file is not an external-buffer glTF with missing companions.",
  },
  {
    code: "MVM_E_ANIMATION_INVALID",
    summary: "A clip or track argument was invalid.",
    recovery: "Keys need time >= 0 and a value array of length 3 (or 4 for quaternion).",
  },
  {
    code: "MVM_E_PARENT_CYCLE",
    summary: "Parenting this object would create a cycle.",
    recovery: "Parent to an ancestor-free group, or set parent to null.",
  },
  {
    code: "MVM_E_TEXTURE_UNSUPPORTED",
    summary: "Canvas texture painting needs OffscreenCanvas in the sandbox.",
    recovery: "Use mvm.texture.checker / stripes / dots / gradient / noise / solid instead.",
  },
];
