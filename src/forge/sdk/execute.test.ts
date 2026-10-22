import assert from "node:assert/strict";
import test from "node:test";
import { starters } from "../examples.ts";
import { executeUserCode } from "./execute.ts";

test("documented primitive sample builds named meshes", async () => {
  const sample = `
    const body = mvm.geometry.box({ width: 2, height: 3, depth: 1 });
    body.name = "Forge Body";
    body.material = mvm.material.pbr({ color: "#247BFF", roughness: 0.42, metalness: 0.15 });
    body.position.set(-1, 1.5, 0);
    mvm.scene.add(body);
    mvm.console.log("Body created", { name: body.name });
  `;
  const result = await executeUserCode(sample);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  const body = result.patch.objects.find((node) => node.name === "Forge Body");
  assert.ok(body);
  assert.equal(body?.geometry?.kind, "box");
  assert.deepEqual(body?.position, [-1, 1.5, 0]);
  assert.equal(body?.material?.color, "#247bff");
  assert.equal(result.logs[0]?.message.includes("Forge Body"), true);
});

test("invalid dimensions name the parameter", async () => {
  const result = await executeUserCode(`mvm.geometry.box({ width: -2 });`);
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.error.code, "MVM_E_GEOMETRY_DIMENSION_INVALID");
  assert.match(result.error.message, /width/);
});

test("syntax error reports a line", async () => {
  const result = await executeUserCode(`const = ;\n`);
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.error.code, "MVM_E_SYNTAX");
});

test("runtime error keeps a line number", async () => {
  const result = await executeUserCode(`const ok = 1;\nconst value = missingName;\n`);
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.error.line, 2);
});

test("every starter script runs", async () => {
  for (const starter of starters) {
    if (!starter.code.trim()) continue;
    const result = await executeUserCode(starter.code);
    assert.equal(result.ok, true, `${starter.id} failed: ${result.ok ? "" : result.error.message}`);
    if (!result.ok) continue;
    assert.ok(result.patch.objects.some((node) => node.type === "mesh"), starter.id);
  }
});

test("humanoid is a group of parts with feet near the ground", async () => {
  const result = await executeUserCode(`
    const hero = mvm.geometry.humanoid({ name: "Hero" });
    mvm.scene.add(hero);
  `);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  const feet = result.patch.objects.filter((node) => node.name.includes("Foot"));
  assert.equal(feet.length, 2);
  for (const foot of feet) {
    assert.ok(Math.abs(foot.position[1] - 0.045) < 0.02);
  }
});

test("animation.play marks the clip for viewport autoplay", async () => {
  const result = await executeUserCode(`
    const target = mvm.geometry.box({ width: 1, height: 1, depth: 1 });
    mvm.scene.add(target);
    const clip = mvm.animation.clip({ name: "Move", duration: 1, loop: true });
    mvm.animation.track(clip, {
      object: target,
      property: "position",
      keys: [
        { time: 0, value: [0, 0, 0] },
        { time: 1, value: [0, 1, 0] },
      ],
    });
    mvm.animation.play("Move");
  `);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.patch.autoplayClipId, result.patch.clips[0]?.id);
  assert.equal(result.patch.clips[0]?.name, "Move");
});

test("mixed Forge and native Three.js objects convert into Forge nodes and preserve animation targets", async () => {
  const result = await executeUserCode(`
    const root = new THREE.Group();
    root.name = "Pavilion_Structure";

    const baseGeo = mvm.geometry.box({ width: 12, height: 0.5, depth: 12 });
    const marbleMaterial = mvm.material.pbr({
      color: "#DFDCD6",
      roughness: 0.2,
      metalness: 0.1
    });
    const baseMesh = new THREE.Mesh(baseGeo, marbleMaterial);
    baseMesh.name = "Podium_Base";
    baseMesh.position.set(0, 0.25, 0);
    root.add(baseMesh);

    const coreGeo = mvm.geometry.torus({ radius: 0.8, tube: 0.15, radialSegments: 16, tubularSegments: 48 });
    const coreMaterial = mvm.material.pbr({
      color: "#00FFCC",
      emissive: "#00FFCC",
      emissiveIntensity: 2,
      roughness: 0.5,
      metalness: 0.2
    });
    const coreMesh = new THREE.Mesh(coreGeo, coreMaterial);
    coreMesh.name = "Kinetic_Core";
    coreMesh.position.set(0, 2.25, 0);
    root.add(coreMesh);

    // Direct BufferGeometry is supported too.
    const nativeMesh = new THREE.Mesh(
      new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshStandardMaterial({ color: "#247BFF", roughness: 0.4, metalness: 0.2 })
    );
    nativeMesh.name = "Native_Mesh";
    nativeMesh.position.set(2, 1, 0);
    root.add(nativeMesh);

    mvm.scene.add(root);
    const sun = new THREE.DirectionalLight(0xFFFAED, 0.8);
    sun.name = "Main_Sunlight";
    sun.position.set(8, 12, 6);
    scene.add(sun);

    const clip = mvm.animation.clip({ name: "Core_Spin", duration: 6, loop: true });
    mvm.animation.track(clip, {
      object: coreMesh,
      property: "rotation",
      interpolation: "Linear",
      keys: [
        { time: 0, value: [0, 0, 0] },
        { time: 3, value: [0, 180, 0] },
        { time: 6, value: [0, 360, 0] }
      ]
    });
    mvm.animation.track(clip, {
      object: coreMesh,
      property: "position",
      interpolation: "Cubic",
      keys: [
        { time: 0, value: [0, 2.25, 0] },
        { time: 1.5, value: [0, 2.45, 0] },
        { time: 3, value: [0, 2.25, 0] },
        { time: 4.5, value: [0, 2.05, 0] },
        { time: 6, value: [0, 2.25, 0] }
      ]
    });
    mvm.animation.play("Core_Spin");
  `);
  assert.equal(result.ok, true, result.ok ? "" : result.error.message);
  if (!result.ok) return;

  const meshes = result.patch.objects.filter((node) => node.type === "mesh");
  assert.equal(meshes.length, 3);
  const podium = result.patch.objects.find((node) => node.name === "Podium_Base");
  const core = result.patch.objects.find((node) => node.name === "Kinetic_Core");
  const native = result.patch.objects.find((node) => node.name === "Native_Mesh");
  assert.ok(podium);
  assert.ok(core);
  assert.ok(native);
  assert.equal(podium?.geometry?.kind, "box");
  assert.equal(podium?.material?.color, "#dfdcd6");
  assert.equal(core?.geometry?.kind, "torus");
  assert.equal(core?.material?.color, "#00ffcc");
  assert.equal(native?.geometry?.kind, "custom");
  assert.equal(result.patch.objects.some((node) => node.name === "Pavilion_Structure" && node.type === "group"), true);
  assert.equal(result.patch.objects.some((node) => node.name === "Main_Sunlight" && node.type === "light"), true);
  assert.equal(result.patch.clips[0]?.tracks.length, 2);
  assert.equal(result.patch.clips[0]?.tracks.every((track) => track.objectId === core?.id), true);
  assert.equal(result.patch.autoplayClipId, result.patch.clips[0]?.id);
  assert.match(result.logs.map((log) => log.message).join("\n"), /discovered [1-9]\d* scene objects and [1-9]\d* mesh objects/);
  assert.match(result.logs.map((log) => log.message).join("\n"), /converted 3 mesh objects into Forge nodes/);
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
