import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  buildMCPSceneResource,
  validateMCPToolExecution,
  type MCPConnectionConfig,
} from "./ai-mcp.ts";
import { createStarterProject } from "./project.ts";

describe("AI Provider Architecture & MCP Integration", () => {
  it("builds a JSON scene resource for MCP clients", async () => {
    const { project } = await createStarterProject("primitives");
    const jsonStr = buildMCPSceneResource(project);
    const parsed = JSON.parse(jsonStr) as Record<string, unknown>;

    assert.equal(parsed.projectId, project.id);
    assert.equal(parsed.projectName, project.name);
    assert.equal(parsed.objectsCount, project.objects.length);
    assert.ok(Array.isArray(parsed.meshes));
  });

  it("enforces MCP tool execution permissions correctly", () => {
    const permissions: MCPConnectionConfig["permissions"] = {
      readScene: true,
      mutateScene: false,
      executeScript: false,
    };

    const readCheck = validateMCPToolExecution("read_scene", {}, permissions);
    assert.equal(readCheck.allowed, true);

    const mutateCheck = validateMCPToolExecution("create_primitive", {}, permissions);
    assert.equal(mutateCheck.allowed, false);
    assert.match(mutateCheck.reason || "", /mutateScene is disabled/);

    const execCheck = validateMCPToolExecution("execute_script", {}, permissions);
    assert.equal(execCheck.allowed, false);
    assert.match(execCheck.reason || "", /executeScript is disabled/);
  });
});
