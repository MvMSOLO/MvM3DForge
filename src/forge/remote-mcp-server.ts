import { randomUUID } from "node:crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { createStarterProject } from "./project.ts";
import { buildMCPSceneResource } from "./ai-mcp.ts";
import { assembleScene, animationClips } from "./scene-three.ts";
import { GLTFExporter } from "three/addons/exporters/GLTFExporter.js";
import { makeNode } from "./nodes.ts";
import { defaultMaterial } from "./materials.ts";
import type { GeometrySpec, LightSpec, Project } from "./types.ts";
import type { McpScope } from "../lib/mcp/api-keys-primitives.ts";
import { LIMITS, BUDGET_CEILINGS } from "./limits.ts";
import { validateScene } from "./validate.ts";
import type { McpExecutionQueue } from "../lib/mcp/execution-jobs.server.ts";

export interface RemoteMcpContext {
  userId: string;
  scopes: string[];
}

export interface McpProjectRepository {
  list(userId: string): Promise<Array<{ id: string; name: string; updatedAt: number }>>;
  load(userId: string, projectId: string): Promise<Project | null>;
  save(userId: string, project: Project): Promise<Project>;
}

const databaseProjectRepository: McpProjectRepository = {
  async list(userId) {
    const { listUserProjectsFromDb } = await import("../lib/projects.server.ts");
    return listUserProjectsFromDb(userId);
  },
  async load(userId, projectId) {
    const { loadProjectFromDb } = await import("../lib/projects.server.ts");
    return loadProjectFromDb(userId, projectId);
  },
  async save(userId, project) {
    const { saveProjectToDb } = await import("../lib/projects.server.ts");
    return saveProjectToDb(userId, project);
  },
};

type JsonRecord = Record<string, unknown>;
type Handler = (args: any) => Promise<unknown>;

function toolError(message: string) {
  return { content: [{ type: "text" as const, text: message }], isError: true };
}

function textResult(value: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }] };
}

/**
 * Three.js GLTFExporter uses the browser FileReader API to pack the binary GLB
 * Blob. On Node runtimes without FileReader, provide the small subset the
 * exporter needs, backed by the native Blob.arrayBuffer() implementation.
 */
function ensureServerFileReader(): void {
  const root = globalThis as typeof globalThis & { FileReader?: typeof FileReader };
  if (root.FileReader) return;

  type Handler = ((this: FileReader, event: ProgressEvent<FileReader>) => unknown) | null;

  class ServerFileReader {
    readonly EMPTY = 0;
    readonly LOADING = 1;
    readonly DONE = 2;
    readyState = this.EMPTY;
    result: string | ArrayBuffer | null = null;
    error: DOMException | null = null;
    onload: Handler = null;
    onloadend: Handler = null;
    onerror: Handler = null;

    readAsArrayBuffer(blob: Blob): void {
      void this.read(blob, async () => blob.arrayBuffer());
    }

    readAsDataURL(blob: Blob): void {
      void this.read(blob, async () => {
        const data = Buffer.from(await blob.arrayBuffer()).toString("base64");
        return `data:${blob.type || "application/octet-stream"};base64,${data}`;
      });
    }

    readAsText(blob: Blob, encoding = "utf-8"): void {
      void this.read(blob, async () => new TextDecoder(encoding).decode(await blob.arrayBuffer()));
    }

    abort(): void {
      this.result = null;
      this.readyState = this.DONE;
      this.onloadend?.call(this as unknown as FileReader, this.event());
    }

    private event(): ProgressEvent<FileReader> {
      return { target: this, currentTarget: this } as unknown as ProgressEvent<FileReader>;
    }

    private async read(blob: Blob, operation: () => Promise<string | ArrayBuffer>): Promise<void> {
      this.readyState = this.LOADING;
      this.result = null;
      this.error = null;
      try {
        this.result = await operation();
        this.readyState = this.DONE;
        this.onload?.call(this as unknown as FileReader, this.event());
      } catch (cause) {
        this.error = cause instanceof DOMException
          ? cause
          : new DOMException(cause instanceof Error ? cause.message : "FileReader operation failed.");
        this.readyState = this.DONE;
        this.onerror?.call(this as unknown as FileReader, this.event());
      } finally {
        this.onloadend?.call(this as unknown as FileReader, this.event());
      }
    }
  }

  root.FileReader = ServerFileReader as unknown as typeof FileReader;
}

function primitiveGeometry(kind: "box" | "sphere" | "cylinder" | "cone" | "torus" | "plane" | "capsule"): GeometrySpec {
  switch (kind) {
    case "box":
      return { kind: "box", width: 1, height: 1, depth: 1, widthSegments: 1, heightSegments: 1, depthSegments: 1 };
    case "sphere":
      return { kind: "sphere", radius: 0.5, widthSegments: 32, heightSegments: 20 };
    case "cylinder":
      return { kind: "cylinder", radiusTop: 0.5, radiusBottom: 0.5, height: 1, radialSegments: 32, openEnded: false };
    case "cone":
      return { kind: "cone", radius: 0.5, height: 1, radialSegments: 32 };
    case "torus":
      return { kind: "torus", radius: 0.5, tube: 0.18, radialSegments: 20, tubularSegments: 40 };
    case "plane":
      return { kind: "plane", width: 1, height: 1, widthSegments: 1, heightSegments: 1 };
    case "capsule":
      return { kind: "capsule", radius: 0.25, length: 0.8, capSegments: 8, radialSegments: 16 };
  }
}

export function createPersistedMcpServer(
  context: RemoteMcpContext,
  repository: McpProjectRepository = databaseProjectRepository,
  executionQueue: McpExecutionQueue = {
    async enqueue(input) {
      const mod = await import("../lib/mcp/execution-jobs.server.ts");
      return mod.enqueueMcpExecutionJob(input);
    },
    async get(userId, jobId) {
      const mod = await import("../lib/mcp/execution-jobs.server.ts");
      return mod.getMcpExecutionJob(userId, jobId);
    },
  },
): McpServer {
  if (!context.userId) throw new Error("A verified user identity is required.");
  const server = new McpServer({ name: "MvM 3D Forge", version: "1.1.0" });

  function requireScope(scope: McpScope): void {
    if (!context.scopes.includes(scope) && !context.scopes.includes("*")) {
      throw new Error(`Permission denied: API key requires the '${scope}' scope.`);
    }
  }

  async function getProject(projectId?: string): Promise<Project> {
    requireScope("project:read");
    if (projectId) {
      const project = await repository.load(context.userId, projectId);
      if (!project || project.author !== context.userId) {
        throw new Error("Project not found or access denied.");
      }
      return project;
    }
    const projects = await repository.list(context.userId);
    if (!projects.length) throw new Error("No saved projects yet. Call create_project first.");
    const project = await repository.load(context.userId, projects[0].id);
    if (!project) throw new Error("Project not found or access denied.");
    return project;
  }

  async function getWritableProject(projectId?: string): Promise<Project> {
    requireScope("scene:write");
    if (!projectId) {
      const projects = await repository.list(context.userId);
      if (!projects.length) throw new Error("No saved projects yet. Call create_project first.");
      projectId = projects[0].id;
    }
    const project = await repository.load(context.userId, projectId);
    if (!project || project.author !== context.userId) {
      throw new Error("Project not found or access denied.");
    }
    return project;
  }

  async function persist(project: Project): Promise<Project> {
    const owned = { ...project, author: context.userId, updatedAt: Date.now() };
    await repository.save(context.userId, owned);
    return owned;
  }

  function register(
    name: string,
    description: string,
    schema: Record<string, z.ZodTypeAny>,
    scope: McpScope,
    handler: Handler,
  ) {
    server.tool(name, description, schema, async (args: JsonRecord) => {
      try {
        requireScope(scope);
        const output = await handler(args);
        if (
          output && typeof output === "object" &&
          "content" in output && Array.isArray((output as { content?: unknown }).content)
        ) {
          return output as any;
        }
        return textResult(output);
      } catch (error) {
        const message = error instanceof Error ? error.message : "The MCP operation failed.";
        return toolError(message);
      }
    });
  }

  server.resource(
    "scene-summary",
    "mvm://scene/summary",
    { description: "Saved scene summary for the authenticated user", mimeType: "application/json" },
    async () => {
      try {
        requireScope("project:read");
        const project = await getProject();
        return {
          contents: [{
            uri: "mvm://scene/summary",
            mimeType: "application/json",
            text: buildMCPSceneResource(project),
          }],
        };
      } catch (error) {
        return {
          contents: [{
            uri: "mvm://scene/summary",
            mimeType: "text/plain",
            text: error instanceof Error ? error.message : "Could not read scene.",
          }],
        };
      }
    },
  );

  register("list_projects", "List saved projects owned by the authenticated user.", {}, "project:read", async () => ({
    projects: await repository.list(context.userId),
  }));

  register("get_project", "Retrieve a saved project including scene graph and source code.", {
    projectId: z.string().min(1).optional(),
  }, "project:read", async (args) => ({ project: await getProject(args.projectId) }));

  register("create_project", "Create and persist a new 3D project from a supported starter template.", {
    name: z.string().trim().min(1).max(80).default("New 3D Scene"),
    starterId: z.enum(["blank", "primitives", "pbr", "product", "animated", "webgpu"]).optional(),
  }, "scene:write", async (args) => {
    let project: Project;
    if (args.starterId) {
      const starter = await createStarterProject(args.starterId);
      project = { ...starter.project, id: randomUUID(), name: args.name };
    } else {
      const starter = await createStarterProject("blank");
      project = { ...starter.project, id: randomUUID(), name: args.name };
    }
    project.author = context.userId;
    await persist(project);
    return { projectId: project.id, name: project.name, objectCount: project.objects.length };
  });

  register("rename_project", "Rename a project owned by the authenticated user.", {
    projectId: z.string().min(1).optional(),
    newName: z.string().trim().min(1).max(80),
  }, "scene:write", async (args) => {
    const project = await getWritableProject(args.projectId);
    project.name = args.newName;
    await persist(project);
    return { projectId: project.id, name: project.name, updatedAt: project.updatedAt };
  });

  register("read_scene", "Read the saved scene hierarchy, transformations, materials, lights and animation clips.", {
    projectId: z.string().min(1).optional(),
  }, "project:read", async (args) => {
    const project = await getProject(args.projectId);
    return {
      projectId: project.id,
      name: project.name,
      scene: project.scene,
      objects: project.objects.map((node) => ({
        id: node.id, name: node.name, type: node.type,
        parentId: node.parentId, position: node.position, rotation: node.rotation,
        scale: node.scale, visible: node.visible, geometry: node.geometry,
        material: node.material, light: node.light,
      })),
      clips: project.clips,
      updatedAt: project.updatedAt,
    };
  });

  register("inspect_object", "Inspect full properties for an object by id or exact name.", {
    projectId: z.string().min(1).optional(),
    objectId: z.string().min(1),
  }, "project:read", async (args) => {
    const project = await getProject(args.projectId);
    const node = project.objects.find((item) => item.id === args.objectId || item.name === args.objectId);
    if (!node) throw new Error("Object not found in this project.");
    return { projectId: project.id, object: node };
  });

  register("create_primitive", "Create and persist a real mesh primitive with a PBR material.", {
    projectId: z.string().min(1).optional(),
    kind: z.enum(["box", "sphere", "cylinder", "cone", "torus", "plane", "capsule"]),
    name: z.string().trim().min(1).max(120).optional(),
    position: z.tuple([z.number().finite(), z.number().finite(), z.number().finite()]).default([0, 0, 0]),
    rotation: z.tuple([z.number().finite(), z.number().finite(), z.number().finite()]).default([0, 0, 0]),
    scale: z.tuple([z.number().finite(), z.number().finite(), z.number().finite()]).default([1, 1, 1]),
    color: z.string().regex(/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/).default("#83f0ce"),
    roughness: z.number().min(0).max(1).default(0.3),
    metalness: z.number().min(0).max(1).default(0.2),
  }, "scene:write", async (args) => {
    const project = await getWritableProject(args.projectId);
    const name = args.name || `${args.kind[0].toUpperCase()}${args.kind.slice(1)} ${project.objects.length + 1}`;
    const node = makeNode({
      id: randomUUID(),
      name,
      type: "mesh",
      source: "manual",
      position: args.position,
      rotation: args.rotation,
      scale: args.scale,
      visible: true,
      geometry: primitiveGeometry(args.kind),
      material: defaultMaterial({ name: `${name} Material`, color: args.color, roughness: args.roughness, metalness: args.metalness }),
    });
    project.objects.push(node);
    await persist(project);
    return { projectId: project.id, createdObject: node };
  });

  register("create_animation_clip", "Create and persist an editable animation clip with position, rotation, scale or quaternion keyframes.", {
    projectId: z.string().min(1).optional(),
    name: z.string().trim().min(1).max(100),
    duration: z.number().finite().min(0.05).max(600),
    loop: z.boolean().default(true),
    tracks: z.array(z.object({
      objectId: z.string().min(1).max(120),
      property: z.enum(["position", "rotation", "scale", "quaternion"]),
      interpolation: z.enum(["linear", "smooth", "step"]).default("linear"),
      keyframes: z.array(z.object({
        time: z.number().finite().min(0).max(600),
        value: z.array(z.number().finite()).min(3).max(4),
      })).min(2).max(100),
    })).min(1).max(64),
  }, "scene:write", async (args) => {
    const project = await getWritableProject(args.projectId);
    const validatedTracks = args.tracks.map((track: {
      objectId: string;
      property: "position" | "rotation" | "scale" | "quaternion";
      interpolation: "linear" | "smooth" | "step";
      keyframes: { time: number; value: number[] }[];
    }) => {
      const node = project.objects.find((item) => item.id === track.objectId || item.name === track.objectId);
      if (!node) throw new Error(`Animation target '${track.objectId}' was not found in this scene.`);
      const expectedSize = track.property === "quaternion" ? 4 : 3;
      if (track.keyframes.some((key) => key.value.length !== expectedSize)) {
        throw new Error(`Track '${track.objectId}.${track.property}' requires ${expectedSize} values per keyframe.`);
      }
      if (track.keyframes.some((key) => key.time > args.duration)) {
        throw new Error(`Every keyframe must be within the clip duration (${args.duration}s).`);
      }
      const ordered = [...track.keyframes].sort((a, b) => a.time - b.time);
      if (ordered[0].time === ordered[ordered.length - 1].time) {
        throw new Error(`Track '${track.objectId}.${track.property}' must span at least two different times.`);
      }
      return {
        id: randomUUID(),
        objectId: node.id,
        property: track.property,
        interpolation: track.interpolation,
        keyframes: ordered.map((key) => ({ time: key.time, value: [...key.value] })),
      };
    });
    const clip: {
      id: string;
      name: string;
      duration: number;
      loop: boolean;
      tracks: Array<{
        id: string;
        objectId: string;
        property: "position" | "rotation" | "scale" | "quaternion";
        interpolation: "linear" | "smooth" | "step";
        keyframes: Array<{ time: number; value: number[] }>;
      }>;
      source: "user";
    } = {
      id: randomUUID(),
      name: args.name,
      duration: args.duration,
      loop: args.loop,
      tracks: validatedTracks,
      source: "user" as const,
    };
    project.clips = [...project.clips.filter((existing) => existing.id !== clip.id), clip];
    await persist(project);
    return {
      projectId: project.id,
      createdClip: clip,
      trackCount: clip.tracks.length,
      keyframeCount: clip.tracks.reduce((sum: number, track) => sum + track.keyframes.length, 0),
    };
  });

  register("update_object", "Update a saved object's name, transform, visibility or PBR material.", {
    projectId: z.string().min(1).optional(),
    objectId: z.string().min(1),
    name: z.string().trim().min(1).max(120).optional(),
    position: z.tuple([z.number().finite(), z.number().finite(), z.number().finite()]).optional(),
    rotation: z.tuple([z.number().finite(), z.number().finite(), z.number().finite()]).optional(),
    scale: z.tuple([z.number().finite(), z.number().finite(), z.number().finite()]).optional(),
    visible: z.boolean().optional(),
    color: z.string().regex(/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/).optional(),
    roughness: z.number().min(0).max(1).optional(),
    metalness: z.number().min(0).max(1).optional(),
  }, "scene:write", async (args) => {
    const project = await getWritableProject(args.projectId);
    const node = project.objects.find((item) => item.id === args.objectId || item.name === args.objectId);
    if (!node) throw new Error("Object not found in this project.");
    if (args.name !== undefined) node.name = args.name;
    if (args.position !== undefined) node.position = args.position;
    if (args.rotation !== undefined) node.rotation = args.rotation;
    if (args.scale !== undefined) node.scale = args.scale;
    if (args.visible !== undefined) node.visible = args.visible;
    if (args.color !== undefined || args.roughness !== undefined || args.metalness !== undefined) {
      node.material = defaultMaterial({
        ...node.material,
        name: node.material?.name || `${node.name} Material`,
        color: args.color ?? node.material?.color,
        roughness: args.roughness ?? node.material?.roughness,
        metalness: args.metalness ?? node.material?.metalness,
      });
    }
    await persist(project);
    return { projectId: project.id, updatedObject: node };
  });

  register("delete_object", "Delete an object from a project owned by the authenticated user.", {
    projectId: z.string().min(1).optional(),
    objectId: z.string().min(1),
  }, "scene:write", async (args) => {
    const project = await getWritableProject(args.projectId);
    const before = project.objects.length;
    project.objects = project.objects.filter((item) => item.id !== args.objectId && item.name !== args.objectId);
    if (before === project.objects.length) throw new Error("Object not found in this project.");
    await persist(project);
    return { projectId: project.id, deletedObjectId: args.objectId, objectCount: project.objects.length };
  });

  register("create_light", "Create and persist an actual light node in the scene graph.", {
    projectId: z.string().min(1).optional(),
    kind: z.enum(["ambient", "hemisphere", "directional", "point", "spot"]),
    name: z.string().trim().min(1).max(120).optional(),
    color: z.string().regex(/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/).default("#ffffff"),
    groundColor: z.string().regex(/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/).default("#243140"),
    intensity: z.number().min(0).max(20).default(1),
    position: z.tuple([z.number().finite(), z.number().finite(), z.number().finite()]).default([2, 5, 2]),
    distance: z.number().min(0).max(1000).default(0),
    angle: z.number().min(0.01).max(Math.PI / 2).default(Math.PI / 5),
    penumbra: z.number().min(0).max(1).default(0.2),
    castShadow: z.boolean().default(false),
  }, "scene:write", async (args) => {
    const project = await getWritableProject(args.projectId);
    const name = args.name || `${args.kind[0].toUpperCase()}${args.kind.slice(1)} Light`;
    const light: LightSpec = {
      kind: args.kind, color: args.color, intensity: args.intensity,
      groundColor: args.kind === "hemisphere" ? args.groundColor : undefined,
      distance: args.distance || undefined,
      angle: args.kind === "spot" ? args.angle : undefined,
      penumbra: args.kind === "spot" ? args.penumbra : undefined,
      castShadow: args.castShadow,
      target: args.kind === "directional" || args.kind === "spot" ? [0, 0, 0] : undefined,
    };
    const node = makeNode({
      id: randomUUID(), name, type: "light", source: "manual",
      position: args.position, rotation: [0, 0, 0], scale: [1, 1, 1], visible: true, light,
    });
    project.objects.push(node);
    await persist(project);
    return { projectId: project.id, createdLight: node };
  });

  register("create_material", "Create or assign PBR material properties to a mesh object.", {
    projectId: z.string().min(1).optional(),
    objectId: z.string().min(1),
    name: z.string().trim().min(1).max(120).optional(),
    color: z.string().regex(/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/).default("#ffffff"),
    roughness: z.number().min(0).max(1).default(0.5),
    metalness: z.number().min(0).max(1).default(0),
    emissive: z.string().regex(/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/).default("#000000"),
    emissiveIntensity: z.number().min(0).max(20).default(1),
    opacity: z.number().min(0).max(1).default(1),
  }, "scene:write", async (args) => {
    const project = await getWritableProject(args.projectId);
    const node = project.objects.find((item) => item.id === args.objectId || item.name === args.objectId);
    if (!node) throw new Error("Object not found in this project.");
    node.material = defaultMaterial({
      ...node.material,
      name: args.name || `${node.name} Material`,
      color: args.color,
      roughness: args.roughness,
      metalness: args.metalness,
      emissive: args.emissive,
      emissiveIntensity: args.emissiveIntensity,
      opacity: args.opacity,
      alphaMode: args.opacity < 1 ? "BLEND" : node.material?.alphaMode ?? "OPAQUE",
    });
    await persist(project);
    return { projectId: project.id, objectId: node.id, material: node.material };
  });

  register(
    "get_ai_workflow",
    "Explain the supported AI workflow: inspect the scene, diagnose, run JavaScript in the open Studio browser sandbox, poll the job result, inspect the returned render screenshot, and iterate. The app does not call an AI model itself; any MCP-compatible AI client can orchestrate these tools.",
    {},
    "project:read",
    async () => ({
      endpoint: "/mcp",
      workflow: [
        "1. Call list_projects, then get_project or read_scene for the target project.",
        "2. Call diagnose_project to inspect saved-scene validation issues.",
        "3. Call run_script with mode preview first. This queues work for the project's open Studio browser tab; server-side Node execution is intentionally disabled.",
        "4. Poll get_execution_job with the returned jobId until status is completed or failed.",
        "5. Inspect the attached viewport screenshot and execution logs. Fix errors and try another preview.",
        "6. Use run_script mode apply only when the result is correct and you intend to persist it. Apply requires scene:write scope.",
        "7. Call render_project to request a fresh screenshot of the current saved scene, or export_project_glb for an actual binary GLB.",
      ],
      browserRequirement: "The target cloud project must be open in Studio in a signed-in browser tab. Script jobs execute there with the existing restricted Forge SDK sandbox and return logs, validation issues and a real viewport screenshot.",
      limits: { maxCodeChars: LIMITS.maxCodeChars, maxObjectsHard: BUDGET_CEILINGS.maxObjects, maxTexturesHard: BUDGET_CEILINGS.maxTextures },
      safety: "Preview is the default. A script is persisted only when mode='apply', the API key has scene:write, the browser run succeeds, the revision is current, and server validation passes. No AI provider key is stored by Forge.",
    }),
  );

  register(
    "diagnose_project",
    "Validate a saved project scene and return errors and warnings about transforms, mesh geometry, texture references, materials, animation tracks, object/texture/triangle budgets, and export readiness.",
    { projectId: z.string().min(1).optional() },
    "project:read",
    async (args) => {
      const project = await getProject(args.projectId);
      const issues = validateScene(
        { objects: project.objects, textures: project.textures, clips: project.clips },
        {
          maxObjects: BUDGET_CEILINGS.maxObjects,
          maxTextures: BUDGET_CEILINGS.maxTextures,
          maxTrianglesHard: BUDGET_CEILINGS.maxTrianglesHard,
        },
      );
      return {
        projectId: project.id,
        projectName: project.name,
        ok: !issues.some((entry) => entry.severity === "error"),
        counts: {
          objects: project.objects.length,
          meshes: project.objects.filter((entry) => entry.type === "mesh").length,
          lights: project.objects.filter((entry) => entry.type === "light").length,
          textures: project.textures.length,
          clips: project.clips.length,
        },
        issues,
      };
    },
  );

  register(
    "run_script",
    "Queue a JavaScript scene script for the target project's open Studio browser sandbox. Default mode is preview (does not save). Apply requires scene:write and persists only after browser execution succeeds and server-side validation passes. Poll get_execution_job to retrieve logs, validation issues and the actual viewport screenshot.",
    {
      projectId: z.string().min(1),
      code: z.string().min(1).max(LIMITS.maxCodeChars),
      mode: z.enum(["preview", "apply"]).default("preview"),
    },
    "scene:execute",
    async (args) => {
      if (args.mode === "apply") requireScope("scene:write");
      const project = await repository.load(context.userId, args.projectId);
      if (!project || project.author !== context.userId) throw new Error("Project not found or access denied.");
      const job = await executionQueue.enqueue({
        userId: context.userId,
        projectId: project.id,
        kind: "script",
        code: args.code,
        applyChanges: args.mode === "apply",
        baseUpdatedAt: project.updatedAt,
      });
      return {
        jobId: job.id, status: job.status, mode: args.mode,
        projectId: job.projectId, projectRevision: job.baseUpdatedAt,
        needsOpenStudioTab: true, nextTool: "get_execution_job",
        instructions: "Open this saved project in the MvM 3D Studio in a signed-in browser tab, then poll get_execution_job using this jobId. The code is executed in that browser's Forge sandbox, not on the server.",
      };
    },
  );

  register(
    "render_project",
    "Request a fresh screenshot of the actual Three.js viewport for a saved project. The project must be open in Studio in a signed-in browser tab. Poll get_execution_job and inspect the returned image.",
    { projectId: z.string().min(1) },
    "scene:execute",
    async (args) => {
      const project = await repository.load(context.userId, args.projectId);
      if (!project || project.author !== context.userId) throw new Error("Project not found or access denied.");
      const job = await executionQueue.enqueue({
        userId: context.userId, projectId: project.id, kind: "render",
        code: "", applyChanges: false, baseUpdatedAt: project.updatedAt,
      });
      return {
        jobId: job.id, status: job.status, projectId: job.projectId,
        projectRevision: job.baseUpdatedAt, nextTool: "get_execution_job",
        instructions: "Keep the target project open in Studio until this job completes. The returned image is captured from the real viewport canvas.",
      };
    },
  );

  register(
    "get_execution_job",
    "Poll a run_script or render_project job. Returns job status, execution logs, browser/sandbox errors, validation issues, whether changes were applied, and an actual viewport screenshot as an MCP image when available.",
    { jobId: z.string().min(1) },
    "scene:execute",
    async (args) => {
      const job = await executionQueue.get(context.userId, args.jobId);
      if (!job) throw new Error("Execution job not found or access denied.");
      const summary = {
        jobId: job.id, projectId: job.projectId, kind: job.kind,
        status: job.status, mode: job.applyChanges ? "apply" : "preview",
        projectRevision: job.baseUpdatedAt, result: job.result, error: job.error,
        createdAt: job.createdAt, updatedAt: job.updatedAt, completedAt: job.completedAt,
        screenshotAvailable: Boolean(job.screenshotDataUrl),
        waitingForStudio: job.status === "queued" || job.status === "running" || job.status === "awaiting_capture",
      };
      const content: Array<Record<string, unknown>> = [{ type: "text", text: JSON.stringify(summary, null, 2) }];
      if (job.screenshotDataUrl) {
        const match = /^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/=]+)$/.exec(job.screenshotDataUrl);
        if (match) content.push({ type: "image", mimeType: "image/" + match[1], data: match[2] });
      }
      return { content };
    },
  );

  server.tool("export_project_glb", "Export a project as actual binary glTF (GLB) bytes embedded in the MCP result.", {
    projectId: z.string().min(1).optional(),
  }, async (args: { projectId?: string }) => {
    try {
      requireScope("assets:export");
      const project = await getProject(args.projectId);
      const built = await assembleScene(project, { mode: "material", shadows: false, onlyVisible: true });
      ensureServerFileReader();
      const exporter = new GLTFExporter();
      const output = await new Promise<ArrayBuffer>((resolve, reject) => {
        exporter.parse(
          built.scene,
          (result) => result instanceof ArrayBuffer
            ? resolve(result)
            : reject(new Error("GLB exporter returned JSON instead of binary data.")),
          (error) => reject(error),
          { binary: true, embedImages: true, animations: animationClips(project, built.byId) },
        );
      });
      return {
        content: [{
          type: "resource",
          resource: {
            uri: `mvm://exports/${project.id}/${Date.now()}.glb`,
            mimeType: "model/gltf-binary",
            blob: Buffer.from(output).toString("base64"),
          },
        }],
      };
    } catch (error) {
      return toolError(error instanceof Error ? error.message : "GLB export failed.");
    }
  });

  return server;
}
