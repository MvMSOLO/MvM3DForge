import assert from "node:assert/strict";
import test from "node:test";
import { executeBabylonUserCode } from "./execute-babylon.ts";

test("native Babylon runtime executes Babylon MeshBuilder and PBRMaterial APIs", async () => {
  const result = await executeBabylonUserCode(`
    const shell = BABYLON.MeshBuilder.CreateSphere("Native Titan Shell", { diameter: 1.8, segments: 48 }, scene);
    const metal = new BABYLON.PBRMaterial("Native Titanium", scene);
    metal.albedoColor = BABYLON.Color3.FromHexString("#65879b");
    metal.metallic = 0.86;
    metal.roughness = 0.22;
    metal.clearCoat.isEnabled = true;
    metal.clearCoat.intensity = 0.4;
    shell.material = metal;
    shell.position.y = 0.9;
    console.log("Native Babylon API executed", shell.getClassName(), engine.constructor.name);
  `);

  assert.equal(result.ok, true, result.ok ? "" : result.error.message);
  if (!result.ok) return;

  assert.equal(result.patch.engine, "babylon");
  assert.equal(result.patch.sceneMutation, "replace");
  assert.ok(result.patch.nativeBabylonScene);
  assert.ok(Array.isArray(result.patch.objects));
  const shell = result.patch.objects.find((node) => node.name === "Native Titan Shell");
  assert.ok(shell, "native Babylon mesh should be projected into the inspector summary");
  assert.equal(shell?.geometry?.kind, "custom");
  assert.equal(shell?.material?.metalness, 0.86);
  assert.equal(shell?.material?.clearcoat, 0.4);
  assert.ok(result.patch.nativeBabylonScene);
  const serialized = result.patch.nativeBabylonScene as { meshes?: Array<{ name?: string }> };
  assert.ok(serialized.meshes?.some((mesh) => mesh.name === "Native Titan Shell"));
  assert.ok(result.logs.some((entry) => entry.message.includes("Native Babylon API executed")));
});

test("native Babylon runtime returns an actionable error for invalid JavaScript", async () => {
  const result = await executeBabylonUserCode("const = ;");
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.ok(result.error.message.length > 0);
  assert.ok(result.issues.length > 0);
});

test("native Babylon execution rejects a scene with no exportable meshes", async () => {
  const result = await executeBabylonUserCode(`
    const light = new BABYLON.HemisphericLight("Only Light", new BABYLON.Vector3(0, 1, 0), scene);
    light.intensity = 0.7;
  `);
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.error.code, "MVM_E_EXPORT_EMPTY");
});
