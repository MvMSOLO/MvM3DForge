import assert from "node:assert/strict";
import test from "node:test";
import {
  MAX_NATIVE_BABYLON_MESHES,
  MAX_NATIVE_BABYLON_SCENE_CHARS,
  validateNativeBabylonScene,
} from "./native-babylon-validation.ts";

test("server accepts a compact serialized Babylon scene with meshes", () => {
  assert.equal(
    validateNativeBabylonScene({ meshes: [{ name: "Shell" }], materials: [], cameras: [] }),
    null,
  );
});

test("server rejects absent, malformed, or empty native Babylon scene payloads", () => {
  assert.match(validateNativeBabylonScene(null) ?? "", /missing its serialized scene object/i);
  assert.match(validateNativeBabylonScene([]) ?? "", /missing its serialized scene object/i);
  assert.match(validateNativeBabylonScene({ materials: [] }) ?? "", /missing its meshes array/i);
  assert.match(validateNativeBabylonScene({ meshes: [] }) ?? "", /at least one mesh/i);
  assert.match(validateNativeBabylonScene({ meshes: [null] }) ?? "", /invalid mesh record/i);
});

test("server enforces the native scene JSON transfer limit", () => {
  const oversized = { meshes: [{ name: "Shell" }], notes: "x".repeat(MAX_NATIVE_BABYLON_SCENE_CHARS) };
  assert.match(validateNativeBabylonScene(oversized) ?? "", /character server limit/i);
});

test("server enforces the mesh count ceiling", () => {
  const meshes = Array.from({ length: MAX_NATIVE_BABYLON_MESHES + 1 }, (_, index) => ({ name: `mesh-${index}` }));
  assert.match(validateNativeBabylonScene({ meshes }) ?? "", /mesh server limit/i);
});
