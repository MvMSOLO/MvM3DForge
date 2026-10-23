import assert from "node:assert/strict";
import test from "node:test";
import { applyScriptPatch, projectShell } from "./project.ts";
import { assembleScene, animationClips } from "./scene-three.ts";
import { executeUserCode } from "./sdk/execute.ts";

test("full-turn rotation tracks keep intermediate keyframes", async () => {
  const result = await executeUserCode(`
    const rotor = mvm.geometry.torus({ radius: 0.8, tube: 0.12 });
    rotor.name = "Full_Turn_Rotor";
    mvm.scene.add(rotor);
    const clip = mvm.animation.clip({ name: "Full_Turn", duration: 2, loop: true });
    mvm.animation.track(clip, {
      object: rotor,
      property: "rotation",
      keys: [
        { time: 0, value: [0, 0, 0] },
        { time: 2, value: [0, 360, 0] },
      ],
    });
    mvm.animation.play("Full_Turn");
  `);
  assert.equal(result.ok, true, result.ok ? "" : result.error.message);
  if (!result.ok) return;

  const project = applyScriptPatch(projectShell("Full Turn Regression"), result.patch);
  const built = await assembleScene(project, { mode: "material", shadows: false, onlyVisible: false });
  const [clip] = animationClips(project, built.byId);
  assert.ok(clip);
  assert.equal(clip.name, "Full_Turn");
  const spin = clip.tracks.find((track) => track.name.includes("Full_Turn_Rotor") && track.name.endsWith(".quaternion"));
  assert.ok(spin);
  assert.equal(spin.times.length, 5, "360° spin should be subdivided into 90° steps");
  assert.deepEqual(Array.from(spin.times), [0, 0.5, 1, 1.5, 2]);
  assert.ok(Math.abs(spin.values[5]) > 0.6, "90° intermediate key must differ from the starting orientation");
});
