import assert from "node:assert/strict";
import test from "node:test";
import { toBabylonMaterialState } from "./scene-babylon.ts";
import type { MaterialSpec } from "./types.ts";

const material: MaterialSpec = {
  name: "Coated metal",
  color: "#abcdef",
  roughness: 0.27,
  metalness: 0.85,
  opacity: 0.93,
  emissive: "#102030",
  emissiveIntensity: 1.7,
  normalScale: 0.65,
  clearcoat: 0.8,
  clearcoatRoughness: 0.12,
  transmission: 0.25,
  ior: 1.45,
  thickness: 0.2,
  sheen: 0.5,
  sheenRoughness: 0.33,
  sheenColor: "#fedcba",
  alphaMode: "BLEND",
  alphaCutoff: 0.5,
  side: "double",
  mapId: "albedo",
  normalMapId: "normal",
  aoMapId: "ao",
  roughnessMapId: "roughness",
  metalnessMapId: "metalness",
  emissiveMapId: "emissive",
  clearcoatMapId: "coat",
  clearcoatRoughnessMapId: "coat-roughness",
  transmissionMapId: "transmission",
  thicknessMapId: "thickness",
  sheenColorMapId: "sheen",
  repeat: [2, 3],
  offset: [0.1, 0.2],
  rotation: 30,
  wrap: "repeat",
};

test("MVM BABYLON maps Forge PBR parameters and texture slots", () => {
  const state = toBabylonMaterialState(material, "material");

  assert.equal(state.color, "#abcdef");
  assert.equal(state.roughness, 0.27);
  assert.equal(state.metallic, 0.85);
  assert.equal(state.clearcoat, 0.8);
  assert.equal(state.clearcoatRoughness, 0.12);
  assert.equal(state.transmission, 0.25);
  assert.equal(state.ior, 1.45);
  assert.equal(state.thickness, 0.2);
  assert.equal(state.sheen, 0.5);
  assert.equal(state.normalScale, 0.65);
  assert.equal(state.textureIds.mapId, "albedo");
  assert.equal(state.textureIds.normalMapId, "normal");
  assert.equal(state.textureIds.roughnessMapId, "roughness");
  assert.equal(state.textureIds.transmissionMapId, "transmission");
  assert.equal(state.textureIds.thicknessMapId, "thickness");
});

test("solid and wireframe views do not accidentally apply PBR or texture maps", () => {
  for (const mode of ["solid", "wireframe"] as const) {
    const state = toBabylonMaterialState(material, mode);
    assert.equal(state.roughness, 0.84);
    assert.equal(state.metallic, 0);
    assert.equal(state.emissive, "#000000");
    assert.equal(state.emissiveIntensity, 0);
    assert.equal(state.clearcoat, 0);
    assert.equal(state.transmission, 0);
    assert.deepEqual(state.textureIds, {});
  }
});
