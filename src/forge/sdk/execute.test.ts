import assert from "node:assert/strict";
import test from "node:test";
import { starters } from "../examples.ts";
import { applyScriptPatch } from "../project.ts";
import { projectShell } from "../nodes.ts";
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

test("PBR names and transparent flags survive normalization", async () => {
  const result = await executeUserCode(`
    const glass = mvm.material.pbr({
      name: "Tinted_Glass",
      color: "#336699",
      roughness: 0.1,
      metalness: 0.9,
      transparent: true,
      opacity: 0.4
    });
    const pane = mvm.geometry.box({ width: 2, height: 3, depth: 0.1, name: "Glass_Pane" });
    pane.material = glass;
    mvm.scene.add(pane);
  `);
  assert.equal(result.ok, true, result.ok ? "" : result.error.message);
  if (!result.ok) return;
  const pane = result.patch.objects.find((node) => node.name === "Glass_Pane");
  assert.equal(pane?.material?.name, "Tinted_Glass");
  assert.equal(pane?.material?.opacity, 0.4);
  assert.equal(pane?.material?.alphaMode, "BLEND");
  assert.equal(result.patch.sceneMutation, "replace");
});

test("materials-only runs are marked as non-mutating and preserve the current scene", async () => {
  const model = await executeUserCode(`
    const base = mvm.geometry.box({ width: 4, height: 0.5, depth: 4, name: "Existing_Base" });
    mvm.scene.add(base);
  `);
  assert.equal(model.ok, true, model.ok ? "" : model.error.message);
  if (!model.ok) return;

  const initial = applyScriptPatch(projectShell("Regression Scene"), model.patch);
  const materialOnly = await executeUserCode(`
    const marbleMaterial = mvm.material.pbr({
      name: "Base_Marble", color: "#DFDCD6", roughness: 0.2, metalness: 0.1
    });
    const pillarMaterial = mvm.material.pbr({
      name: "Brushed_Steel", color: "#444444", roughness: 0.4, metalness: 0.8
    });
    const glassMaterial = mvm.material.pbr({
      name: "Tinted_Glass", color: "#336699", roughness: 0.1, metalness: 0.9,
      transparent: true, opacity: 0.4
    });
    const emissiveCoreMaterial = mvm.material.pbr({
      name: "Kinetic_Core_Mat", color: "#00FFCC", emissive: "#00FFCC",
      emissiveIntensity: 2.0, roughness: 0.5, metalness: 0.2
    });
  `);
  assert.equal(materialOnly.ok, true, materialOnly.ok ? "" : materialOnly.error.message);
  if (!materialOnly.ok) return;
  assert.equal(materialOnly.patch.objects.length, 0);
  assert.equal(materialOnly.patch.sceneMutation, "none");
  assert.ok(materialOnly.logs.some((entry) => entry.level === "warn" && /material declarations.*do not create geometry/i.test(entry.message)));

  const next = applyScriptPatch(initial, materialOnly.patch);
  assert.deepEqual(next.objects.map((node) => node.id), initial.objects.map((node) => node.id));
  assert.deepEqual(next.clips.map((clip) => clip.id), initial.clips.map((clip) => clip.id));
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

test("imports native Three.js transform animation clips into editable Forge timeline tracks", async () => {
  const result = await executeUserCode(`
    const root = new THREE.Group();
    root.name = "Imported Animation Root";
    const part = new THREE.Mesh(
      new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshStandardMaterial({ color: "#35AEEF", roughness: 0.4 })
    );
    part.name = "Animated Part";
    root.add(part);
    scene.add(root);

    const positionTrack = new THREE.VectorKeyframeTrack(
      "Animated Part.position",
      new Float32Array([0, 1]),
      new Float32Array([0, 0, 0, 2, 0, 0])
    );
    const importedSource = new THREE.AnimationClip("Source Position Clip", 1, [positionTrack]);
    const imported = mvm.animation.importThreeClip(importedSource, root);
    mvm.animation.play(imported.id);
    console.log("Imported animation", imported);
  `);

  assert.equal(result.ok, true, result.ok ? "" : result.error.message);
  if (!result.ok) return;
  const clip = result.patch.clips.find((item) => item.name === "Source Position Clip");
  assert.ok(clip, "the source clip should be saved to the project timeline");
  assert.equal(clip?.source, "import");
  assert.equal(clip?.tracks.length, 1);
  const target = result.patch.objects.find((node) => node.name === "Animated Part");
  assert.ok(target, "the animation target should be converted to a Forge object");
  assert.equal(clip?.tracks[0]?.objectId, target?.id);
  assert.equal(clip?.tracks[0]?.property, "position");
  assert.deepEqual(clip?.tracks[0]?.keyframes, [
    { time: 0, value: [0, 0, 0] },
    { time: 1, value: [2, 0, 0] },
  ]);
  assert.equal(result.patch.autoplayClipId, clip?.id);
});

test("mixed Forge and native Three.js objects convert into Forge nodes and preserve animation targets", async () => {
  const result = await executeUserCode(`
    const root = new THREE.Group();
    root.name = "Pavilion_Structure";

    const baseGeo = mvm.geometry.box({ width: 12, height: 0.5, depth: 12 });
    const marbleMaterial = mvm.material.pbr({
      name: "Base_Marble",
      color: "#DFDCD6",
      roughness: 0.2,
      metalness: 0.1
    });
    const baseMesh = new THREE.Mesh(baseGeo, marbleMaterial);
    baseMesh.name = "Podium_Base";
    baseMesh.position.set(0, 0.25, 0);
    root.add(baseMesh);

    const pillarGeo = mvm.geometry.cylinder({
      radiusTop: 0.15, radiusBottom: 0.15, height: 4, radialSegments: 16
    });
    const pillarMaterial = mvm.material.pbr({
      name: "Brushed_Steel",
      color: "#444444", roughness: 0.4, metalness: 0.8
    });
    const pillarPositions = [
      [-4, 2.25, -4], [4, 2.25, -4], [-4, 2.25, 4], [4, 2.25, 4]
    ];
    pillarPositions.forEach((pos, index) => {
      const pillar = new THREE.Mesh(pillarGeo, pillarMaterial);
      pillar.name = "Support_Pillar_" + (index + 1);
      pillar.position.set(pos[0], pos[1], pos[2]);
      root.add(pillar);
    });

    const glassGeo = mvm.geometry.box({ width: 7.8, height: 3.8, depth: 0.1 });
    const glassMaterial = mvm.material.pbr({
      name: "Tinted_Glass",
      color: "#336699", roughness: 0.1, metalness: 0.9,
      transparent: true, opacity: 0.4
    });
    const glassPane = new THREE.Mesh(glassGeo, glassMaterial);
    glassPane.name = "Glass_Wall_Rear";
    glassPane.position.set(0, 2.15, -3.9);
    root.add(glassPane);

    const roofGeo = mvm.geometry.box({ width: 12.4, height: 0.4, depth: 12.4 });
    const roofMesh = new THREE.Mesh(roofGeo, marbleMaterial);
    roofMesh.name = "Roof_Canopy";
    roofMesh.position.set(0, 4.45, 0);
    root.add(roofMesh);

    const coreGeo = mvm.geometry.torus({ radius: 0.8, tube: 0.15, radialSegments: 16, tubularSegments: 48 });
    const coreMaterial = mvm.material.pbr({
      name: "Kinetic_Core_Mat",
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

    const nativeMesh = new THREE.Mesh(
      new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshStandardMaterial({ color: "#247BFF", roughness: 0.4, metalness: 0.2 })
    );
    nativeMesh.name = "Native_Mesh";
    nativeMesh.position.set(2, 1, 0);
    root.add(nativeMesh);

    mvm.scene.add(root);
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.4);
    ambientLight.name = "Ambient_Fill";
    scene.add(ambientLight);

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
  assert.equal(meshes.length, 9);
  const podium = result.patch.objects.find((node) => node.name === "Podium_Base");
  const core = result.patch.objects.find((node) => node.name === "Kinetic_Core");
  const native = result.patch.objects.find((node) => node.name === "Native_Mesh");
  const glass = result.patch.objects.find((node) => node.name === "Glass_Wall_Rear");
  const roof = result.patch.objects.find((node) => node.name === "Roof_Canopy");
  assert.ok(podium);
  assert.ok(core);
  assert.ok(native);
  assert.ok(glass);
  assert.ok(roof);
  for (let index = 1; index <= 4; index += 1) {
    assert.ok(result.patch.objects.some((node) => node.name === `Support_Pillar_${index}`));
  }
  assert.equal(podium?.geometry?.kind, "box");
  assert.equal(podium?.material?.color, "#dfdcd6");
  assert.equal(podium?.material?.name, "Base_Marble");
  assert.equal(core?.geometry?.kind, "torus");
  assert.equal(core?.material?.color, "#00ffcc");
  assert.equal(core?.material?.name, "Kinetic_Core_Mat");
  assert.equal(glass?.material?.name, "Tinted_Glass");
  assert.equal(glass?.material?.opacity, 0.4);
  assert.equal(glass?.material?.alphaMode, "BLEND");
  assert.equal(roof?.geometry?.kind, "box");
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
  const result = await executeUserCode(`
    const glass = mvm.material.pbr({
      name: "Physical_Glass",
      color: "#E8F4FF",
      roughness: 0.05,
      metalness: 0,
      transmission: 0.92,
      ior: 1.45,
      thickness: 0.2,
      clearcoat: 1,
      clearcoatRoughness: 0.08,
      sheen: 0.35,
      sheenRoughness: 0.4,
      sheenColor: "#CCDDEE",
      normalScale: 1.25,
      opacity: 1,
    });
    const pane = mvm.geometry.box({ width: 1, height: 1, depth: 0.08, name: "Physical_Pane" });
    pane.material = glass;
    mvm.scene.add(pane);
  `);
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
  const badTransmission = await executeUserCode(`
    mvm.material.pbr({ color: "#ffffff", transmission: 1.5 });
  `);
  assert.equal(badTransmission.ok, false);
  if (!badTransmission.ok) {
    assert.equal(badTransmission.error.code, "MVM_E_MATERIAL_RANGE");
    assert.match(badTransmission.error.message, /transmission/i);
  }

  const badIor = await executeUserCode(`
    mvm.material.pbr({ color: "#ffffff", ior: 0.5 });
  `);
  assert.equal(badIor.ok, false);
  if (!badIor.ok) {
    assert.match(badIor.error.message, /ior/i);
  }
});

test("runtime budget profile raises the actual object budget within hard ceilings", async () => {
  const result = await executeUserCode([
    'const budget = mvm.runtime.budget({ profile: "studio" });',
    'console.log(JSON.stringify(budget));',
    'for (let i = 0; i < 405; i += 1) {',
    '  const mesh = mvm.geometry.box({ name: "Budget_Mesh_" + i });',
    '  mvm.scene.add(mesh);',
    '}',
  ].join("\\n"));
  assert.equal(result.ok, true, result.ok ? "" : result.error.message);
  if (!result.ok) return;
  assert.equal(result.patch.objects.length, 405);
  assert.ok(result.logs.some((entry) => entry.message.includes('"maxObjects":800')));
  assert.ok(result.logs.some((entry) => entry.message.includes('"maxTextures":48')));
});

test("environment preset, custom HDR URL and exposure survive script normalization", async () => {
  const result = await executeUserCode([
    'mvm.scene.environment("sunset");',
    'mvm.scene.environmentMap("https://cdn.example.com/studio.hdr");',
    'mvm.scene.exposure(1.2);',
    'const mesh = mvm.geometry.box({ name: "Environment_Test" });',
    'mvm.scene.add(mesh);',
  ].join("\n"));
  assert.equal(result.ok, true, result.ok ? "" : result.error.message);
  if (!result.ok) return;
  assert.equal(result.patch.environment, "sunset");
  assert.equal(result.patch.environmentUrl, "https://cdn.example.com/studio.hdr");
  assert.equal(result.patch.exposure, 1.2);

  const clear = await executeUserCode('mvm.scene.environmentMap(null);');
  assert.equal(clear.ok, true, clear.ok ? "" : clear.error.message);
  if (!clear.ok) return;
  assert.equal(clear.patch.environmentUrl, null);
  const existingProject = projectShell("Clear custom environment", "");
  existingProject.scene.environmentUrl = "https://cdn.example.com/old.hdr";
  const clearedProject = applyScriptPatch(existingProject, clear.patch);
  assert.equal(clearedProject.scene.environmentUrl, null);
});

test("custom environment URL rejects unsupported protocols and file types", async () => {
  const http = await executeUserCode('mvm.scene.environmentMap("http://example.com/studio.hdr");');
  assert.equal(http.ok, false);
  if (!http.ok) assert.match(http.error.message, /HTTPS/i);
  const png = await executeUserCode('mvm.scene.environmentMap("https://example.com/studio.png");');
  assert.equal(png.ok, false);
  if (!png.ok) assert.match(png.error.message, /environment URL/i);
});

test("GLTF/OBJ and core asset loaders parse local assets while external loads stay blocked", async () => {
  const result = await executeUserCode(`
    return (async () => {
    const objLoader = new THREE.OBJLoader();
    const obj = objLoader.parse([
      "o Runtime_OBJ_Test",
      "v 0 0 0",
      "v 1 0 0",
      "v 0 1 0",
      "f 1 2 3"
    ].join("\n"));
    obj.name = "Parsed OBJ Root";
    scene.add(obj);

    const gltfLoader = new THREE.GLTFLoader();
    console.log("GLTF loader ready", Boolean(gltfLoader));

    const externalLoadErrors = await Promise.all([
      new THREE.GLTFLoader().loadAsync("https://example.com/model.glb").then(
        () => "unexpected-success",
        (error) => String(error?.message || error)
      ),
      new THREE.OBJLoader().loadAsync("https://example.com/model.obj").then(
        () => "unexpected-success",
        (error) => String(error?.message || error)
      ),
      new THREE.TextureLoader().loadAsync("https://example.com/image.png").then(
        () => "unexpected-success",
        (error) => String(error?.message || error)
      ),
      new THREE.FileLoader().loadAsync("https://example.com/private-data").then(
        () => "unexpected-success",
        (error) => String(error?.message || error)
      ),
      new THREE.ImageBitmapLoader().loadAsync("https://example.com/image.png").then(
        () => "unexpected-success",
        (error) => String(error?.message || error)
      ),
      new THREE.DataTextureLoader().loadAsync("https://example.com/data.bin").then(
        () => "unexpected-success",
        (error) => String(error?.message || error)
      ),
      new THREE.CompressedTextureLoader().loadAsync("https://example.com/texture.bin").then(
        () => "unexpected-success",
        (error) => String(error?.message || error)
      ),
      new THREE.AudioLoader().loadAsync("https://example.com/audio.ogg").then(
        () => "unexpected-success",
        (error) => String(error?.message || error)
      )
    ]);
    console.log("External-load guard", externalLoadErrors);
    })();
  `);

  assert.equal(result.ok, true, result.ok ? "" : result.error.message);
  if (!result.ok) return;
  assert.ok(result.patch.objects.some((node) => node.name === "Runtime_OBJ_Test" && node.type === "mesh"));
  assert.match(result.logs.map((entry) => entry.message).join("\n"), /GLTF loader ready true/);
  const log = result.logs.find((entry) => entry.message.includes("External-load guard"));
  assert.ok(log, "sandbox loader guard should be logged");
  assert.match(log.message, /External asset URLs are blocked|Sandbox loaders can only use data:/);
});

