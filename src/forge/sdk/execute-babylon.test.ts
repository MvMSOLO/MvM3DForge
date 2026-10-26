import assert from "node:assert/strict";
import test from "node:test";
import * as BabylonCore from "@babylonjs/core";
import { LoadSceneAsync } from "@babylonjs/core/Loading/sceneLoader.js";
import "@babylonjs/core/Loading/Plugins/babylonFileLoader.js";
import { GLTF2Export } from "@babylonjs/serializers";
import { ensureBabylonLoaders, executeBabylonUserCode } from "./execute-babylon.ts";

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


test("native Babylon scene JSON survives serialize-and-load round trip", async () => {
  const result = await executeBabylonUserCode(`
    const orb = BABYLON.MeshBuilder.CreateSphere("Round Trip Orb", { diameter: 1.2, segments: 24 }, scene);
    const material = new BABYLON.PBRMaterial("Round Trip PBR", scene);
    material.albedoColor = BABYLON.Color3.FromHexString("#29a9c9");
    material.metallic = 0.6;
    material.roughness = 0.3;
    orb.material = material;
  `);
  assert.equal(result.ok, true, result.ok ? "" : result.error.message);
  if (!result.ok || !result.patch.nativeBabylonScene) return;

  const engine = new BabylonCore.NullEngine();
  let loadedScene: BabylonCore.Scene | null = null;
  try {
    await ensureBabylonLoaders();
    loadedScene = await LoadSceneAsync(
      `data:${JSON.stringify(result.patch.nativeBabylonScene)}`,
      engine,
      { pluginExtension: ".babylon" },
    );
    const orb = loadedScene.getMeshByName("Round Trip Orb");
    assert.ok(orb, "native scene loader restores the original mesh");
    assert.equal(orb?.material?.name, "Round Trip PBR");
  } finally {
    loadedScene?.dispose();
    engine.dispose();
  }
});

test("native Babylon exporter returns a real binary GLB container", async () => {
  const engine = new BabylonCore.NullEngine();
  const scene = new BabylonCore.Scene(engine);
  try {
    const mesh = BabylonCore.MeshBuilder.CreateBox("GLB Payload", { size: 1.25 }, scene);
    const material = new BabylonCore.PBRMaterial("GLB Material", scene);
    material.albedoColor = BabylonCore.Color3.FromHexString("#83f0ce");
    material.metallic = 0.72;
    material.roughness = 0.28;
    mesh.material = material;
    const data = await GLTF2Export.GLBAsync(scene, "mvm-native-test");
    const file = data.glTFFiles["mvm-native-test.glb"];
    assert.ok(file, "GLB exporter returns its binary file");
    assert.notEqual(typeof file, "string", "binary GLB must not be a textual glTF document");
    if (typeof file === "string") return;
    const bytes = new Uint8Array(await file.arrayBuffer());
    assert.ok(bytes.length > 20, "GLB has a binary payload");
    assert.equal(new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(0, true), 0x46546c67);
  } finally {
    scene.dispose();
    engine.dispose();
  }
});

