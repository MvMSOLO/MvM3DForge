import { API_VERSION, SCHEMA_VERSION } from "../brand.ts";
import { ForgeError, PRELUDE_LINES, errorToIssue, issue } from "../errors.ts";
import { computeMeshStats } from "../geometry-build.ts";
import { HUMANOID_DEFAULTS, buildHumanoidNodes, type HumanoidParams } from "../humanoid.ts";
import { LIMITS } from "../limits.ts";
import { defaultMaterial } from "../materials.ts";
import { makeNode } from "../nodes.ts";
import type {
  AnimClip,
  AnimProperty,
  AnimTrack,
  EnvironmentPreset,
  ExportRequest,
  GeometrySpec,
  LightSpec,
  LogEntry,
  MaterialSpec,
  RunResult,
  SceneNode,
  ScriptPatch,
  TextureAsset,
  TextureColorSpace,
  TextureGenerator,
  Vec3,
} from "../types.ts";
import { validateScene } from "../validate.ts";
import * as THREE from "three";

const PRELUDE = `"use strict";
const fetch = undefined;
const XMLHttpRequest = undefined;
const WebSocket = undefined;
const importScripts = undefined;
const indexedDB = undefined;
`;

type Internal = {
  node: SceneNode;
  position: Vec;
  rotation: Vec;
  scale: Vec;
  inScene: boolean;
};

type TexHandle = {
  id: string;
  name: string;
  kind: "texture";
  toJSON: () => { id: string; name: string; kind: "texture" };
};

type PendingThreeTrack = {
  clipId: string;
  object: THREE.Object3D;
  property: AnimProperty;
  interpolation: "linear" | "smooth";
  keyframes: AnimTrack["keyframes"];
};

class Vec {
  x: number;
  y: number;
  z: number;
  constructor(x = 0, y = 0, z = 0) {
    this.x = x;
    this.y = y;
    this.z = z;
  }
  set(x: number, y: number, z: number) {
    assertVec("Vec3.set", x, y, z);
    this.x = x;
    this.y = y;
    this.z = z;
    return this;
  }
  toArray(): Vec3 {
    return [this.x, this.y, this.z];
  }
}

function assertVec(api: string, x: number, y: number, z: number) {
  if (![x, y, z].every((n) => typeof n === "number" && Number.isFinite(n))) {
    throw new ForgeError(
      "MVM_E_TRANSFORM_NON_FINITE",
      `${api} expected three finite numbers. Received ${[x, y, z].map(String).join(", ")}.`,
      { recoveryHint: "Pass finite numbers. Object rotation is Euler XYZ in degrees.", context: { api } },
    );
  }
}

function asVec3(value: unknown, api: string): Vec3 {
  if (value instanceof Vec) return value.toArray();
  if (Array.isArray(value) && value.length >= 3) {
    assertVec(api, Number(value[0]), Number(value[1]), Number(value[2]));
    return [Number(value[0]), Number(value[1]), Number(value[2])];
  }
  if (value && typeof value === "object" && "x" in value && "y" in value && "z" in value) {
    const v = value as { x: number; y: number; z: number };
    assertVec(api, Number(v.x), Number(v.y), Number(v.z));
    return [Number(v.x), Number(v.y), Number(v.z)];
  }
  throw new ForgeError("MVM_E_TRANSFORM_NON_FINITE", `${api} expected [x,y,z] or {x,y,z}.`, { context: { api } });
}

function num(
  api: string,
  name: string,
  value: unknown,
  def: number,
  min: number,
  max: number,
  opts?: { minExclusive?: boolean },
) {
  if (value === undefined) return def;
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new ForgeError(
      "MVM_E_GEOMETRY_DIMENSION_INVALID",
      `${api}: "${name}" must be a finite number. Received ${String(value)}.`,
      { recoveryHint: "Pass a finite number.", context: { api, param: name } },
    );
  }
  if (value > max || value < min || (opts?.minExclusive && value <= min)) {
    throw new ForgeError(
      "MVM_E_GEOMETRY_DIMENSION_INVALID",
      `${api}: "${name}" must be ${opts?.minExclusive ? ">" : "≥"} ${min} and ≤ ${max}. Received ${value}.`,
      { recoveryHint: `Use a value between ${min} and ${max}.`, context: { api, param: name, value } },
    );
  }
  return value;
}

function posDim(api: string, name: string, value: unknown, def: number) {
  return num(api, name, value, def, 0, LIMITS.maxDimension, { minExclusive: true });
}

function intDim(api: string, name: string, value: unknown, def: number, min: number, max: number) {
  if (value === undefined) return def;
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new ForgeError("MVM_E_GEOMETRY_SEGMENTS_INVALID", `${api}: "${name}" must be a finite number.`, {
      context: { api, param: name },
      recoveryHint: `Use an integer from ${min} to ${max}.`,
    });
  }
  const rounded = Math.round(value);
  if (rounded < min || rounded > max) {
    throw new ForgeError(
      "MVM_E_GEOMETRY_SEGMENTS_INVALID",
      `${api}: "${name}" must be an integer from ${min} to ${max}. Received ${value}.`,
      { context: { api, param: name, value }, recoveryHint: `Use an integer from ${min} to ${max}.` },
    );
  }
  return rounded;
}

function hexColor(api: string, name: string, value: unknown, def: string): string {
  if (value === undefined) return def;
  if (typeof value !== "string" || !/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(value.trim())) {
    throw new ForgeError(
      "MVM_E_MATERIAL_COLOR_INVALID",
      `${api}: "${name}" must be a #RGB or #RRGGBB hex color. Received ${String(value)}.`,
      { recoveryHint: "Example: #43C8F5. CSS color names are not accepted.", context: { api, param: name } },
    );
  }
  const raw = value.trim().slice(1);
  const full = raw.length === 3 ? raw.split("").map((c) => c + c).join("") : raw;
  return `#${full.toLowerCase()}`;
}

function unit(api: string, name: string, value: unknown, def: number) {
  if (value === undefined) return def;
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1) {
    throw new ForgeError(
      "MVM_E_MATERIAL_RANGE",
      `${api}: "${name}" must be between 0 and 1. Received ${String(value)}.`,
      { recoveryHint: "Use a value from 0 to 1.", context: { api, param: name } },
    );
  }
  return value;
}

function clipName(value: unknown, fallback: string) {
  const text = value === undefined ? fallback : String(value);
  const clean = text.trim().slice(0, LIMITS.maxNameLength);
  if (!clean) {
    throw new ForgeError("MVM_E_NAME_INVALID", "Name must be a non-empty string.", {
      recoveryHint: "Pass a short name.",
    });
  }
  return clean;
}

function record(value: unknown, api: string): Record<string, unknown> {
  if (value === undefined) return {};
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ForgeError("MVM_E_ARGUMENT_TYPE", `${api} expected an object argument.`, {
      recoveryHint: "Pass a single object, for example { width: 1 }.",
      context: { api },
    });
  }
  return value as Record<string, unknown>;
}

export async function executeUserCode(code: string): Promise<RunResult> {
  const logs: LogEntry[] = [];
  if (typeof code !== "string") {
    return {
      ok: false,
      error: issue("MVM_E_ARGUMENT_TYPE", "Code must be a string."),
      logs,
      issues: [],
    };
  }
  if (code.length > LIMITS.maxCodeChars) {
    return {
      ok: false,
      error: issue("MVM_E_CODE_LIMIT", `Code is ${code.length} characters. Limit is ${LIMITS.maxCodeChars}.`, {
        recoveryHint: "Split the script or remove unused data.",
      }),
      logs,
      issues: [],
    };
  }

  const internals = new Map<string, Internal>();
  const publics = new Map<string, PublicObject>();
  const textures: TextureAsset[] = [];
  const texHandles = new Map<string, TexHandle>();
  const clips: AnimClip[] = [];
  const pendingThreeTracks: PendingThreeTrack[] = [];
  const paints: (() => Promise<void>)[] = [];
  let background: string | undefined;
  let environment: EnvironmentPreset | undefined;
  let exposure: number | undefined;
  let camera: ScriptPatch["camera"];
  let projectName: string | undefined;
  let exportRequest: ExportRequest | null = null;
  let autoplayClipId: string | null = null;

  const pushLog = (level: LogEntry["level"], args: unknown[]) => {
    if (logs.length >= LIMITS.maxLogs) return;
    const message = args.map(formatArg).join(" ").slice(0, LIMITS.maxLogChars);
    logs.push({ id: crypto.randomUUID(), level, message, timestamp: Date.now() });
  };

  function formatArg(value: unknown): string {
    if (typeof value === "string") return value;
    if (typeof value === "number" || typeof value === "boolean" || value == null) return String(value);
    try {
      return JSON.stringify(value);
    } catch {
      return Object.prototype.toString.call(value);
    }
  }

  function makeInternal(partial: Parameters<typeof makeNode>[0], source: SceneNode["source"] = "script"): Internal {
    if (internals.size >= LIMITS.maxObjects) {
      throw new ForgeError("MVM_E_OBJECT_LIMIT", `Object budget is ${LIMITS.maxObjects}.`, {
        recoveryHint: "Add fewer objects, or reuse groups.",
      });
    }
    const node = makeNode({ ...partial, source });
    const internal: Internal = {
      node,
      position: new Vec(...node.position),
      rotation: new Vec(...node.rotation),
      scale: new Vec(...(node.scale ?? [1, 1, 1])),
      inScene: false,
    };
    internals.set(node.id, internal);
    return internal;
  }

  function publicOf(internal: Internal): PublicObject {
    const existing = publics.get(internal.node.id);
    if (existing) return existing;
    const pub = new PublicObject(internal);
    publics.set(internal.node.id, pub);
    return pub;
  }

  function requireInternal(value: unknown, apiName: string): Internal {
    if (value instanceof PublicObject) {
      const found = internals.get(value.id);
      if (found) return found;
    }
    if (typeof value === "string") {
      const byId = internals.get(value);
      if (byId) return byId;
      const byName = [...internals.values()].find((item) => item.node.name === value);
      if (byName) return byName;
    }
    throw new ForgeError("MVM_E_OBJECT_NOT_FOUND", `${apiName} expected an object created by mvm.`, {
      recoveryHint: "Pass an object returned by mvm.geometry, mvm.light, or mvm.scene.group.",
      context: { api: apiName },
    });
  }

  function childrenOf(id: string): Internal[] {
    return [...internals.values()].filter((item) => item.node.parentId === id);
  }

  function descendantIds(id: string): string[] {
    const out: string[] = [];
    const walk = (current: string) => {
      for (const child of childrenOf(current)) {
        out.push(child.node.id);
        walk(child.node.id);
      }
    };
    walk(id);
    return out;
  }

  function wouldCycle(childId: string, parentId: string) {
    let cursor: string | null = parentId;
    let guard = 0;
    while (cursor && guard < 64) {
      if (cursor === childId) return true;
      cursor = internals.get(cursor)?.node.parentId ?? null;
      guard += 1;
    }
    return false;
  }

  function setParent(child: Internal, parent: Internal | null) {
    if (parent && wouldCycle(child.node.id, parent.node.id)) {
      throw new ForgeError("MVM_E_PARENT_CYCLE", `Parenting ${child.node.name} to ${parent.node.name} would cycle.`, {
        recoveryHint: "Choose a parent that is not a descendant.",
      });
    }
    child.node.parentId = parent ? parent.node.id : null;
  }

  function triangleLoad(): number {
    let total = 0;
    for (const item of internals.values()) {
      if (item.inScene && item.node.stats) total += item.node.stats.triangles;
    }
    return total;
  }

  function attach(internal: Internal) {
    if (!internal.inScene) {
      const sceneCount = [...internals.values()].filter((item) => item.inScene).length;
      if (sceneCount >= LIMITS.maxObjects) {
        throw new ForgeError("MVM_E_OBJECT_LIMIT", `Cannot add more than ${LIMITS.maxObjects} scene objects.`, {
          recoveryHint: "Remove objects before adding more.",
        });
      }
      internal.inScene = true;
      if (triangleLoad() > LIMITS.maxTrianglesHard) {
        internal.inScene = false;
        throw new ForgeError(
          "MVM_E_TRIANGLE_LIMIT",
          `Adding ${internal.node.name} exceeds the hard triangle limit of ${LIMITS.maxTrianglesHard}.`,
          { recoveryHint: "Lower segment counts.", context: { name: internal.node.name } },
        );
      }
    }
    for (const child of childrenOf(internal.node.id)) attach(child);
  }

  function textureHandle(asset: TextureAsset): TexHandle {
    const handle: TexHandle = {
      id: asset.id,
      name: asset.name,
      kind: "texture",
      toJSON() {
        return { id: asset.id, name: asset.name, kind: "texture" as const };
      },
    };
    texHandles.set(asset.id, handle);
    textures.push(asset);
    return handle;
  }

  function readTexture(value: unknown, apiName: string): string | null {
    if (value == null) return null;
    if (typeof value === "string" && texHandles.has(value)) return value;
    if (typeof value === "object" && value && (value as TexHandle).kind === "texture") {
      const id = (value as TexHandle).id;
      if (texHandles.has(id)) return id;
    }
    throw new ForgeError("MVM_E_TEXTURE_TYPE", `${apiName} expected a texture handle or null.`, {
      recoveryHint: "Create one with mvm.texture.checker, solid, stripes, dots, gradient, noise, or canvas.",
      context: { api: apiName },
    });
  }

  function normalizeMaterial(input: unknown, apiName: string): MaterialSpec {
    const src = record(input, apiName);
    const base = defaultMaterial();
    const mat: MaterialSpec = {
      ...base,
      color: hexColor(apiName, "color", src.color, base.color),
      roughness: unit(apiName, "roughness", src.roughness, base.roughness),
      metalness: unit(apiName, "metalness", src.metalness, base.metalness),
      opacity: unit(apiName, "opacity", src.opacity, base.opacity),
      emissive: hexColor(apiName, "emissive", src.emissive, base.emissive),
      emissiveIntensity: num(apiName, "emissiveIntensity", src.emissiveIntensity, 1, 0, 50),
      alphaMode:
        src.alphaMode === undefined
          ? src.opacity !== undefined && Number(src.opacity) < 1
            ? "BLEND"
            : "OPAQUE"
          : parseAlpha(apiName, src.alphaMode),
      alphaCutoff: unit(apiName, "alphaCutoff", src.alphaCutoff, 0.5),
      side: parseSide(apiName, src.side),
      mapId: readTexture(src.map ?? src.mapId, apiName),
      normalMapId: readTexture(src.normalMap ?? src.normalMapId, apiName),
      aoMapId: readTexture(src.aoMap ?? src.aoMapId, apiName),
      roughnessMapId: readTexture(src.roughnessMap ?? src.roughnessMapId, apiName),
      metalnessMapId: readTexture(src.metalnessMap ?? src.metalnessMapId, apiName),
      repeat: pair(src.repeat, [1, 1], apiName, "repeat"),
      offset: pair(src.offset, [0, 0], apiName, "offset"),
      rotation: num(apiName, "rotation", src.rotation, 0, -3600, 3600),
      wrap: src.wrap === "clamp" ? "clamp" : src.wrap === undefined ? "repeat" : parseWrap(apiName, src.wrap),
    };
    if (mat.alphaMode === "OPAQUE") mat.opacity = mat.opacity === 1 ? 1 : mat.opacity;
    return mat;
  }

  function procedural(
    generator: TextureGenerator,
    apiName: string,
    opts: unknown,
    colorSpace: TextureColorSpace,
  ): TexHandle {
    if (textures.length >= LIMITS.maxTextures) {
      throw new ForgeError("MVM_E_TEXTURE_LIMIT", `Texture budget is ${LIMITS.maxTextures}.`, {
        recoveryHint: "Reuse a texture handle instead of creating another.",
      });
    }
    const src = record(opts, apiName);
    const size = intDim(apiName, "size", src.size, 256, 2, LIMITS.maxTextureSize);
    const params: Record<string, string | number> = {};
    if (generator !== "noise") {
      params.colorA = hexColor(apiName, "colorA", src.colorA ?? src.color, generator === "solid" ? "#43C8F5" : "#0E1620");
      params.colorB = hexColor(apiName, "colorB", src.colorB, "#F0F5F9");
    } else {
      params.colorA = hexColor(apiName, "colorA", src.colorA, "#0E1620");
      params.colorB = hexColor(apiName, "colorB", src.colorB, "#43C8F5");
      params.seed = intDim(apiName, "seed", src.seed, 1, 0, 1_000_000);
    }
    if (generator === "checker" || generator === "stripes" || generator === "dots") {
      params.cells = intDim(apiName, "cells", src.cells ?? src.count, generator === "dots" ? 8 : 8, 1, 64);
    }
    if (generator === "stripes" || generator === "gradient") {
      params.vertical = src.vertical ? 1 : 0;
    }
    const asset: TextureAsset = {
      id: crypto.randomUUID(),
      name: clipName(src.name, generator),
      source: "script",
      colorSpace: src.colorSpace === "linear" || src.colorSpace === "srgb" ? src.colorSpace : colorSpace,
      width: size,
      height: size,
      generator,
      params,
    };
    return textureHandle(asset);
  }

  function syncNode(internal: Internal): SceneNode {
    const position = internal.position.toArray();
    const rotation = internal.rotation.toArray();
    const scale = internal.scale.toArray();
    assertVec(internal.node.name, position[0], position[1], position[2]);
    assertVec(internal.node.name, rotation[0], rotation[1], rotation[2]);
    assertVec(internal.node.name, scale[0], scale[1], scale[2]);
    const node: SceneNode = {
      ...internal.node,
      position,
      rotation,
      scale,
      source: "script",
    };
    if (node.geometry) node.stats = computeMeshStats(node.geometry);
    return node;
  }

  class PublicObject {
    readonly id: string;
    readonly type: SceneNode["type"];
    private internal: Internal;
    constructor(internal: Internal) {
      this.internal = internal;
      this.id = internal.node.id;
      this.type = internal.node.type;
    }
    get name() {
      return this.internal.node.name;
    }
    set name(value: string) {
      this.internal.node.name = clipName(value, this.internal.node.name);
    }
    get position() {
      return this.internal.position;
    }
    set position(value: unknown) {
      const next = asVec3(value, "position");
      this.internal.position.set(next[0], next[1], next[2]);
    }
    get rotation() {
      return this.internal.rotation;
    }
    set rotation(value: unknown) {
      const next = asVec3(value, "rotation");
      this.internal.rotation.set(next[0], next[1], next[2]);
    }
    get scale() {
      return this.internal.scale;
    }
    set scale(value: unknown) {
      const next = asVec3(value, "scale");
      this.internal.scale.set(next[0], next[1], next[2]);
    }
    get visible() {
      return this.internal.node.visible;
    }
    set visible(value: boolean) {
      this.internal.node.visible = Boolean(value);
    }
    get locked() {
      return this.internal.node.locked;
    }
    set locked(value: boolean) {
      this.internal.node.locked = Boolean(value);
    }
    get material(): MaterialSpec | undefined {
      return this.internal.node.material;
    }
    set material(value: unknown) {
      if (this.internal.node.type !== "mesh") {
        throw new ForgeError("MVM_E_MATERIAL_TARGET", "Materials can only be assigned to meshes.", {
          recoveryHint: "Assign the material to a mesh, not a group or light.",
        });
      }
      this.internal.node.material = normalizeMaterial(value, "material");
    }
    get geometry(): GeometrySpec | undefined {
      return this.internal.node.geometry ? structuredClone(this.internal.node.geometry) : undefined;
    }
    get children(): PublicObject[] {
      return childrenOf(this.id).map(publicOf);
    }
    get parent(): PublicObject | null {
      const parentId = this.internal.node.parentId;
      if (!parentId) return null;
      const parent = internals.get(parentId);
      return parent ? publicOf(parent) : null;
    }
    set parent(value: unknown) {
      if (value == null) {
        setParent(this.internal, null);
        return;
      }
      setParent(this.internal, requireInternal(value, "parent"));
    }
    toJSON() {
      return { id: this.id, name: this.name, type: this.type };
    }
  }

  function createApi() {
    const geometryMesh = (name: string, geometry: GeometrySpec) => {
      const internal = makeInternal({
        name,
        type: "mesh",
        geometry,
        material: defaultMaterial(),
      });
      return publicOf(internal);
    };

    const api = {
      API_VERSION,
      schemaVersion: SCHEMA_VERSION,
      language: "javascript" as const,
      console: {
        log: (...args: unknown[]) => pushLog("log", args),
        warn: (...args: unknown[]) => pushLog("warn", args),
        error: (...args: unknown[]) => pushLog("error", args),
      },
      geometry: {
        box(opts?: Record<string, unknown>) {
          const o = record(opts, "mvm.geometry.box");
          return geometryMesh(clipName(o.name, "Box"), {
            kind: "box",
            width: posDim("mvm.geometry.box", "width", o.width, 1),
            height: posDim("mvm.geometry.box", "height", o.height, 1),
            depth: posDim("mvm.geometry.box", "depth", o.depth, 1),
            widthSegments: intDim("mvm.geometry.box", "widthSegments", o.widthSegments, 1, 1, LIMITS.maxSegments),
            heightSegments: intDim("mvm.geometry.box", "heightSegments", o.heightSegments, 1, 1, LIMITS.maxSegments),
            depthSegments: intDim("mvm.geometry.box", "depthSegments", o.depthSegments, 1, 1, LIMITS.maxSegments),
          });
        },
        sphere(opts?: Record<string, unknown>) {
          const o = record(opts, "mvm.geometry.sphere");
          return geometryMesh(clipName(o.name, "Sphere"), {
            kind: "sphere",
            radius: posDim("mvm.geometry.sphere", "radius", o.radius, 0.5),
            widthSegments: intDim("mvm.geometry.sphere", "widthSegments", o.widthSegments, 32, 3, LIMITS.maxSegments),
            heightSegments: intDim("mvm.geometry.sphere", "heightSegments", o.heightSegments, 16, 2, LIMITS.maxSegments),
          });
        },
        cylinder(opts?: Record<string, unknown>) {
          const o = record(opts, "mvm.geometry.cylinder");
          return geometryMesh(clipName(o.name, "Cylinder"), {
            kind: "cylinder",
            radiusTop: num("mvm.geometry.cylinder", "radiusTop", o.radiusTop, 0.5, 0, LIMITS.maxDimension),
            radiusBottom: num("mvm.geometry.cylinder", "radiusBottom", o.radiusBottom, 0.5, 0, LIMITS.maxDimension),
            height: posDim("mvm.geometry.cylinder", "height", o.height, 1),
            radialSegments: intDim("mvm.geometry.cylinder", "radialSegments", o.radialSegments, 24, 3, LIMITS.maxSegments),
            openEnded: Boolean(o.openEnded),
          });
        },
        cone(opts?: Record<string, unknown>) {
          const o = record(opts, "mvm.geometry.cone");
          return geometryMesh(clipName(o.name, "Cone"), {
            kind: "cone",
            radius: posDim("mvm.geometry.cone", "radius", o.radius, 0.5),
            height: posDim("mvm.geometry.cone", "height", o.height, 1),
            radialSegments: intDim("mvm.geometry.cone", "radialSegments", o.radialSegments, 24, 3, LIMITS.maxSegments),
          });
        },
        torus(opts?: Record<string, unknown>) {
          const o = record(opts, "mvm.geometry.torus");
          return geometryMesh(clipName(o.name, "Torus"), {
            kind: "torus",
            radius: posDim("mvm.geometry.torus", "radius", o.radius, 0.5),
            tube: posDim("mvm.geometry.torus", "tube", o.tube, 0.18),
            radialSegments: intDim("mvm.geometry.torus", "radialSegments", o.radialSegments, 16, 3, LIMITS.maxSegments),
            tubularSegments: intDim(
              "mvm.geometry.torus",
              "tubularSegments",
              o.tubularSegments,
              48,
              3,
              LIMITS.maxTubularSegments,
            ),
          });
        },
        plane(opts?: Record<string, unknown>) {
          const o = record(opts, "mvm.geometry.plane");
          return geometryMesh(clipName(o.name, "Plane"), {
            kind: "plane",
            width: posDim("mvm.geometry.plane", "width", o.width, 1),
            height: posDim("mvm.geometry.plane", "height", o.height, 1),
            widthSegments: intDim("mvm.geometry.plane", "widthSegments", o.widthSegments, 1, 1, LIMITS.maxSegments),
            heightSegments: intDim("mvm.geometry.plane", "heightSegments", o.heightSegments, 1, 1, LIMITS.maxSegments),
          });
        },
        capsule(opts?: Record<string, unknown>) {
          const o = record(opts, "mvm.geometry.capsule");
          return geometryMesh(clipName(o.name, "Capsule"), {
            kind: "capsule",
            radius: posDim("mvm.geometry.capsule", "radius", o.radius, 0.25),
            length: posDim("mvm.geometry.capsule", "length", o.length, 0.8),
            capSegments: intDim("mvm.geometry.capsule", "capSegments", o.capSegments, 4, 1, 32),
            radialSegments: intDim("mvm.geometry.capsule", "radialSegments", o.radialSegments, 12, 3, LIMITS.maxSegments),
          });
        },
        custom(opts?: Record<string, unknown>) {
          const o = record(opts, "mvm.geometry.custom");
          const positions = numArray(o.positions, "mvm.geometry.custom", "positions");
          if (positions.length < 9 || positions.length % 3 !== 0) {
            throw new ForgeError(
              "MVM_E_GEOMETRY_CUSTOM_INVALID",
              "positions must be a flat array of finite numbers, length multiple of 3, at least one triangle.",
              { recoveryHint: "Example: [0,0,0, 1,0,0, 0,1,0]", context: { api: "mvm.geometry.custom" } },
            );
          }
          if (positions.length / 3 > LIMITS.maxVerticesPerMesh) {
            throw new ForgeError(
              "MVM_E_GEOMETRY_CUSTOM_INVALID",
              `Custom mesh exceeds ${LIMITS.maxVerticesPerMesh} vertices.`,
              { recoveryHint: "Reduce the vertex count." },
            );
          }
          const vertexCount = positions.length / 3;
          const indices = o.indices === undefined ? undefined : indexArray(o.indices, vertexCount);
          const normals = o.normals === undefined ? undefined : vecArray(o.normals, "normals", positions.length);
          const uvs = o.uvs === undefined ? undefined : uvArray(o.uvs, vertexCount);
          return geometryMesh(clipName(o.name, "Custom"), {
            kind: "custom",
            positions,
            indices,
            normals,
            uvs,
          });
        },
        humanoid(opts?: Record<string, unknown>) {
          const o = record(opts, "mvm.geometry.humanoid");
          const params: HumanoidParams = {
            name: clipName(o.name, HUMANOID_DEFAULTS.name),
            height: posDim("mvm.geometry.humanoid", "height", o.height, HUMANOID_DEFAULTS.height),
            shoulderWidth: posDim(
              "mvm.geometry.humanoid",
              "shoulderWidth",
              o.shoulderWidth ?? o.shoulder,
              HUMANOID_DEFAULTS.shoulderWidth,
            ),
            hipWidth: posDim("mvm.geometry.humanoid", "hipWidth", o.hipWidth ?? o.hip, HUMANOID_DEFAULTS.hipWidth),
            headScale: num("mvm.geometry.humanoid", "headScale", o.headScale, HUMANOID_DEFAULTS.headScale, 0.2, 3),
            armLength: posDim("mvm.geometry.humanoid", "armLength", o.armLength, HUMANOID_DEFAULTS.armLength),
            legLength: posDim("mvm.geometry.humanoid", "legLength", o.legLength, HUMANOID_DEFAULTS.legLength),
          };
          const nodes = buildHumanoidNodes(params, "script");
          let group: PublicObject | null = null;
          for (const node of nodes) {
            if (internals.size >= LIMITS.maxObjects) {
              throw new ForgeError("MVM_E_OBJECT_LIMIT", `Humanoid exceeded the object budget of ${LIMITS.maxObjects}.`);
            }
            const internal = makeInternal(
              {
                id: node.id,
                name: node.name,
                type: node.type,
                parentId: node.parentId,
                geometry: node.geometry,
                material: node.material,
                position: node.position,
                rotation: node.rotation,
                scale: node.scale,
              },
              "script",
            );
            const pub = publicOf(internal);
            if (!group) group = pub;
          }
          if (!group) {
            throw new ForgeError("MVM_E_GEOMETRY_CUSTOM_INVALID", "Humanoid builder returned no nodes.");
          }
          return group;
        },
      },
      material: {
        pbr(opts?: Record<string, unknown>) {
          return normalizeMaterial(opts ?? {}, "mvm.material.pbr");
        },
      },
      texture: {
        solid: (opts?: Record<string, unknown>) => procedural("solid", "mvm.texture.solid", opts, "srgb"),
        checker: (opts?: Record<string, unknown>) => procedural("checker", "mvm.texture.checker", opts, "srgb"),
        stripes: (opts?: Record<string, unknown>) => procedural("stripes", "mvm.texture.stripes", opts, "srgb"),
        dots: (opts?: Record<string, unknown>) => procedural("dots", "mvm.texture.dots", opts, "srgb"),
        gradient: (opts?: Record<string, unknown>) => procedural("gradient", "mvm.texture.gradient", opts, "srgb"),
        noise: (opts?: Record<string, unknown>) => procedural("noise", "mvm.texture.noise", opts, "linear"),
        canvas(opts?: Record<string, unknown>) {
          const o = record(opts, "mvm.texture.canvas");
          if (typeof o.paint !== "function" && typeof o.draw !== "function") {
            throw new ForgeError("MVM_E_TEXTURE_UNSUPPORTED", "mvm.texture.canvas requires a paint(ctx) function.", {
              recoveryHint: "Pass { width, height, paint(ctx) { ... } }.",
            });
          }
          if (typeof OffscreenCanvas === "undefined") {
            throw new ForgeError(
              "MVM_E_TEXTURE_UNSUPPORTED",
              "This sandbox has no OffscreenCanvas, so canvas textures cannot be painted.",
              { recoveryHint: "Use mvm.texture.checker or another procedural generator." },
            );
          }
          const width = intDim("mvm.texture.canvas", "width", o.width, 256, 2, LIMITS.maxTextureSize);
          const height = intDim("mvm.texture.canvas", "height", o.height, 256, 2, LIMITS.maxTextureSize);
          const asset: TextureAsset = {
            id: crypto.randomUUID(),
            name: clipName(o.name, "Canvas"),
            source: "script",
            colorSpace: o.colorSpace === "linear" ? "linear" : "srgb",
            width,
            height,
          };
          const paint = (o.paint ?? o.draw) as (ctx: OffscreenCanvasRenderingContext2D) => void;
          paints.push(async () => {
            const canvas = new OffscreenCanvas(width, height);
            const ctx = canvas.getContext("2d");
            if (!ctx) throw new ForgeError("MVM_E_TEXTURE_UNSUPPORTED", "2D canvas context was not available.");
            paint(ctx);
            const blob = await canvas.convertToBlob({ type: "image/png" });
            asset.dataUrl = await blobToDataUrl(blob);
          });
          return textureHandle(asset);
        },
        fromDataUrl(opts?: Record<string, unknown>) {
          const o = record(opts, "mvm.texture.fromDataUrl");
          if (typeof o.dataUrl !== "string" || !o.dataUrl.startsWith("data:image/")) {
            throw new ForgeError("MVM_E_TEXTURE_TYPE", "fromDataUrl requires a data:image/ URL.", {
              recoveryHint: "Pass a PNG, JPEG, or WebP data URL produced in this sandbox.",
            });
          }
          if (o.dataUrl.length > 12_000_000) {
            throw new ForgeError("MVM_E_TEXTURE_LIMIT", "Data URL texture is too large.", {
              recoveryHint: "Resize the image below 2048px before embedding.",
            });
          }
          const asset: TextureAsset = {
            id: crypto.randomUUID(),
            name: clipName(o.name, "Image"),
            source: "script",
            colorSpace: o.colorSpace === "linear" ? "linear" : "srgb",
            width: intDim("mvm.texture.fromDataUrl", "width", o.width, 256, 1, LIMITS.maxTextureSize),
            height: intDim("mvm.texture.fromDataUrl", "height", o.height, 256, 1, LIMITS.maxTextureSize),
            dataUrl: o.dataUrl,
          };
          return textureHandle(asset);
        },
      },
      light: {
        ambient: (opts?: Record<string, unknown>) => lightNode("ambient", opts),
        hemisphere: (opts?: Record<string, unknown>) => lightNode("hemisphere", opts),
        directional: (opts?: Record<string, unknown>) => lightNode("directional", opts),
        point: (opts?: Record<string, unknown>) => lightNode("point", opts),
        spot: (opts?: Record<string, unknown>) => lightNode("spot", opts),
      },
      camera: {
        perspective(opts?: Record<string, unknown>) {
          camera = readCamera("perspective", opts);
          return { ...camera };
        },
        orthographic(opts?: Record<string, unknown>) {
          camera = readCamera("orthographic", opts);
          return { ...camera };
        },
      },
      scene: {
        add(...items: unknown[]) {
          const list = items.flat();
          if (!list.length) {
            throw new ForgeError("MVM_E_ARGUMENT_TYPE", "mvm.scene.add expected at least one object.");
          }
          for (const item of list) {
            // Bridge compatibility: accept native Three.js Object3D values as well as
            // Forge handles. This lets a group of native meshes be added through either API.
            if (item instanceof THREE.Object3D) {
              threeScene.add(item);
              continue;
            }
            const internal = requireInternal(item, "mvm.scene.add");
            internal.node.parentId = null;
            attach(internal);
          }
          return list.length === 1 ? list[0] : list;
        },
        remove(target: unknown) {
          if (target instanceof THREE.Object3D) {
            threeScene.remove(target);
            return;
          }
          const internal = requireInternal(target, "mvm.scene.remove");
          internal.inScene = false;
          for (const id of descendantIds(internal.node.id)) {
            const child = internals.get(id);
            if (child) child.inScene = false;
          }
        },
        clear() {
          for (const item of internals.values()) item.inScene = false;
          threeScene.clear();
        },
        group(opts?: Record<string, unknown>) {
          const o = record(opts, "mvm.scene.group");
          const internal = makeInternal({ name: clipName(o.name, "Group"), type: "group" });
          const pub = publicOf(internal);
          const kids = Array.isArray(o.children) ? o.children : [];
          for (const kid of kids) {
            const child = requireInternal(kid, "mvm.scene.group");
            setParent(child, internal);
          }
          return pub;
        },
        get(idOrName: unknown) {
          if (typeof idOrName !== "string") {
            throw new ForgeError("MVM_E_ARGUMENT_TYPE", "mvm.scene.get expected an id or name string.");
          }
          const internal = [...internals.values()].find(
            (item) => item.node.id === idOrName || item.node.name === idOrName,
          );
          return internal ? publicOf(internal) : null;
        },
        list() {
          return [...internals.values()].filter((item) => item.inScene).map(publicOf);
        },
        background(color: unknown) {
          background = hexColor("mvm.scene.background", "color", color, "#10161E");
          return background;
        },
        environment(preset: unknown) {
          if (preset !== "studio" && preset !== "neutral" && preset !== "none") {
            throw new ForgeError(
              "MVM_E_ARGUMENT_TYPE",
              'mvm.scene.environment expected "studio", "neutral", or "none".',
              { recoveryHint: 'Use mvm.scene.environment("studio").' },
            );
          }
          environment = preset;
          return preset;
        },
        exposure(value: unknown) {
          exposure = num("mvm.scene.exposure", "value", value, 1, 0, 5);
          return exposure;
        },
      },
      object: {
        setParent(child: unknown, parent: unknown) {
          const childNode = requireInternal(child, "mvm.object.setParent");
          if (parent == null) {
            setParent(childNode, null);
            return;
          }
          setParent(childNode, requireInternal(parent, "mvm.object.setParent"));
        },
        stats(target: unknown) {
          const internal = requireInternal(target, "mvm.object.stats");
          return internal.node.stats ? { ...internal.node.stats } : null;
        },
      },
      animation: {
        clip(opts?: Record<string, unknown>) {
          if (clips.length >= LIMITS.maxClips) {
            throw new ForgeError("MVM_E_ANIMATION_INVALID", `Clip budget is ${LIMITS.maxClips}.`);
          }
          const o = record(opts, "mvm.animation.clip");
          const clip: AnimClip = {
            id: crypto.randomUUID(),
            name: clipName(o.name, "Clip"),
            duration: num("mvm.animation.clip", "duration", o.duration, 1, 0.01, 600),
            loop: o.loop === undefined ? true : Boolean(o.loop),
            source: "script",
            tracks: [],
          };
          clips.push(clip);
          return { id: clip.id, name: clip.name };
        },
        track(clipRef: unknown, opts?: Record<string, unknown>) {
          const o = record(opts, "mvm.animation.track");
          const clip = resolveClip(clipRef);
          if (!clip) {
            throw new ForgeError("MVM_E_ANIMATION_INVALID", "Unknown animation clip.", {
              recoveryHint: "Pass the object returned by mvm.animation.clip, or its name.",
            });
          }
          const queuedTracks = pendingThreeTracks.filter((track) => track.clipId === clip.id).length;
          if (clip.tracks.length + queuedTracks >= LIMITS.maxTracksPerClip) {
            throw new ForgeError("MVM_E_ANIMATION_INVALID", `Track budget per clip is ${LIMITS.maxTracksPerClip}.`);
          }
          const targetValue = o.object ?? o.target;
          const nativeTarget = targetValue instanceof THREE.Object3D ? targetValue : null;
          const target = nativeTarget ? null : requireInternal(targetValue, "mvm.animation.track");
          const property = parseProperty(o.property);
          const interpolation = o.interpolation === undefined ? "linear" : parseInterp(o.interpolation);
          const keysIn = Array.isArray(o.keys) ? o.keys : o.keyframes;
          if (!Array.isArray(keysIn) || keysIn.length < 1) {
            throw new ForgeError("MVM_E_ANIMATION_INVALID", "Track keys must be a non-empty array.", {
              recoveryHint: "Example: [{ time: 0, value: [0,0,0] }, { time: 1, value: [0,90,0] }]",
            });
          }
          if (keysIn.length > LIMITS.maxKeyframesPerTrack) {
            throw new ForgeError("MVM_E_ANIMATION_INVALID", `Too many keys. Limit is ${LIMITS.maxKeyframesPerTrack}.`);
          }
          const expect = property === "quaternion" ? 4 : 3;
          const keyframes = keysIn.map((key, index) => {
            const row = record(key, "mvm.animation.track key");
            const time = num("mvm.animation.track", `keys[${index}].time`, row.time ?? row.t, NaN, 0, 600);
            const raw = row.value;
            if (!Array.isArray(raw) || raw.length < expect || raw.some((n) => typeof n !== "number" || !Number.isFinite(n))) {
              throw new ForgeError(
                "MVM_E_ANIMATION_INVALID",
                `keys[${index}].value must be ${expect} finite numbers.`,
                { recoveryHint: "Rotation values are degrees. Quaternion values are x,y,z,w." },
              );
            }
            return { time, value: raw.slice(0, expect).map(Number) };
          });
          const trackId = crypto.randomUUID();
          if (nativeTarget) {
            // Native Three.js targets are resolved to Forge node IDs after the scene bridge
            // has converted all Object3D instances. This supports mvm.animation.track on
            // THREE.Mesh, THREE.Group and other native Three.js objects.
            pendingThreeTracks.push({
              clipId: clip.id,
              object: nativeTarget,
              property,
              interpolation,
              keyframes,
            });
          } else if (target) {
            const track: AnimTrack = {
              id: trackId,
              objectId: target.node.id,
              property,
              interpolation,
              keyframes,
            };
            clip.tracks.push(track);
          }
          const maxTime = keyframes.reduce((m, key) => Math.max(m, key.time), 0);
          if (maxTime > clip.duration) clip.duration = maxTime;
          return { id: trackId };
        },
        play(nameOrId: unknown) {
          const clip = resolveClip(nameOrId);
          if (!clip) {
            throw new ForgeError("MVM_E_ANIMATION_INVALID", `No clip named ${String(nameOrId)}.`, {
              recoveryHint: "Create the clip before calling play. Play flags the viewport; it does not render by itself.",
            });
          }
          autoplayClipId = clip.id;
          return { id: clip.id, name: clip.name };
        },
        stop() {
          autoplayClipId = null;
        },
      },
      project: {
        name(value?: unknown) {
          if (value === undefined) return projectName ?? null;
          projectName = clipName(value, "Untitled");
          return projectName;
        },
        info() {
          return {
            apiVersion: API_VERSION,
            schemaVersion: SCHEMA_VERSION,
            name: projectName ?? null,
            objectCount: [...internals.values()].filter((item) => item.inScene).length,
            textureCount: textures.length,
            clipCount: clips.length,
          };
        },
      },
      validate: {
        scene() {
          const patch = snapshot();
          const issues = validateScene(patch);
          return {
            ok: !issues.some((item) => item.severity === "error"),
            issues,
          };
        },
        object(target: unknown) {
          const internal = requireInternal(target, "mvm.validate.object");
          const issues = validateScene({
            objects: [syncNode(internal)],
            textures,
            clips: [],
          }).filter((item) => item.code !== "MVM_E_EXPORT_EMPTY" || internal.node.type === "mesh");
          return { ok: !issues.some((item) => item.severity === "error"), issues };
        },
      },
      export: {
        requestGlb(opts?: Record<string, unknown>) {
          const o = record(opts, "mvm.export.requestGlb");
          exportRequest = {
            filename: o.filename === undefined ? undefined : clipName(o.filename, "model.glb").replace(/\.glb$/i, "") + ".glb",
            visibleOnly: o.visibleOnly === undefined ? true : Boolean(o.visibleOnly),
            includeAnimations: o.includeAnimations === undefined ? true : Boolean(o.includeAnimations),
          };
          pushLog("log", ["GLB export requested. Confirm it in the studio — the sandbox cannot download files."]);
          return { requested: true, ...exportRequest };
        },
      },
    };

    function lightNode(kind: LightSpec["kind"], opts?: Record<string, unknown>) {
      const apiName = `mvm.light.${kind}`;
      const o = record(opts, apiName);
      const light: LightSpec = {
        kind,
        color: hexColor(apiName, "color", o.color ?? o.skyColor, "#FFF6EC"),
        intensity: num(apiName, "intensity", o.intensity, kind === "ambient" || kind === "hemisphere" ? 0.5 : 2, 0, 50),
        castShadow: Boolean(o.castShadow),
      };
      if (kind === "hemisphere") light.groundColor = hexColor(apiName, "groundColor", o.groundColor, "#243140");
      if (kind === "point" || kind === "spot") {
        light.distance = num(apiName, "distance", o.distance, 0, 0, 1000);
        light.decay = num(apiName, "decay", o.decay, 2, 0, 5);
      }
      if (kind === "spot") {
        light.angle = num(apiName, "angle", o.angle, 35, 0.1, 89);
        light.penumbra = unit(apiName, "penumbra", o.penumbra, 0.4);
      }
      if (o.target !== undefined) light.target = asVec3(o.target, `${apiName}.target`);
      else if (kind === "directional" || kind === "spot") light.target = [0, 0.5, 0];
      const position = o.position ? asVec3(o.position, `${apiName}.position`) : [0, kind === "ambient" ? 0 : 3, 0];
      const internal = makeInternal({
        name: clipName(o.name, kind[0].toUpperCase() + kind.slice(1) + " Light"),
        type: "light",
        light,
        position,
      });
      return publicOf(internal);
    }

    function readCamera(type: "perspective" | "orthographic", opts?: Record<string, unknown>) {
      const apiName = `mvm.camera.${type}`;
      const o = record(opts, apiName);
      return {
        type,
        fov: num(apiName, "fov", o.fov, 42, 5, 120),
        near: posDim(apiName, "near", o.near, 0.05),
        far: posDim(apiName, "far", o.far, 400),
        position: (o.position ? asVec3(o.position, `${apiName}.position`) : [4.4, 2.5, 6.4]) as Vec3,
        target: (o.target ? asVec3(o.target, `${apiName}.target`) : [0, 0.75, 0]) as Vec3,
        orthoSize: posDim(apiName, "size", o.size ?? o.orthoSize, 4),
      };
    }

    function resolveClip(ref: unknown): AnimClip | undefined {
      if (!ref) return undefined;
      if (typeof ref === "string") return clips.find((clip) => clip.id === ref || clip.name === ref);
      if (typeof ref === "object" && ref && "id" in ref) {
        return clips.find((clip) => clip.id === (ref as { id: string }).id);
      }
      return undefined;
    }

    function snapshot(): ScriptPatch {
      const objects = [...internals.values()].filter((item) => item.inScene).map(syncNode);
      const known = new Set(objects.map((node) => node.id));
      for (const node of objects) {
        if (node.parentId && !known.has(node.parentId)) node.parentId = null;
      }
      return {
        objects,
        textures: textures.map((tex) => ({ ...tex, params: tex.params ? { ...tex.params } : undefined })),
        clips: clips.map((clip) => ({
          ...clip,
          tracks: clip.tracks.map((track) => ({
            ...track,
            keyframes: track.keyframes.map((key) => ({ time: key.time, value: [...key.value] })),
          })),
        })),
        background,
        environment,
        exposure,
        camera,
        projectName,
        exportRequest,
        autoplayClipId,
        issues: [],
      };
    }

    return { api, snapshot };
  }

  const { api, snapshot } = createApi();

  // Real Three.js runtime: scripts receive the actual imported Three.js namespace
  // and a real THREE.Scene. After execution, supported Object3D data is converted
  // into Forge's validated project model so viewport/save/GLB export stay consistent.
  const threeScene = new THREE.Scene();
  const importedThreeObjects = new Map<THREE.Object3D, any>();

  function isForgeMaterialSpec(value: unknown): value is MaterialSpec {
    if (!value || typeof value !== "object") return false;
    const spec = value as Partial<MaterialSpec>;
    return typeof spec.color === "string"
      && /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(spec.color)
      && typeof spec.roughness === "number"
      && typeof spec.metalness === "number"
      && typeof spec.emissive === "string";
  }

  function materialOptions(material: THREE.Material | THREE.Material[] | MaterialSpec): MaterialSpec {
    const m = Array.isArray(material) ? material[0] : material;
    // mvm.material.pbr returns a Forge MaterialSpec, not a THREE.Material. Preserve it
    // verbatim when it is assigned to a native THREE.Mesh during mixed-API authoring.
    if (isForgeMaterialSpec(m)) return m;
    const threeMaterial = m as THREE.Material;
    if (Array.isArray(material) && material.length > 1) {
      pushLog("warn", [`Mesh uses ${material.length} materials; Forge currently preserves only the first material. Geometry groups may therefore lose their original per-face material assignments.`]);
    }
    if (!(threeMaterial instanceof THREE.MeshStandardMaterial) && !(threeMaterial instanceof THREE.MeshPhysicalMaterial)
      && !(threeMaterial instanceof THREE.MeshPhongMaterial) && !(threeMaterial instanceof THREE.MeshLambertMaterial)
      && !(threeMaterial instanceof THREE.MeshBasicMaterial)) {
      pushLog("warn", [`Material "${threeMaterial?.type ?? "unknown"}" is not fully representable in the Forge PBR project format; using a best-effort conversion.`]);
    }
    const pbr = threeMaterial as THREE.MeshStandardMaterial;
    const color = pbr.color instanceof THREE.Color ? "#" + pbr.color.getHexString() : "#D4AF37";
    const emissive = pbr.emissive instanceof THREE.Color ? "#" + pbr.emissive.getHexString() : "#000000";
    const side = threeMaterial.side === THREE.DoubleSide ? "double" : threeMaterial.side === THREE.BackSide ? "back" : "front";
    if (threeMaterial instanceof THREE.MeshStandardMaterial || threeMaterial instanceof THREE.MeshPhysicalMaterial) {
      const mapped = [
        ["map", pbr.map],
        ["normalMap", pbr.normalMap],
        ["roughnessMap", pbr.roughnessMap],
        ["metalnessMap", pbr.metalnessMap],
        ["aoMap", pbr.aoMap],
      ].filter(([, texture]) => Boolean(texture)).map(([slot]) => slot);
      if (mapped.length) {
        pushLog("warn", [`Material "${threeMaterial.name || threeMaterial.type}" has texture maps (${mapped.join(", ")}); current scene conversion preserves base material values but not these external texture pixels.`]);
      }
    }
    if (threeMaterial instanceof THREE.ShaderMaterial || threeMaterial instanceof THREE.RawShaderMaterial) {
      pushLog("warn", [`Shader material "${threeMaterial.name || threeMaterial.type}" cannot be represented in the Forge PBR schema; using a fallback material.`]);
    }
    return {
      color,
      metalness: typeof pbr.metalness === "number" ? pbr.metalness : 0,
      roughness: typeof pbr.roughness === "number" ? pbr.roughness : 0.8,
      opacity: typeof pbr.opacity === "number" ? pbr.opacity : 1,
      emissive,
      emissiveIntensity: typeof pbr.emissiveIntensity === "number" ? pbr.emissiveIntensity : 0,
      alphaMode: threeMaterial.transparent ? "BLEND" : threeMaterial.alphaTest > 0 ? "MASK" : "OPAQUE",
      alphaCutoff: typeof threeMaterial.alphaTest === "number" ? threeMaterial.alphaTest : 0.5,
      side,
      mapId: null,
      normalMapId: null,
      aoMapId: null,
      roughnessMapId: null,
      metalnessMapId: null,
      repeat: [1, 1],
      offset: [0, 0],
      rotation: 0,
      wrap: "repeat",
    };
  }

  function attributeValues(attribute: THREE.BufferAttribute | THREE.InterleavedBufferAttribute, itemSize: number, label: string): number[] {
    if (attribute.itemSize < itemSize) {
      throw new ForgeError("MVM_E_GEOMETRY_CUSTOM_INVALID", `Three.js ${label} attribute itemSize is ${attribute.itemSize}; expected at least ${itemSize}.`);
    }
    const values: number[] = [];
    for (let i = 0; i < attribute.count; i += 1) {
      for (let component = 0; component < itemSize; component += 1) {
        const value = component === 0 ? attribute.getX(i)
          : component === 1 ? attribute.getY(i)
          : component === 2 ? attribute.getZ(i)
          : component === 3 ? attribute.getW(i)
          : Number.NaN;
        if (!Number.isFinite(value)) {
          throw new ForgeError("MVM_E_GEOMETRY_CUSTOM_INVALID", `Three.js ${label} attribute contains a non-finite value at vertex ${i}.`);
        }
        values.push(value);
      }
    }
    return values;
  }

  function convertThreeScene() {
    const nodes: THREE.Object3D[] = [];
    threeScene.updateMatrixWorld(true);
    threeScene.traverse((object) => {
      if (object !== threeScene && (object as THREE.Object3D).isObject3D) nodes.push(object);
    });
    const discoveredMeshes = nodes.filter((object) => Boolean((object as THREE.Mesh).isMesh));
    let convertedMeshes = 0;
    pushLog("log", [`Three.js bridge: discovered ${nodes.length} scene objects and ${discoveredMeshes.length} mesh objects.`]);

    // Create handles before linking parents, so child-before-parent insertion works.
    for (const object of nodes) {
      if (importedThreeObjects.has(object)) continue;
      let handle: any;
      const meshLike = object as THREE.Mesh;
      const geometryLike = meshLike.geometry as THREE.BufferGeometry | undefined;
      const rawGeometry: unknown = meshLike.geometry;
      if (meshLike.isMesh && rawGeometry instanceof PublicObject) {
        // mvm.geometry.box/sphere/torus return Forge mesh handles (GeometrySpec), not
        // Three.js BufferGeometry objects. If users wrap one in THREE.Mesh, reuse that
        // Forge handle and copy the native mesh's name, transform, visibility and material.
        handle = rawGeometry;
        handle.name = object.name || handle.name || object.type || "Mesh";
        if (isForgeMaterialSpec(meshLike.material)) {
          handle.material = meshLike.material;
        } else {
          handle.material = materialOptions(meshLike.material as THREE.Material | THREE.Material[]);
        }
        convertedMeshes += 1;
      } else if (meshLike.isMesh && geometryLike?.isBufferGeometry) {
        const geometry = geometryLike;
        const position = geometry.getAttribute("position");
        if (!position || position.count < 3) {
          pushLog("warn", [`Skipped mesh "${object.name || object.type}": geometry has no valid position attribute.`]);
          continue;
        }
        if (position.count > LIMITS.maxVerticesPerMesh) {
          throw new ForgeError("MVM_E_GEOMETRY_CUSTOM_INVALID", `Mesh "${object.name || object.type}" exceeds the ${LIMITS.maxVerticesPerMesh} vertex limit.`);
        }
        if (object instanceof THREE.SkinnedMesh || geometry.morphAttributes.position?.length) {
          pushLog("warn", [`Mesh "${object.name || object.type}" uses skinning or morph targets. This converter currently preserves its base geometry only; deformation/rig animation will not carry into Forge.`]);
        }
        if (geometry.groups.length > 0 && Array.isArray(object.material) && object.material.length > 1) {
          pushLog("warn", [`Mesh "${object.name || object.type}" has geometry groups with multiple materials; those per-group assignments are not preserved yet.`]);
        }
        const positions = attributeValues(position, 3, "position");
        const index = geometry.getIndex();
        const normals = geometry.getAttribute("normal");
        const uv = geometry.getAttribute("uv");
        handle = api.geometry.custom({
          name: object.name || object.type,
          positions,
          indices: index ? Array.from(index.array as ArrayLike<number>) : undefined,
          normals: normals ? attributeValues(normals, 3, "normal") : undefined,
          uvs: uv ? attributeValues(uv, 2, "uv") : undefined,
        });
        handle.material = isForgeMaterialSpec(object.material)
          ? object.material
          : materialOptions(object.material as THREE.Material | THREE.Material[]);
      } else if (
        (object as THREE.Group).isGroup ||
        (object as THREE.Bone).isBone ||
        (object as THREE.Camera).isCamera ||
        object.constructor === THREE.Object3D
      ) {
        handle = api.scene.group({ name: object.name || object.type || "Group" });
      } else if ((object as THREE.PointLight).isPointLight && !(object as THREE.SpotLight).isSpotLight) {
        const light = object as THREE.PointLight;
        handle = api.light.point({ name: object.name || "Point Light", color: "#" + light.color.getHexString(), intensity: light.intensity, distance: light.distance, decay: light.decay });
      } else if ((object as THREE.SpotLight).isSpotLight) {
        handle = api.light.spot({
          name: object.name || "Spot Light",
          color: "#" + object.color.getHexString(),
          intensity: object.intensity,
          distance: object.distance,
          decay: object.decay,
          angle: THREE.MathUtils.radToDeg(object.angle),
          penumbra: object.penumbra,
          castShadow: object.castShadow,
          target: [object.target.position.x, object.target.position.y, object.target.position.z],
        });
      } else if ((object as THREE.DirectionalLight).isDirectionalLight) {
        const light = object as THREE.DirectionalLight;
        handle = api.light.directional({
          name: object.name || "Directional Light",
          color: "#" + light.color.getHexString(),
          intensity: light.intensity,
          castShadow: light.castShadow,
          target: [light.target.position.x, light.target.position.y, light.target.position.z],
        });
      } else if ((object as THREE.HemisphereLight).isHemisphereLight) {
        const light = object as THREE.HemisphereLight;
        handle = api.light.hemisphere({ name: object.name || "Hemisphere Light", color: "#" + light.color.getHexString(), groundColor: "#" + light.groundColor.getHexString(), intensity: light.intensity });
      } else if ((object as THREE.AmbientLight).isAmbientLight) {
        const light = object as THREE.AmbientLight;
        handle = api.light.ambient({ name: object.name || "Ambient Light", color: "#" + light.color.getHexString(), intensity: light.intensity });
      }
      if (!handle) continue;
      handle.position.set(object.position.x, object.position.y, object.position.z);
      handle.rotation.set(
        THREE.MathUtils.radToDeg(object.rotation.x),
        THREE.MathUtils.radToDeg(object.rotation.y),
        THREE.MathUtils.radToDeg(object.rotation.z),
      );
      handle.scale.set(object.scale.x, object.scale.y, object.scale.z);
      handle.visible = object.visible;
      importedThreeObjects.set(object, handle);
      if (meshLike.isMesh && geometryLike?.isBufferGeometry) convertedMeshes += 1;
    }

    // Link the entire hierarchy before attaching roots. If a root is attached before its
    // children receive parent IDs, attach() cannot discover those children and they remain
    // out of the persisted scene (the classic "discovered meshes, converted zero Forge nodes" bug).
    for (const object of nodes) {
      const handle = importedThreeObjects.get(object);
      if (!handle) continue;
      const parent = object.parent && object.parent !== threeScene ? importedThreeObjects.get(object.parent) : undefined;
      if (parent) handle.parent = parent;
    }
    // Now every parentId is populated, so attaching each root includes all descendants.
    for (const object of nodes) {
      const handle = importedThreeObjects.get(object);
      if (!handle) continue;
      const parent = object.parent && object.parent !== threeScene ? importedThreeObjects.get(object.parent) : undefined;
      if (!parent) api.scene.add(handle);
    }

    // Resolve animation targets only after all native Three.js objects have been mapped
    // to Forge handles. This also supports clips authored before mvm.scene.add(root).
    for (const pending of pendingThreeTracks.splice(0)) {
      const handle = importedThreeObjects.get(pending.object);
      const clip = clips.find((item) => item.id === pending.clipId);
      if (!(handle instanceof PublicObject) || !clip) {
        pushLog("warn", [`Skipped animation track: Three.js target "${pending.object.name || pending.object.type}" was not converted into a Forge node.`]);
        continue;
      }
      if (clip.tracks.length >= LIMITS.maxTracksPerClip) {
        pushLog("warn", [`Skipped an animation track for "${clip.name}": the track limit is ${LIMITS.maxTracksPerClip}.`]);
        continue;
      }
      clip.tracks.push({
        id: crypto.randomUUID(),
        objectId: handle.id,
        property: pending.property,
        interpolation: pending.interpolation,
        keyframes: pending.keyframes,
      });
    }

    if (threeScene.background instanceof THREE.Color) {
      const c = threeScene.background;
      api.scene.background("#" + c.getHexString());
    }
    pushLog("log", [`Three.js bridge: converted ${convertedMeshes} mesh objects into Forge nodes.`]);
    if (discoveredMeshes.length > 0 && convertedMeshes === 0) {
      pushLog("error", ["Three.js meshes were found but none could be converted. Check the mesh geometry and the console warnings above."]);
    }
  }

  // Capture the familiar browser console API and route it into the Studio Console.
  // User scripts should not have to know about the internal mvm.console helper.
  const scriptConsole = {
    log: (...args: unknown[]) => pushLog("log", args),
    info: (...args: unknown[]) => pushLog("log", args),
    debug: (...args: unknown[]) => pushLog("log", args),
    warn: (...args: unknown[]) => pushLog("warn", args),
    error: (...args: unknown[]) => pushLog("error", args),
  };

  try {
    const fn = new Function("mvm", "THREE", "scene", "console", PRELUDE + code) as (
      mvm: typeof api,
      THREE: typeof THREE,
      scene: THREE.Scene,
      console: typeof scriptConsole,
    ) => unknown;
    const returned = fn(api, THREE, threeScene, scriptConsole);
    if (returned && typeof (returned as Promise<unknown>).then === "function") {
      await returned;
    }
    for (const paint of paints) await paint();
    convertThreeScene();
    const patch = snapshot();
    patch.issues = validateScene(patch).filter((item) => item.code !== "MVM_E_EXPORT_EMPTY" || patch.objects.some((o) => o.type === "mesh"));
    const hard = patch.issues.find((item) => item.severity === "error");
    if (hard && hard.code !== "MVM_E_EXPORT_EMPTY") {
      return { ok: false, error: hard, logs, issues: patch.issues };
    }
    return { ok: true, patch, logs };
  } catch (error) {
    const parsed = errorToIssue(error);
    if (parsed.line === undefined) {
      const loc = parseStack(error);
      if (loc) {
        parsed.line = loc.line;
        parsed.column = loc.column;
      }
    }
    return { ok: false, error: parsed, logs, issues: [parsed] };
  }
}

function parseStack(error: unknown): { line: number; column: number } | null {
  const stack = error instanceof Error ? `${error.stack ?? ""}\n${error.message}` : "";
  const match = /<anonymous>:(\d+):(\d+)/.exec(stack);
  if (!match) return null;
  return { line: Math.max(1, Number(match[1]) - PRELUDE_LINES), column: Number(match[2]) };
}

function parseAlpha(api: string, value: unknown): MaterialSpec["alphaMode"] {
  if (value === "OPAQUE" || value === "BLEND" || value === "MASK") return value;
  throw new ForgeError("MVM_E_MATERIAL_RANGE", `${api}: alphaMode must be OPAQUE, BLEND, or MASK.`, {
    context: { api },
  });
}

function parseSide(api: string, value: unknown): MaterialSpec["side"] {
  if (value === undefined || value === "front") return "front";
  if (value === "back" || value === "double") return value;
  throw new ForgeError("MVM_E_MATERIAL_RANGE", `${api}: side must be front, back, or double.`, { context: { api } });
}

function parseWrap(api: string, value: unknown): "repeat" | "clamp" {
  if (value === "repeat" || value === "clamp") return value;
  throw new ForgeError("MVM_E_MATERIAL_RANGE", `${api}: wrap must be repeat or clamp.`, { context: { api } });
}

function parseProperty(value: unknown): AnimProperty {
  if (value === "position" || value === "rotation" || value === "scale" || value === "quaternion") return value;
  throw new ForgeError(
    "MVM_E_ANIMATION_INVALID",
    'Track property must be "position", "rotation", "scale", or "quaternion".',
    { recoveryHint: "rotation is Euler degrees. quaternion is x,y,z,w." },
  );
}

function parseInterp(value: unknown): "linear" | "smooth" {
  const normalized = typeof value === "string" ? value.trim().toLowerCase() : value;
  if (normalized === "linear") return "linear";
  if (normalized === "smooth" || normalized === "cubic") return "smooth";
  throw new ForgeError("MVM_E_ANIMATION_INVALID", 'interpolation must be "linear", "smooth", or "cubic".', {
    recoveryHint: 'Use "linear" for constant-speed interpolation or "smooth"/"cubic" for smooth keyframe motion.',
  });
}

function pair(value: unknown, fallback: [number, number], api: string, name: string): [number, number] {
  if (value === undefined) return fallback;
  if (!Array.isArray(value) || value.length < 2) {
    throw new ForgeError("MVM_E_MATERIAL_RANGE", `${api}: ${name} must be [x, y].`, { context: { api, param: name } });
  }
  return [
    num(api, `${name}[0]`, value[0], fallback[0], -100, 100),
    num(api, `${name}[1]`, value[1], fallback[1], -100, 100),
  ];
}

function numArray(value: unknown, api: string, name: string): number[] {
  if (!Array.isArray(value)) {
    throw new ForgeError("MVM_E_GEOMETRY_CUSTOM_INVALID", `${api}: ${name} must be an array of numbers.`, {
      context: { api, param: name },
    });
  }
  return value.map((item, index) => {
    if (typeof item !== "number" || !Number.isFinite(item)) {
      throw new ForgeError("MVM_E_GEOMETRY_CUSTOM_INVALID", `${api}: ${name}[${index}] is not finite.`, {
        context: { api, param: name },
      });
    }
    return item;
  });
}

function indexArray(value: unknown, vertexCount: number): number[] {
  const raw = numArray(value, "mvm.geometry.custom", "indices");
  if (raw.length % 3 !== 0) {
    throw new ForgeError("MVM_E_GEOMETRY_CUSTOM_INVALID", "indices length must be a multiple of 3.", {
      recoveryHint: "Each triangle needs three indices.",
    });
  }
  for (const index of raw) {
    if (!Number.isInteger(index) || index < 0 || index >= vertexCount) {
      throw new ForgeError("MVM_E_GEOMETRY_CUSTOM_INVALID", `Index ${index} is outside 0..${vertexCount - 1}.`);
    }
  }
  return raw;
}

function vecArray(value: unknown, name: string, expected: number): number[] {
  const raw = numArray(value, "mvm.geometry.custom", name);
  if (raw.length !== expected) {
    throw new ForgeError("MVM_E_GEOMETRY_CUSTOM_INVALID", `${name} must have ${expected} numbers to match positions.`);
  }
  return raw;
}

function uvArray(value: unknown, vertexCount: number): number[] {
  const raw = numArray(value, "mvm.geometry.custom", "uvs");
  if (raw.length !== vertexCount * 2) {
    throw new ForgeError("MVM_E_GEOMETRY_CUSTOM_INVALID", `uvs must contain ${vertexCount * 2} numbers (u,v per vertex).`);
  }
  return raw;
}

async function blobToDataUrl(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  const size = 0x2000;
  for (let i = 0; i < bytes.length; i += size) {
    binary += String.fromCharCode(...bytes.subarray(i, i + size));
  }
  return `data:${blob.type || "image/png"};base64,${btoa(binary)}`;
}

// Keep the unused import reference honest for line mapping tests.
void PRELUDE_LINES;
