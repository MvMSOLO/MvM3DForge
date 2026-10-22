import { API_VERSION, SCHEMA_VERSION, brand } from "./brand.ts";
import { computeMeshStats } from "./geometry-build.ts";
import { defaultMaterial } from "./materials.ts";
import type {
  CameraState,
  GeometrySpec,
  LightSpec,
  MaterialSpec,
  SceneNode,
  SceneSettings,
  Vec3,
} from "./types.ts";

export function uid(): string {
  return crypto.randomUUID();
}

export function defaultCamera(): CameraState {
  return {
    type: "perspective",
    fov: 42,
    near: 0.05,
    far: 400,
    position: [4.4, 2.5, 6.4],
    target: [0, 0.75, 0],
    orthoSize: 4,
  };
}

export function defaultSceneSettings(): SceneSettings {
  return {
    background: "#10161E",
    grid: true,
    axes: true,
    shadows: true,
    environment: "studio",
    exposure: 1,
    camera: defaultCamera(),
  };
}

export function makeNode(
  partial: Partial<SceneNode> & { name: string; type: SceneNode["type"] },
): SceneNode {
  const node: SceneNode = {
    id: partial.id ?? uid(),
    name: partial.name.slice(0, 120),
    type: partial.type,
    parentId: partial.parentId ?? null,
    source: partial.source ?? "manual",
    visible: partial.visible ?? true,
    locked: partial.locked ?? false,
    position: partial.position ?? [0, 0, 0],
    rotation: partial.rotation ?? [0, 0, 0],
    scale: partial.scale ?? [1, 1, 1],
    geometry: partial.geometry,
    material: partial.material,
    light: partial.light,
    scriptDirty: partial.scriptDirty,
  };
  if (node.geometry) node.stats = computeMeshStats(node.geometry);
  return node;
}

export function withGeometry(node: SceneNode, geometry: GeometrySpec): SceneNode {
  return { ...node, geometry, stats: computeMeshStats(geometry) };
}

export function editorRig(): SceneNode[] {
  const fill = makeNode({
    id: "editor-fill",
    name: "Studio Fill",
    type: "light",
    source: "editor",
    position: [0, 2, 0],
    light: {
      kind: "hemisphere",
      color: "#F4F7FB",
      groundColor: "#243140",
      intensity: 0.62,
    },
  });
  const key = makeNode({
    id: "editor-key",
    name: "Studio Key",
    type: "light",
    source: "editor",
    position: [5.2, 8.4, 3.6],
    light: {
      kind: "directional",
      color: "#FFF6EC",
      intensity: 2.35,
      castShadow: true,
      target: [0, 0.6, 0],
    },
  });
  return [fill, key];
}

export function vecFinite(v: Vec3): boolean {
  return v.every((n) => typeof n === "number" && Number.isFinite(n));
}

export function cloneVec(v: Vec3): Vec3 {
  return [v[0], v[1], v[2]];
}

export function materialOf(node: SceneNode): MaterialSpec {
  return node.material ?? defaultMaterial();
}

export function lightOf(node: SceneNode): LightSpec | undefined {
  return node.light;
}

export const blankCode = `// JavaScript — MVM SDK ${API_VERSION}. Rotation is degrees. Units are metres, Y-up.
const body = mvm.geometry.box({ width: 1.4, height: 0.45, depth: 0.7 });
body.name = "Forge Body";
body.position.set(0, 0.55, 0);
body.material = mvm.material.pbr({
  color: "#43C8F5",
  roughness: 0.38,
  metalness: 0.22,
});
mvm.scene.add(body);
mvm.console.log("Body created", { name: body.name });
`;

export function projectShell(name: string, code = blankCode) {
  const now = Date.now();
  return {
    id: uid(),
    name,
    schemaVersion: SCHEMA_VERSION,
    apiVersion: API_VERSION,
    appVersion: brand.version,
    createdAt: now,
    updatedAt: now,
    code,
    codeLanguage: "javascript" as const,
    author: "",
    objects: editorRig(),
    textures: [],
    clips: [],
    scene: defaultSceneSettings(),
    description: "",
  };
}
