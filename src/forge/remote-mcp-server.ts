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

function primitiveGeometry(kind: "box" | "sphere" | "cylinder" | "cone" | "torus" | "plane"): GeometrySpec {
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
  }
}

export function createPersistedMcpServer(\n  context: RemoteMcpContext,\n  repository: McpProjectRepository = databaseProjectRepository,\n): McpServer {
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
      const projects = await listUserProjectsFromDb(context.userId);
      if (!projects.length) throw new Error("No saved projects yet. Call create_project first.");
      projectId = projects[0].id;
    }
    const project = await loadProjectFromDb(context.userId, projectId);
    if (!project || project.author !== context.userId) {
      throw new Error("Project not found or access denied.");
    }
    return project;
  }

  async function persist(project: Project): Promise<Project> {
    const owned = { ...project, author: context.userId, updatedAt: Date.now() };
    await saveProjectToDb(context.userId, owned);
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
    projects: await listUserProjectsFromDb(context.userId),
  }));

  register("get_project", "Retrieve a saved project including scene graph and source code.", {
    projectId: z.string().min(1).optional(),
  }, "project:read", async (args) => ({ project: await getProject(args.projectId) }));

  register("create_project", "Create and persist a new 3D project from a supported starter template.", {
    name: z.string().trim().min(1).max(80).default("New 3D Scene"),
    starterId: z.enum(["blank", "primitives", "pbr", "product", "animated"]).optional(),
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
    kind: z.enum(["box", "sphere", "cylinder", "cone", "torus", "plane"]),
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

  server.tool("export_project_glb", "Export a project as actual binary glTF (GLB) bytes embedded in the MCP result.", {
    projectId: z.string().min(1).optional(),
  }, async (args: { projectId?: string }) => {
    try {
      requireScope("assets:export");
      const project = await getProject(args.projectId);
      const built = await assembleScene(project, { mode: "material", shadows: false, onlyVisible: true });
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
