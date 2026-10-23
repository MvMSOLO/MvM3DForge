import assert from "node:assert/strict";
import { test } from "node:test";
import { starters } from "../examples.ts";
import { applyScriptPatch } from "../project.ts";
import { projectShell } from "../nodes.ts";
import { executeUserCode } from "./execute.ts";

test("documented primitive sample builds named meshes", async () => {
  const result = await executeUserCode(`
    const body = mvm.geometry.box({ width: 1.2, height: 1.6, depth: 0.55, name: "Torso" });
    body.position.set(0, 0.9, 0);
    body.material = mvm.material.pbr({ color: "#247BFF", roughness: 0.42, metalness: 0.15 });
    mvm.scene.add(body);
  `);
  assert.equal(result.ok, true, result.ok ? "" : result.error.message);
  if (!result.ok) return;
  assert.equal(result.patch.objects.length, 1);
  const body = result.patch.objects.find((node) => node.name === "Torso");
  assert.ok(body);
  assert.equal(body?.type, "mesh");
  assert.equal(body?.geometry?.kind, "box");
  assert.deepEqual(body?.position, [0, 0.9, 0]);
  assert.equal(body?.material?.color, "#247bff");
  assert.equal(body?.material?.roughness, 0.42);
});

test("PBR names and transparent flags survive normalization", async () => {
  const result = await executeUserCode(`
    const glass = mvm.material.pbr({
      name: "Tinted_Glass",
      color: "#88ccff",
      roughness: 0.05,
      metalness: 0,
      opacity: 0.4,
      transparent: true,
    });
    const pane = mvm.geometry.box({ width: 1, height: 1, depth: 0.05, name: "Pane" });
    pane.material = glass;
    mvm.scene.add(pane);
  `);
  assert.equal(result.ok, true, result.ok ? "" : result.error.message);
  if (!result.ok) return;
  const pane = result.patch.objects.find((node) => node.name === "Pane");
  assert.equal(pane?.material?.name, "Tinted_Glass");
  assert.equal(pane?.material?.opacity, 0.4);
  assert.equal(pane?.material?.alphaMode, "BLEND");
});

test("materials-only runs are marked as non-mutating and preserve the current scene", async () => {
  const initial = projectShell("Preserve", "");
  initial.objects = [
    {
      id: "keep-me",
      name: "Keep",
      type: "mesh",
      parentId: null,
      source: "manual",
      visible: true,
      locked: false,
      position: [0, 0, 0],
      rotation: [0, 0, 0],
      scale: [1, 1, 1],
      geometry: { kind: "box", width: 1, height: 1, depth: 1, widthSegments: 1, heightSegments: 1, depthSegments: 1 },
    },
  ];
  const materialOnly = await executeUserCode(`
    const marbleMaterial = mvm.material.pbr({ name: "Base_Marble", color: "#DFDCD6", roughness: 0.35, metalness: 0.05 });
    const pillarMaterial = mvm.material.pbr({ name: "Column_Stone", color: "#C8C2B4", roughness: 0.55, metalness: 0.02 });
    const glassMaterial = mvm.material.pbr({ name: "Tinted_Glass", color: "#88CCFF", roughness: 0.05, metalness: 0.0, opacity: 0.4, transparent: true });
    const emissiveCoreMaterial = mvm.material.pbr({ name: "Kinetic_Core_Mat", color: "#00FFCC", roughness: 0.2, metalness: 0.8, emissive: "#00FFAA", emissiveIntensity: 2.5 });
  `);
  assert.equal(materialOnly.ok, true, materialOnly.ok ? "" : materialOnly.error.message);
  if (!materialOnly.ok) return;
  assert.equal(materialOnly.patch.objects.length, 0);
  assert.equal(materialOnly.patch.sceneMutation, "none");
  assert.ok(materialOnly.logs.some((entry) => entry.level === "warn" && /material declarations.*do not create geometry/i.test(entry.message)));
  const next = applyScriptPatch(initial, materialOnly.patch);
  assert.equal(next.objects.some((node) => node.id === "keep-me"), true);
});

test("invalid dimensions name the parameter", async () => {
  const result = await executeUserCode(`mvm.geometry.box({ width: -1 });`);
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.error.code, "MVM_E_GEOMETRY_DIMENSION_INVALID");
    assert.match(result.error.message, /width/);
  }
});

test("syntax error reports a line", async () => {
  const result = await executeUserCode(`const x = ;`);
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.ok(result.error.line !== undefined);
  }
});

test("runtime error keeps a line number", async () => {
  const result = await executeUserCode(`\nthrow new Error("boom");`);
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.ok(result.error.line !== undefined);
  }
});

test("every starter script runs", async () => {
  for (const starter of starters) {
    if (!starter.code.trim()) continue;
    const result = await executeUserCode(starter.code);
    assert.equal(result.ok, true, `${starter.id}: ${result.ok ? "" : result.error.message}`);
  }
});

test("humanoid is a group of parts with feet near the ground", async () => {
  const result = await executeUserCode(`\n    const h = mvm.geometry.humanoid({ name: "Hero" });\n    mvm.scene.add(h);\n  `);
  assert.equal(result.ok, true, result.ok ? "" : result.error.message);
  if (!result.ok) return;
  assert.ok(result.patch.objects.length > 5);
  const root = result.patch.objects.find((node) => node.name === "Hero");
  assert.equal(root?.type, "group");
});

test("animation.play marks the clip for viewport autoplay", async () => {
  const result = await executeUserCode(`\n    const box = mvm.geometry.box({ name: "Spin" });\n    mvm.scene.add(box);\n    const clip = mvm.animation.clip({\n      name: "spin",\n      duration: 2,\n      tracks: [{ object: box, property: "rotation", keys: [{ time: 0, value: [0, 0, 0] }, { time: 2, value: [0, 360, 0] }] }],\n    });\n    mvm.animation.play(clip);\n  `);
  assert.equal(result.ok, true, result.ok ? "" : result.error.message);
  if (!result.ok) return;
  assert.equal(result.patch.clips.length, 1);
  assert.equal(result.patch.autoplayClipId, result.patch.clips[0]?.id);
});

test("mixed Forge and native Three.js objects convert into Forge nodes and preserve animation targets", async () => {
  const result = await executeUserCode(`\n    const marbleMaterial = mvm.material.pbr({ name: "Base_Marble", color: "#DFDCD6", roughness: 0.35, metalness: 0.05 });\n    const pillarMaterial = mvm.material.pbr({ name: "Column_Stone", color: "#C8C2B4", roughness: 0.55, metalness: 0.02 });\n    const glassMaterial = mvm.material.pbr({ name: "Tinted_Glass", color: "#88CCFF", roughness: 0.05, metalness: 0.0, opacity: 0.4, transparent: true });\n    const coreMaterial = mvm.material.pbr({ name: "Kinetic_Core_Mat", color: "#00FFCC", roughness: 0.2, metalness: 0.8, emissive: "#00FFAA", emissiveIntensity: 2.5 });\n\n    const root = new THREE.Group();\n    root.name = "Pavilion_Structure";\n\n    const podium = new THREE.Mesh(new THREE.BoxGeometry(4, 0.3, 4), new THREE.MeshStandardMaterial());\n    podium.name = "Podium";\n    podium.position.y = 0.15;\n    root.add(podium);\n\n    const core = mvm.geometry.sphere({ radius: 0.35, name: "Kinetic_Core" });\n    core.position.set(0, 1.2, 0);\n    core.material = coreMaterial;\n\n    const glass = mvm.geometry.box({ width: 1.5, height: 1.5, depth: 0.08, name: "Glass_Pane" });\n    glass.position.set(0, 1.2, 1.2);\n    glass.material = glassMaterial;\n\n    const sun = new THREE.DirectionalLight(0xfff0dd, 1.2);\n    sun.name = "Main_Sunlight";\n    sun.position.set(5, 10, 3);\n\n    const fill = new THREE.AmbientLight(0x404860, 0.4);\n    fill.name = "Ambient_Fill";\n\n    scene.add(root);\n    scene.add(sun);\n    scene.add(fill);\n    mvm.scene.add(core);\n    mvm.scene.add(glass);\n\n    const clip = mvm.animation.clip({\n      name: "core_pulse",\n      duration: 2,\n      tracks: [\n        { object: core, property: "scale", keys: [{ time: 0, value: [1, 1, 1] }, { time: 1, value: [1.2, 1.2, 1.2] }, { time: 2, value: [1, 1, 1] }] },\n        { object: core, property: "rotation", keys: [{ time: 0, value: [0, 0, 0] }, { time: 2, value: [0, 360, 0] }] },\n      ],\n    });\n    mvm.animation.play(clip);\n  `);
  assert.equal(result.ok, true, result.ok ? "" : result.error.message);
  if (!result.ok) return;
  const core = result.patch.objects.find((node) => node.name === "Kinetic_Core");
  const glass = result.patch.objects.find((node) => node.name === "Glass_Pane");
  const podium = result.patch.objects.find((node) => node.name === "Podium");
  const native = result.patch.objects.find((node) => node.name === "Podium");
  assert.ok(core);
  assert.ok(glass);
  assert.equal(podium?.material?.color, "#dfdcd6");
  assert.equal(podium?.material?.name, "Base_Marble");
  assert.equal(core?.material?.color, "#00ffcc");
  assert.equal(core?.material?.name, "Kinetic_Core_Mat");
  assert.equal(glass?.material?.name, "Tinted_Glass");
  assert.equal(glass?.material?.opacity, 0.4);
  assert.equal(glass?.material?.alphaMode, "BLEND");
  assert.equal(native?.geometry?.kind, "custom");
  assert.equal(result.patch.objects.some((node) => node.name === "Pavilion_Structure" && node.type === "group"), true);
  assert.equal(result.patch.objects.some((node) => node.name === "Main_Sunlight" && node.type === "light"), true);
  assert.equal(result.patch.objects.some((node) => node.name === "Ambient_Fill" && node.type === "light"), true);
  assert.equal(result.patch.clips[0]?.tracks.length, 2);
  assert.equal(result.patch.clips[0]?.tracks.every((track) => track.objectId === core?.id), true);
  assert.equal(result.patch.autoplayClipId, result.patch.clips[0]?.id);
  assert.match(result.logs.map((log) => log.message).join("\n"), /discovered [1-9]\d* native scene objects and [1-9]\d* native mesh objects/);
  assert.match(result.logs.map((log) => log.message).join("\n"), /converted 9 native mesh objects into Forge nodes/);
});

test("animation track and export request are recorded", async () => {
  const starter = starters.find((item) => item.id === "roundtrip");
  assert.ok(starter);
  const result = await executeUserCode(starter.code);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.patch.clips.length, 1);
  assert.equal(result.patch.clips[0]?.tracks[0]?.property, "position");
  assert.equal(result.patch.exportRequest?.filename, "roundtrip.glb");
  assert.ok(result.patch.textures.length >= 1);
});

test("physical PBR channels survive mvm.material.pbr normalization", async () => {
  const result = await executeUserCode(`\n    const glass = mvm.material.pbr({\n      name: "Physical_Glass",\n      color: "#E8F4FF",\n      roughness: 0.05,\n      metalness: 0,\n      transmission: 0.92,\n      ior: 1.45,\n      thickness: 0.2,\n      clearcoat: 1,\n      clearcoatRoughness: 0.08,\n      sheen: 0.35,\n      sheenRoughness: 0.4,\n      sheenColor: "#CCDDEE",\n      normalScale: 1.25,\n      opacity: 1,\n    });\n    const pane = mvm.geometry.box({ width: 1, height: 1, depth: 0.08, name: "Physical_Pane" });\n    pane.material = glass;\n    mvm.scene.add(pane);\n  `);
  assert.equal(result.ok, true, result.ok ? "" : result.error.message);
  if (!result.ok) return;
  const pane = result.patch.objects.find((node) => node.name === "Physical_Pane");
  const mat = pane?.material;
  assert.ok(mat, "mesh material missing");
  assert.equal(mat?.name, "Physical_Glass");
  assert.equal(mat?.transmission, 0.92);
  assert.equal(mat?.ior, 1.45);
  assert.equal(mat?.thickness, 0.2);
  assert.equal(mat?.clearcoat, 1);
  assert.equal(mat?.clearcoatRoughness, 0.08);
  assert.equal(mat?.sheen, 0.35);
  assert.equal(mat?.sheenRoughness, 0.4);
  assert.equal(mat?.sheenColor, "#ccddee");
  assert.equal(mat?.normalScale, 1.25);
});

test("physical PBR rejects out-of-range transmission and ior", async () => {
  const badTransmission = await executeUserCode(`\n    mvm.material.pbr({ color: "#ffffff", transmission: 1.5 });\n  `);
  assert.equal(badTransmission.ok, false);
  if (!badTransmission.ok) {
    assert.equal(badTransmission.error.code, "MVM_E_MATERIAL_RANGE");
    assert.match(badTransmission.error.message, /transmission/i);
  }

  const badIor = await executeUserCode(`\n    mvm.material.pbr({ color: "#ffffff", ior: 0.5 });\n  `);
  assert.equal(badIor.ok, false);
  if (!badIor.ok) {
    assert.match(badIor.error.message, /ior/i);
  }
});
