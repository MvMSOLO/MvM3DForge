import assert from "node:assert/strict";
import test from "node:test";
import { exportProjectGlb } from "./export-glb.ts";
import { createStarterProject } from "./project.ts";

test("primitive lab exports a real GLB that re-imports", async () => {
  const { project } = await createStarterProject("primitives");
  const result = await exportProjectGlb(project, {
    filename: "primitives.glb",
    visibleOnly: true,
    includeAnimations: true,
  });
  const bytes = new Uint8Array(result.buffer);
  assert.equal(String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3]), "glTF");
  assert.ok(result.summary.bytes > 100);
  assert.ok(result.summary.meshes >= 4);
  assert.equal(result.summary.roundTripOk, true);
  assert.ok((result.summary.importedMeshes ?? 0) >= 4);
});

test("animated starter writes a clip into the GLB", async () => {
  const { project } = await createStarterProject("animated");
  const result = await exportProjectGlb(project, {
    filename: "sweep.glb",
    visibleOnly: true,
    includeAnimations: true,
  });
  assert.ok(result.summary.animations >= 1, JSON.stringify(result.summary));
  assert.ok((result.summary.importedAnimations ?? 0) >= 1);
});
