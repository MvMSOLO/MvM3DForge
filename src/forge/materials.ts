import type { MaterialSpec } from "./types.ts";

export function defaultMaterial(partial?: Partial<MaterialSpec>): MaterialSpec {
  return {
    color: "#C5D0DB",
    roughness: 0.55,
    metalness: 0.08,
    opacity: 1,
    emissive: "#000000",
    emissiveIntensity: 1,
    alphaMode: "OPAQUE",
    alphaCutoff: 0.5,
    side: "front",
    mapId: null,
    normalMapId: null,
    aoMapId: null,
    roughnessMapId: null,
    metalnessMapId: null,
    emissiveMapId: null,
    clearcoatMapId: null,
    clearcoatRoughnessMapId: null,
    transmissionMapId: null,
    thicknessMapId: null,
    sheenColorMapId: null,
    clearcoat: 0,
    clearcoatRoughness: 0,
    transmission: 0,
    ior: 1.5,
    thickness: 0,
    sheen: 0,
    sheenRoughness: 0.5,
    sheenColor: "#ffffff",
    normalScale: 1,
    repeat: [1, 1],
    offset: [0, 0],
    rotation: 0,
    wrap: "repeat",
    ...partial,
  };
}

/** Fill missing physical / map fields on older project materials (schema v1 compatible). */
export function coerceMaterial(input: Partial<MaterialSpec> | null | undefined): MaterialSpec {
  return defaultMaterial(input ?? undefined);
}
