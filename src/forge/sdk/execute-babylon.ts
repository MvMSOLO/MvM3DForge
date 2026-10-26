import * as BabylonCore from "@babylonjs/core";
import * as BabylonGUI from "@babylonjs/gui";
import { registerBuiltInLoaders } from "@babylonjs/loaders/dynamic";
import { SceneSerializer } from "@babylonjs/core/Misc/sceneSerializer";
import { ForgeError, errorToIssue, issue } from "../errors.ts";
import { defaultMaterial } from "../materials.ts";
import { makeNode } from "../nodes.ts";
import { BUDGET_CEILINGS, LIMITS } from "../limits.ts";
import type { GeometrySpec, LogEntry, MaterialSpec, Project, RunResult, SceneNode } from "../types.ts";

const MAX_NATIVE_PAYLOAD_CHARS = 2_000_000;
const MAX_NATIVE_OBJECTS = Math.min(BUDGET_CEILINGS.maxObjects, 400);
const MAX_NATIVE_VERTICES = 140_000;

const BABYLON = Object.assign({}, BabylonCore, { GUI: BabylonGUI });
let loadersPromise: Promise<void> | undefined;

function ensureLoaders(): Promise<void> {
  loadersPromise ??= registerBuiltInLoaders();
  return loadersPromise;
}

function pushLog(logs: LogEntry[], level: LogEntry["level"], values: unknown[]): void {
  if (logs.length >= LIMITS.maxLogs) return;
  const message = values.map((value) => {
    if (typeof value === "string") return value;
    if (value == null || typeof value === "number" || typeof value === "boolean") return String(value);
    try {
      return JSON.stringify(value);
    } catch {
      return Object.prototype.toString.call(value);
    }
  }).join(" ").slice(0, LIMITS.maxLogChars);
  logs.push({ id: crypto.randomUUID(), level, message, timestamp: Date.now() });
}

function colorHex(color: unknown, fallback: string): string {
  if (!color || typeof color !== "object") return fallback;
  const candidate = color as { toHexString?: (returnAsColor3?: boolean) => string; r?: number; g?: number; b?: number };
  if (typeof candidate.toHexString === "function") {
    try { return candidate.toHexString(true).toLowerCase(); } catch { /* use component conversion */ }
  }
  if ([candidate.r, candidate.g, candidate.b].every((component) => typeof component === "number" && Number.isFinite(component))) {
    const byte = (value: number) => Math.max(0, Math.min(255, Math.round(value * 255))).toString(16).padStart(2, "0");
    return `#${byte(candidate.r!)}${byte(candidate.g!)}${byte(candidate.b!)}`;
  }
  return fallback;
}

function clamp01(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : fallback;
}

function materialSummary(material: unknown): MaterialSpec {
  const raw = material && typeof material === "object" ? material as Record<string, any> : {};
  const pbr = raw;
  const clearcoat = pbr.clearCoat;
  const subsurface = pbr.subSurface;
  const sheen = pbr.sheen;
  const alpha = clamp01(pbr.alpha, 1);
  return defaultMaterial({
    name: typeof pbr.name === "string" && pbr.name.trim() ? pbr.name.slice(0, 120) : undefined,
    color: colorHex(pbr.albedoColor ?? pbr.diffuseColor, "#c5d0db"),
    roughness: clamp01(pbr.roughness ?? pbr.microSurface, 0.55),
    metalness: clamp01(pbr.metallic ?? pbr.specularPower, 0.08),
    opacity: alpha,
    emissive: colorHex(pbr.emissiveColor, "#000000"),
    emissiveIntensity: typeof pbr.emissiveIntensity === "number" ? Math.max(0, Math.min(8, pbr.emissiveIntensity)) : 1,
    clearcoat: clamp01(clearcoat?.intensity, 0),
    clearcoatRoughness: clamp01(clearcoat?.roughness, 0),
    transmission: clamp01(subsurface?.refractionIntensity, 0),
    ior: typeof subsurface?.indexOfRefraction === "number" ? subsurface.indexOfRefraction : 1.5,
    thickness: typeof subsurface?.maximumThickness === "number" ? Math.max(0, subsurface.maximumThickness) : 0,
    sheen: clamp01(sheen?.intensity, 0),
    sheenRoughness: clamp01(sheen?.roughness, 0.5),
    sheenColor: colorHex(sheen?.color, "#ffffff"),
    alphaMode: alpha < 0.999 ? "BLEND" : "OPAQUE",
    side: pbr.backFaceCulling === false ? "double" : "front",
  });
}

function nodeRotation(mesh: BabylonCore.AbstractMesh): [number, number, number] {
  const rotation = mesh.rotationQuaternion ? mesh.rotationQuaternion.toEulerAngles() : mesh.rotation;
  const degree = 180 / Math.PI;
  return [rotation.x * degree, rotation.y * degree, rotation.z * degree];
}

function sceneNodes(scene: BabylonCore.Scene): SceneNode[] {
  const meshes = scene.meshes.filter((item) =>
    item instanceof BabylonCore.Mesh && !item.doNotSerialize && item.geometry && item.getVerticesData(BabylonCore.VertexBuffer.PositionKind),
  );
  if (meshes.length > MAX_NATIVE_OBJECTS) {
    throw new ForgeError("MVM_E_OBJECT_LIMIT", `Native Babylon scene has ${meshes.length} mesh objects; the current hard limit is ${MAX_NATIVE_OBJECTS}.`, {
      recoveryHint: "Split the model into smaller projects or instance repeated meshes.",
    });
  }

  const idByMesh = new Map<BabylonCore.AbstractMesh, string>();
  for (const mesh of meshes) {
    idByMesh.set(mesh, typeof (mesh.metadata as { mvmId?: unknown } | null)?.mvmId === "string"
      ? String((mesh.metadata as { mvmId: string }).mvmId)
      : crypto.randomUUID());
  }

  let vertexCount = 0;
  let triangleCount = 0;
  const result: SceneNode[] = [];
  for (const abstractMesh of meshes) {
    const mesh = abstractMesh as BabylonCore.Mesh;
    const positionsRaw = mesh.getVerticesData(BabylonCore.VertexBuffer.PositionKind);
    if (!positionsRaw || positionsRaw.length < 9 || positionsRaw.length % 3 !== 0) continue;
    const count = positionsRaw.length / 3;
    vertexCount += count;
    if (vertexCount > MAX_NATIVE_VERTICES) {
      throw new ForgeError("MVM_E_GEOMETRY_CUSTOM_INVALID", `Native Babylon scene exceeds the ${MAX_NATIVE_VERTICES}-vertex summary limit.`, {
        recoveryHint: "Reduce mesh density or split high-resolution assets before using the Forge inspector/bridge.",
      });
    }
    const indicesRaw = mesh.getIndices();
    const triangleCountForMesh = indicesRaw ? Math.floor(indicesRaw.length / 3) : Math.floor(count / 3);
    triangleCount += triangleCountForMesh;
    if (triangleCount > BUDGET_CEILINGS.maxTrianglesHard) {
      throw new ForgeError("MVM_E_TRIANGLE_LIMIT", `Native Babylon scene exceeds the ${BUDGET_CEILINGS.maxTrianglesHard}-triangle hard limit.`, {
        recoveryHint: "Reduce triangle density or split the scene into smaller parts.",
      });
    }

    const normalsRaw = mesh.getVerticesData(BabylonCore.VertexBuffer.NormalKind);
    const uvsRaw = mesh.getVerticesData(BabylonCore.VertexBuffer.UVKind);
    const geometry: GeometrySpec = {
      kind: "custom",
      positions: Array.from(positionsRaw),
      ...(indicesRaw?.length ? { indices: Array.from(indicesRaw) } : {}),
      ...(normalsRaw && normalsRaw.length === positionsRaw.length ? { normals: Array.from(normalsRaw) } : {}),
      ...(uvsRaw && uvsRaw.length === count * 2 ? { uvs: Array.from(uvsRaw) } : {}),
    };
    const parent = mesh.parent && mesh.parent instanceof BabylonCore.AbstractMesh
      ? idByMesh.get(mesh.parent) ?? null
      : null;
    result.push(makeNode({
      id: idByMesh.get(mesh)!,
      name: mesh.name || mesh.id || mesh.getClassName() || "Babylon Mesh",
      type: "mesh",
      source: "script",
      parentId: parent,
      visible: mesh.isVisible && mesh.isEnabled(),
      locked: false,
      position: [mesh.position.x, mesh.position.y, mesh.position.z],
      rotation: nodeRotation(mesh),
      scale: [mesh.scaling.x, mesh.scaling.y, mesh.scaling.z],
      geometry,
      material: materialSummary(mesh.material),
    }));
  }
  if (result.length === 0) {
    throw new ForgeError("MVM_E_EXPORT_EMPTY", "The Babylon script created no exportable mesh geometry.", {
      recoveryHint: "Create at least one MeshBuilder mesh or import a model into the provided scene.",
    });
  }
  return result;
}

/**
 * Executes actual Babylon.js code against a real Babylon Scene/Engine supplied by the viewport.
 * On success the serialized native scene becomes the source of truth; the Forge object list is
 * only a bounded inspector/validation projection and is never used for native GLB export.
 */
export async function executeBabylonCodeInScene(
  code: string,
  scene: BabylonCore.Scene,
  engine: BabylonCore.AbstractEngine,
  canvas: HTMLCanvasElement | null,
): Promise<RunResult> {
  const logs: LogEntry[] = [];
  if (typeof code !== "string") {
    const error = issue("MVM_E_ARGUMENT_TYPE", "Babylon code must be a string.");
    return { ok: false, error, logs, issues: [error] };
  }
  if (code.length > LIMITS.maxCodeChars) {
    const error = issue("MVM_E_CODE_LIMIT", `Code is ${code.length} characters. Limit is ${LIMITS.maxCodeChars}.`, {
      recoveryHint: "Split the script or remove unused data.",
    });
    return { ok: false, error, logs, issues: [error] };
  }

  try {
    await ensureLoaders();
    const scriptConsole = {
      log: (...args: unknown[]) => pushLog(logs, "log", args),
      info: (...args: unknown[]) => pushLog(logs, "info", args),
      debug: (...args: unknown[]) => pushLog(logs, "log", args),
      warn: (...args: unknown[]) => pushLog(logs, "warn", args),
      error: (...args: unknown[]) => pushLog(logs, "error", args),
    };
    const fn = new Function("BABYLON", "engine", "scene", "canvas", "console", `"use strict";\n${code}`) as (
      babylon: typeof BABYLON,
      activeEngine: BabylonCore.AbstractEngine,
      activeScene: BabylonCore.Scene,
      activeCanvas: HTMLCanvasElement | null,
      scriptConsole: typeof scriptConsole,
    ) => unknown;
    const returned = fn(BABYLON, engine, scene, canvas, scriptConsole);
    if (returned && typeof (returned as Promise<unknown>).then === "function") await returned;

    if (scene.cameras.length === 0) {
      const camera = new BabylonCore.ArcRotateCamera(
        "MVM BABYLON Camera",
        -Math.PI / 2,
        Math.PI / 3,
        8,
        BabylonCore.Vector3.Zero(),
        scene,
      );
      camera.minZ = 0.01;
      camera.wheelDeltaPercentage = 0.01;
      scene.activeCamera = camera;
    } else if (!scene.activeCamera) {
      scene.activeCamera = scene.cameras[0]!;
    }

    if (scene.lights.length === 0) {
      const fill = new BabylonCore.HemisphericLight("MVM BABYLON Fill", new BabylonCore.Vector3(0, 1, 0), scene);
      fill.intensity = 0.7;
      const key = new BabylonCore.DirectionalLight("MVM BABYLON Key", new BabylonCore.Vector3(-0.6, -1, 0.45), scene);
      key.intensity = 1.6;
    }

    const objects = sceneNodes(scene);
    const nativeBabylonScene = await SceneSerializer.SerializeAsync(scene) as Record<string, unknown>;
    const serialized = JSON.stringify(nativeBabylonScene);
    const summarySize = JSON.stringify(objects).length;
    if (serialized.length + summarySize > MAX_NATIVE_PAYLOAD_CHARS) {
      throw new ForgeError("MVM_E_NATIVE_SCENE_LIMIT", `Native scene payload is ${serialized.length + summarySize} characters; the transfer limit is ${MAX_NATIVE_PAYLOAD_CHARS}.`, {
        recoveryHint: "Use external texture/model URLs instead of embedded high-resolution assets, or split the scene.",
      });
    }
    if (!scene.activeCamera) {
      throw new ForgeError("MVM_E_CAMERA_REQUIRED", "Babylon scene has no active camera after initialization.");
    }

    return {
      ok: true,
      logs,
      patch: {
        engine: "babylon",
        nativeBabylonScene,
        sceneMutation: "replace",
        objects,
        textures: [],
        clips: [],
        background: "#10161e",
        issues: [],
      },
    };
  } catch (error) {
    const parsed = errorToIssue(error);
    if (!parsed.code || parsed.code === "MVM_E_UNKNOWN") {
      const message = error instanceof Error ? error.message : "Babylon execution failed.";
      const fallback = issue("MVM_E_BABYLON_RUNTIME", message, { recoveryHint: "Check the Babylon API names and scene code." });
      return { ok: false, error: fallback, logs, issues: [fallback] };
    }
    return { ok: false, error: parsed, logs, issues: [parsed] };
  }
}

/** Headless runner for Node tests and server-side tooling. It uses Babylon's real NullEngine. */
export async function executeBabylonUserCode(code: string): Promise<RunResult> {
  const engine = new BabylonCore.NullEngine({
    renderWidth: 1280,
    renderHeight: 720,
    textureSize: 1024,
    deterministicLockstep: false,
  });
  const scene = new BabylonCore.Scene(engine);
  scene.clearColor = new BabylonCore.Color4(0.035, 0.05, 0.07, 1);
  try {
    return await executeBabylonCodeInScene(code, scene, engine, null);
  } finally {
    scene.dispose();
    engine.dispose();
  }
}
