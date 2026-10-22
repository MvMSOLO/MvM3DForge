import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { getOrCreateProject, saveProjectToStore } from "./mcp-server.ts";
import { defaultMaterial } from "./materials.ts";
import { makeNode } from "./nodes.ts";

describe("Remote MCP Server Protocol & Tools", () => {
  it("initializes default project and retrieves scene summary", () => {
    const proj = getOrCreateProject("test_proj_1");
    assert.equal(proj.id, "test_proj_1");
    assert.ok(proj.objects.length >= 1);
  });

  it("creates a new primitive mesh in the project", () => {
    const proj = getOrCreateProject("test_proj_2");
    const initialMeshCount = proj.objects.filter((o) => o.type === "mesh").length;

    const newMesh = makeNode({
      id: "mesh_sphere_1",
      name: "Test Sphere",
      type: "mesh",
      position: [1, 2, 3],
      geometry: { kind: "sphere", radius: 0.5, widthSegments: 16, heightSegments: 12 },
      material: defaultMaterial({ color: "#ff0000", roughness: 0.2 }),
    });

    proj.objects.push(newMesh);
    saveProjectToStore(proj);

    const updatedProj = getOrCreateProject("test_proj_2");
    assert.equal(updatedProj.objects.filter((o) => o.type === "mesh").length, initialMeshCount + 1);
    const found = updatedProj.objects.find((o) => o.id === "mesh_sphere_1");
    assert.ok(found);
    assert.deepEqual(found.position, [1, 2, 3]);
  });

  it("updates object transform and material properties", () => {
    const proj = getOrCreateProject("test_proj_3");
    const cube = proj.objects[0];
    assert.ok(cube);

    cube.position = [5, 5, 5];
    if (cube.material) cube.material.color = "#00ff00";
    saveProjectToStore(proj);

    const updatedProj = getOrCreateProject("test_proj_3");
    const updatedCube = updatedProj.objects[0];
    assert.deepEqual(updatedCube.position, [5, 5, 5]);
    assert.equal(updatedCube.material?.color, "#00ff00");
  });

  it("deletes an object from the project scene graph", () => {
    const proj = getOrCreateProject("test_proj_4");
    const targetId = proj.objects[0].id;

    proj.objects = proj.objects.filter((o) => o.id !== targetId);
    saveProjectToStore(proj);

    const updatedProj = getOrCreateProject("test_proj_4");
    assert.equal(updatedProj.objects.find((o) => o.id === targetId), undefined);
  });
});
