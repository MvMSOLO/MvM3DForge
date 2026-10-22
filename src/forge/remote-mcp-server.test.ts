import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createPersistedMcpServer, type McpProjectRepository } from "./remote-mcp-server.ts";
import { projectShell } from "./nodes.ts";
import type { Project } from "./types.ts";

class MemoryProjectRepository implements McpProjectRepository {
  readonly projects = new Map<string, Project>();

  async list(userId: string) {
    return [...this.projects.values()]
      .filter((project) => project.author === userId)
      .map((project) => ({ id: project.id, name: project.name, updatedAt: project.updatedAt }));
  }

  async load(userId: string, projectId: string) {
    const project = this.projects.get(projectId);
    return project && project.author === userId ? structuredClone(project) : null;
  }

  async save(userId: string, project: Project) {
    const existing = this.projects.get(project.id);
    if (existing && existing.author !== userId) {
      throw new Error("Project ownership conflict.");
    }
    if (project.author !== userId) {
      throw new Error("Project owner must match the authenticated user.");
    }
    const saved = structuredClone({ ...project, updatedAt: Date.now() });
    this.projects.set(saved.id, saved);
    return structuredClone(saved);
  }
}

async function connectClient(userId = "user-a", scopes = ["project:read", "scene:write", "assets:export"], repository = new MemoryProjectRepository()) {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const server = createPersistedMcpServer({ userId, scopes }, repository);
  const client = new Client({ name: "mvm-mcp-test-client", version: "1.0.0" });
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  return { client, server, repository, close: async () => {
    await client.close();
    await server.close();
  }};
}

function textPayload(result: any): any {
  const content = result.content.find((item: { type: string; text?: string }) => item.type === "text" && typeof item.text === "string");
  assert.ok(content?.text, "expected a text MCP result");
  return JSON.parse(content.text);
}

describe("Remote MCP server end-to-end tool registry", () => {
  it("registers all 12 documented tools through the official MCP client", async () => {
    const session = await connectClient();
    try {
      const result = await session.client.listTools();
      const names = result.tools.map((tool) => tool.name).sort();
      assert.equal(names.length, 12);
      assert.deepEqual(names, [
        "create_light",
        "create_material",
        "create_primitive",
        "create_project",
        "delete_object",
        "export_project_glb",
        "get_project",
        "inspect_object",
        "list_projects",
        "read_scene",
        "rename_project",
        "update_object",
      ]);
    } finally {
      await session.close();
    }
  });

  it("runs project, scene, object, material and light mutations through the MCP client", async () => {
    const session = await connectClient();
    try {
      assert.deepEqual(textPayload(await session.client.callTool({ name: "list_projects", arguments: {} })).projects, []);

      const created = textPayload(await session.client.callTool({
        name: "create_project",
        arguments: { name: "MCP Integration Test", starterId: "blank" },
      }));
      assert.ok(created.projectId);

      const projectResult = textPayload(await session.client.callTool({
        name: "get_project",
        arguments: { projectId: created.projectId },
      }));
      assert.equal(projectResult.project.name, "MCP Integration Test");

      const renamed = textPayload(await session.client.callTool({
        name: "rename_project",
        arguments: { projectId: created.projectId, newName: "Persisted Scene" },
      }));
      assert.equal(renamed.name, "Persisted Scene");

      const meshResult = textPayload(await session.client.callTool({
        name: "create_primitive",
        arguments: { projectId: created.projectId, kind: "sphere", name: "Test Sphere", color: "#ff3300", position: [1, 2, 3] },
      }));
      const objectId = meshResult.createdObject.id;
      assert.ok(objectId);

      const inspected = textPayload(await session.client.callTool({
        name: "inspect_object",
        arguments: { projectId: created.projectId, objectId },
      }));
      assert.deepEqual(inspected.object.position, [1, 2, 3]);

      await session.client.callTool({
        name: "update_object",
        arguments: { projectId: created.projectId, objectId, position: [4, 5, 6], visible: false },
      });

      await session.client.callTool({
        name: "create_material",
        arguments: { projectId: created.projectId, objectId, color: "#123abc", roughness: 0.2, metalness: 0.8 },
      });

      const lightResult = textPayload(await session.client.callTool({
        name: "create_light",
        arguments: { projectId: created.projectId, kind: "point", color: "#ffffff", intensity: 2 },
      }));
      assert.ok(lightResult.createdLight.id);

      const scene = textPayload(await session.client.callTool({
        name: "read_scene",
        arguments: { projectId: created.projectId },
      }));
      const updated = scene.objects.find((object: { id: string }) => object.id === objectId);
      assert.deepEqual(updated.position, [4, 5, 6]);
      assert.equal(updated.visible, false);
      assert.equal(updated.material.color, "#123abc");
      assert.ok(scene.objects.some((object: { type: string }) => object.type === "light"));

      const deleteResult = textPayload(await session.client.callTool({
        name: "delete_object",
        arguments: { projectId: created.projectId, objectId },
      }));
      assert.equal(deleteResult.deletedObjectId, objectId);

      const listed = textPayload(await session.client.callTool({ name: "list_projects", arguments: {} }));
      assert.equal(listed.projects.length, 1);
      assert.equal(listed.projects[0].name, "Persisted Scene");

      // A second client/server request against the same repository sees saved changes.
      const reconnected = await connectClient("user-a", ["project:read", "scene:write", "assets:export"], session.repository);
      try {
        const reloaded = textPayload(await reconnected.client.callTool({
          name: "read_scene",
          arguments: { projectId: created.projectId },
        }));
        assert.equal(reloaded.objects.some((object: { id: string }) => object.id === objectId), false);
        assert.ok(reloaded.objects.some((object: { type: string }) => object.type === "light"));
      } finally {
        await reconnected.close();
      }
    } finally {
      await session.close();
    }
  });

  it("returns a real binary GLB resource, not just length metadata", async () => {
    const session = await connectClient();
    try {
      const created = textPayload(await session.client.callTool({
        name: "create_project",
        arguments: { name: "GLB Export Test", starterId: "blank" },
      }));
      await session.client.callTool({
        name: "create_primitive",
        arguments: { projectId: created.projectId, kind: "box", name: "Export Box" },
      });

      const result: any = await session.client.callTool({
        name: "export_project_glb",
        arguments: { projectId: created.projectId },
      });
      assert.equal(result.isError, undefined);
      const resourceContent = result.content.find((item: { type: string }) => item.type === "resource") as any;
      assert.equal(resourceContent?.resource?.mimeType, "model/gltf-binary");
      assert.ok(typeof resourceContent?.resource?.blob === "string");
      const bytes = Buffer.from(resourceContent.resource.blob, "base64");
      assert.ok(bytes.length > 20);
      assert.equal(bytes.subarray(0, 4).toString("ascii"), "glTF");
    } finally {
      await session.close();
    }
  });

  it("enforces per-tool scopes before mutation", async () => {
    const session = await connectClient("reader", ["project:read"]);
    try {
      const result: any = await session.client.callTool({
        name: "create_project",
        arguments: { name: "Should Not Exist" },
      });
      assert.equal(result.isError, true);
      assert.match(result.content.map((item: { type: string; text?: string }) => item.type === "text" ? item.text : "").join(" "), /scene:write/);
      assert.deepEqual(await session.repository.list("reader"), []);
    } finally {
      await session.close();
    }
  });

  it("cannot list or retrieve another user's project", async () => {
    const repository = new MemoryProjectRepository();
    const foreign = { ...projectShell("Private Bob Scene"), id: "private-bob-project", author: "user-b" };
    repository.projects.set(foreign.id, foreign);
    const session = await connectClient("user-a", ["project:read", "scene:write"], repository);
    try {
      const listed = textPayload(await session.client.callTool({ name: "list_projects", arguments: {} }));
      assert.deepEqual(listed.projects, []);
      const result: any = await session.client.callTool({
        name: "get_project",
        arguments: { projectId: "private-bob-project" },
      });
      assert.equal(result.isError, true);
      assert.match(result.content.map((item: { type: string; text?: string }) => item.type === "text" ? item.text : "").join(" "), /access denied/);
    } finally {
      await session.close();
    }
  });
});
