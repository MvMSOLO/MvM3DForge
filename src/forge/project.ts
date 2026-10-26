import { API_VERSION, SCHEMA_VERSION, brand } from "./brand.ts";
import { ForgeError } from "./errors.ts";
import { blankCode, defaultSceneSettings, editorRig, projectShell } from "./nodes.ts";
import type { Project, ScriptPatch } from "./types.ts";
import { starterById, type StarterId } from "./examples.ts";
import { coerceMaterial } from "./materials.ts";
import { executeUserCode } from "./sdk/execute.ts";

export function applyScriptPatch(project: Project, patch: ScriptPatch): Project {
  // A script that only declares materials/settings must not erase a previously built scene.
  // Scene replacement is explicit when objects are added; an intentional empty scene uses clear().
  const mutation = patch.sceneMutation ?? (patch.objects.length > 0 ? "replace" : "none");
  const preserveScriptState = mutation === "none";
  const nativeBabylon = patch.engine === "babylon";
  const objects = nativeBabylon
    ? patch.objects
    : preserveScriptState
      ? project.objects
      : [...project.objects.filter((node) => node.source !== "script"), ...patch.objects];
  const textures = nativeBabylon
    ? patch.textures
    : preserveScriptState && patch.textures.length === 0
      ? project.textures
      : [...project.textures.filter((tex) => tex.source !== "script"), ...patch.textures];
  const clips = nativeBabylon
    ? patch.clips
    : preserveScriptState && patch.clips.length === 0
      ? project.clips
      : [...project.clips.filter((clip) => clip.source !== "script"), ...patch.clips];

  return {
    ...project,
    ...(patch.engine ? { engine: patch.engine } : {}),
    ...(patch.nativeBabylonScene !== undefined ? { nativeBabylonScene: patch.nativeBabylonScene } : {}),
    name: patch.projectName ?? project.name,
    objects,
    textures,
    clips,
    autoplayClipId: preserveScriptState ? project.autoplayClipId : patch.autoplayClipId ?? null,
    scene: {
      ...project.scene,
      background: patch.background ?? project.scene.background,
      environment: patch.environment ?? project.scene.environment,
      environmentUrl: patch.environmentUrl !== undefined ? patch.environmentUrl : project.scene.environmentUrl,
      exposure: patch.exposure ?? project.scene.exposure,
      camera: patch.camera ? { ...project.scene.camera, ...patch.camera } : project.scene.camera,
    },
    updatedAt: Date.now(),
  };
}

export async function createStarterProject(id: StarterId): Promise<{ project: Project; issues: ScriptPatch["issues"]; logs: { message: string; level: string }[] }> {
  const starter = starterById(id);
  const code = starter.code.trim() ? starter.code : blankCode;
  let project: Project = projectShell(starter.id === "blank" ? "Untitled" : starter.title, code);
  project = { ...project, description: `${starter.summary} ${starter.limitation}` };
  if (!starter.code.trim()) return { project, issues: [], logs: [] };
  const result = await executeUserCode(starter.code);
  if (!result.ok) {
    return { project, issues: [result.error, ...result.issues], logs: result.logs };
  }
  project = applyScriptPatch(project, result.patch);
  return { project, issues: result.patch.issues, logs: result.logs };
}

export function migrateProject(raw: unknown): Project {
  if (!raw || typeof raw !== "object") {
    throw new ForgeError("MVM_E_PROJECT_SCHEMA", "This file is not an MVM project.", {
      recoveryHint: "Choose a project JSON exported from MVM 3D Forge, or a GLB for mesh import.",
    });
  }
  const record = raw as Record<string, unknown>;
  const body = record.format === "mvm-project" ? record.project : record;
  if (!body || typeof body !== "object") {
    throw new ForgeError("MVM_E_PROJECT_SCHEMA", "Project payload is missing.");
  }
  const data = body as Partial<Project>;
  if (data.schemaVersion == null) {
    throw new ForgeError("MVM_E_PROJECT_SCHEMA", "schemaVersion is missing.", {
      recoveryHint: "Re-export the project from this build.",
    });
  }
  if (data.schemaVersion !== SCHEMA_VERSION) {
    throw new ForgeError(
      "MVM_E_PROJECT_SCHEMA",
      `schemaVersion ${String(data.schemaVersion)} is not supported. This build reads version ${SCHEMA_VERSION}.`,
      { recoveryHint: "Open it in a newer build, or keep a copy before migrating." },
    );
  }
  const scene = { ...defaultSceneSettings(), ...(data.scene ?? {}) };
  scene.camera = { ...defaultSceneSettings().camera, ...(data.scene?.camera ?? {}) };
  return {
    engine: data.engine === "babylon" || data.engine === "three" ? data.engine : undefined,
    nativeBabylonScene: data.nativeBabylonScene && typeof data.nativeBabylonScene === "object" && !Array.isArray(data.nativeBabylonScene)
      ? data.nativeBabylonScene as Record<string, unknown>
      : null,
    id: typeof data.id === "string" ? data.id : crypto.randomUUID(),
    name: typeof data.name === "string" && data.name.trim() ? data.name : "Imported",
    schemaVersion: SCHEMA_VERSION,
    apiVersion: typeof data.apiVersion === "string" ? data.apiVersion : API_VERSION,
    appVersion: typeof data.appVersion === "string" ? data.appVersion : brand.version,
    createdAt: typeof data.createdAt === "number" ? data.createdAt : Date.now(),
    updatedAt: Date.now(),
    code: typeof data.code === "string" ? data.code : blankCode,
    codeLanguage: "javascript",
    author: typeof data.author === "string" ? data.author : "",
    objects: Array.isArray(data.objects) && data.objects.length
      ? data.objects.map((node) =>
          node && typeof node === "object" && "material" in node && node.material
            ? { ...node, material: coerceMaterial(node.material as Partial<import("./types.ts").MaterialSpec>) }
            : node,
        )
      : editorRig(),
    textures: Array.isArray(data.textures) ? data.textures : [],
    clips: Array.isArray(data.clips) ? data.clips : [],
    autoplayClipId: typeof data.autoplayClipId === "string" ? data.autoplayClipId : null,
    scene,
    description: typeof data.description === "string" ? data.description : "",
  };
}

export function packageProject(project: Project): string {
  return JSON.stringify(
    {
      format: "mvm-project",
      schemaVersion: SCHEMA_VERSION,
      apiVersion: API_VERSION,
      exportedAt: new Date().toISOString(),
      project,
    },
    null,
    2,
  );
}
