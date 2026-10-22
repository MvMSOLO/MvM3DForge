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
