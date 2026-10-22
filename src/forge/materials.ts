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
    repeat: [1, 1],
    offset: [0, 0],
    rotation: 0,
    wrap: "repeat",
    ...partial,
  };
}
