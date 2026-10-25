import { randomUUID } from "node:crypto";
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createPersistedMcpServer, type McpProjectRepository } from "./remote-mcp-server.ts";
import type { EnqueueMcpExecutionJobInput, McpExecutionJob, McpExecutionQueue } from "../lib/mcp/execution-jobs.server.ts";
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

class MemoryExecutionQueue implements McpExecutionQueue {
  readonly jobs = new Map<string, McpExecutionJob>();
  async enqueue(input: EnqueueMcpExecutionJobInput): Promise<McpExecutionJob> {
    const now = Date.now();
    const job: McpExecutionJob = {
      id: randomUUID(), userId: input.userId, projectId: input.projectId,
      kind: input.kind, code: input.code, applyChanges: input.applyChanges,
      baseUpdatedAt: input.baseUpdatedAt, status: "queued", result: null,
      screenshotDataUrl: null, error: null, createdAt: now, updatedAt: now,
      claimedAt: null, completedAt: null,
    };
    this.jobs.set(job.id, structuredClone(job));
    return structuredClone(job);
  }
  async get(userId: string, jobId: string): Promise<McpExecutionJob | null> {
    const job = this.jobs.get(jobId);
    return job?.userId === userId ? structuredClone(job) : null;
  }
}
async function connectClient(
  userId = "user-a",
  scopes = ["project:read", "scene:write", "scene:execute", "assets:export"],
  repository = new MemoryProjectRepository(),
  executionQueue: McpExecutionQueue = new MemoryExecutionQueue(),
) {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const server = createPersistedMcpServer({ userId, scopes }, repository, executionQueue);
  const client = new Client({ name: "mvm-mcp-test-client", version: "1.0.0" });
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  return { client, server, repository, executionQueue, close: async () => {
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
  it("registers the documented scene and AI execution tools through the official MCP client", async () => {
    const session = await connectClient();
    try {
      const result = await session.client.listTools();
      const names = result.tools.map((tool) => tool.name).sort();
      assert.equal(names.length, 19);
      assert.deepEqual(names, [
        "create_3d_from_image",
        "create_light",
        "create_material",
        "create_primitive",
        "create_project",
        "delete_object",
        "diagnose_project",
        "export_project_glb",
        "get_ai_workflow",
        "get_execution_job",
        "get_project",
        "get_reference_image",
        "inspect_object",
        "list_projects",
        "read_scene",
        "rename_project",
        "render_project",
        "run_script",
        "update_object",
      ]);
      const visualTool = result.tools.find((tool) => tool.name === "get_execution_job") as any;
      assert.equal(visualTool?._meta?.ui?.resourceUri, "ui://mvm3d/viewport.html");
      const appResource = await session.client.readResource({ uri: "ui://mvm3d/viewport.html" });
      assert.equal(appResource.contents[0]?.mimeType, "text/html;profile=mcp-app");
      assert.match(appResource.contents[0]?.text ?? "", /MVM 3D/);
      assert.ok((appResource.contents[0]?.text ?? "").includes("ui/notifications/tool-result"));
    } finally {
      await session.close();
    }
  });

  it("returns real image content to a vision-capable MCP client and queues image-to-3D code", async () => {
    const session = await connectClient();
    try {
      const created = textPayload(await session.client.callTool({
        name: "create_project",
        arguments: { name: "Image-to-3D Test", starterId: "blank" },
      }));
      const project = await session.repository.load("user-a", created.projectId);
      assert.ok(project);
      project.textures.push({
        id: "reference-image-test",
        name: "Reference Test",
        source: "user",
        colorSpace: "srgb",
        width: 2,
        height: 2,
        dataUrl: "data:image/png;base64,aGVsbG8=",
      });
      await session.repository.save("user-a", project);

      const imageResult = await session.client.callTool({
        name: "get_reference_image",
        arguments: { projectId: created.projectId },
      });
      const image = imageResult.content.find((item: any) => item.type === "image") as any;
      assert.ok(image, "expected an MCP image content block");
      assert.equal(image.mimeType, "image/png");
      assert.equal(image.data, "aGVsbG8=");

      const queued = textPayload(await session.client.callTool({
        name: "create_3d_from_image",
        arguments: {
          projectId: created.projectId,
          imageAnalysis: "A simple red product bottle with a cylindrical body and rounded shoulder.",
          code: "const bottle = mvm.geometry.cylinder({ radiusTop: 0.28, radiusBottom: 0.32, height: 1.2 }); mvm.scene.add(bottle);",
          mode: "preview",
        },
      }));
      assert.ok(queued.jobId);
      assert.equal(queued.needsOpenStudioTab, true);
      assert.equal(queued.nextTool, "get_execution_job");
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

  it("queues browser script jobs and enforces apply scope", async () => {
    const repository = new MemoryProjectRepository();
    const executionQueue = new MemoryExecutionQueue();
    const session = await connectClient("user-a", undefined, repository, executionQueue);
    try {
      const created = textPayload(await session.client.callTool({ name: "create_project", arguments: { name: "AI Workflow Scene", starterId: "blank" } }));
      const diagnosed = textPayload(await session.client.callTool({ name: "diagnose_project", arguments: { projectId: created.projectId } }));
      assert.equal(diagnosed.projectId, created.projectId);
      const run = textPayload(await session.client.callTool({
        name: "run_script",
        arguments: { projectId: created.projectId, mode: "preview", code: 'const b = mvm.geometry.box({ name: "AI Box" }); mvm.scene.add(b);' },
      }));
      assert.equal(run.status, "queued");
      assert.equal(run.needsOpenStudioTab, true);
      const queued = await executionQueue.get("user-a", run.jobId);
      assert.equal(queued?.code.includes("AI Box"), true);
      assert.equal(queued?.applyChanges, false);
    } finally { await session.close(); }

    const limitedRepo = new MemoryProjectRepository();
    const limitedProject = projectShell("Read and Execute Only", "");
    limitedProject.author = "limited-user";
    limitedRepo.projects.set(limitedProject.id, limitedProject);
    const limitedQueue = new MemoryExecutionQueue();
    const limited = await connectClient("limited-user", ["project:read", "scene:execute"], limitedRepo, limitedQueue);
    try {
      const result = await limited.client.callTool({
        name: "run_script",
        arguments: { projectId: limitedProject.id, mode: "apply", code: 'mvm.geometry.box({ name: "Denied Apply" });' },
      });
      assert.equal(result.isError, true, "apply mode must require scene:write");
      const queued = [...limitedQueue.jobs.values()];
      assert.equal(queued.length, 0, "unauthorized apply must not enqueue a job");
    } finally { await limited.close(); }
  });

  it("returns completed job screenshots as an MCP image", async () => {
    const repository = new MemoryProjectRepository();
    const executionQueue = new MemoryExecutionQueue();
    const session = await connectClient("user-a", undefined, repository, executionQueue);
    try {
      const created = textPayload(await session.client.callTool({ name: "create_project", arguments: { name: "AI Render Scene", starterId: "blank" } }));
      const queued = textPayload(await session.client.callTool({ name: "render_project", arguments: { projectId: created.projectId } }));
      const job = executionQueue.jobs.get(queued.jobId);
      assert.ok(job);
      job.status = "completed";
      job.result = { ok: true, phase: "render", project: { objectCount: 1 } };
      job.screenshotDataUrl = "data:image/jpeg;base64,ZmFrZQ==";
      executionQueue.jobs.set(job.id, job);
      const result = await session.client.callTool({ name: "get_execution_job", arguments: { jobId: job.id } });
      const resultContent = (result as unknown as {
        content: Array<{ type: string; data?: string; mimeType?: string; text?: string }>;
      }).content;
      const image = resultContent.find((item) => item.type === "image");
      assert.equal(image?.mimeType, "image/jpeg");
      assert.equal(image?.data, "ZmFrZQ==");
    } finally { await session.close(); }
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
      assert.ok(!result.isError, JSON.stringify(result.content));
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
