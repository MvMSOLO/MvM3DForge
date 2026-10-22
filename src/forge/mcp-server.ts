import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Project, GeometrySpec } from "@/forge/types.ts";
import { createStarterProject } from "@/forge/project.ts";
import { buildMCPSceneResource } from "@/forge/ai-mcp.ts";
import { assembleScene, animationClips } from "@/forge/scene-three.ts";
import { GLTFExporter } from "three/addons/exporters/GLTFExporter.js";
import { makeNode, projectShell } from "@/forge/nodes.ts";
import { defaultMaterial } from "@/forge/materials.ts";

const projectStore = new Map<string, Project>();

export function getOrCreateProject(projectId?: string): Project {
  if (projectId && projectStore.has(projectId)) {
    return projectStore.get(projectId)!;
  }
  if (projectStore.size > 0 && !projectId) {
    return Array.from(projectStore.values())[0];
  }
  const defaultProj = projectShell("MvM 3D Forge Project");
  if (projectId) defaultProj.id = projectId;

  const initialCube = makeNode({
    id: "cube_1",
    name: "Main Cube",
    type: "mesh",
    position: [0, 0, 0],
    rotation: [0, 0, 0],
    scale: [1, 1, 1],
    visible: true,
    geometry: {
      kind: "box",
      width: 1,
      height: 1,
      depth: 1,
      widthSegments: 1,
      heightSegments: 1,
      depthSegments: 1,
    },
    material: defaultMaterial({ name: "DefaultMaterial", color: "#83f0ce", roughness: 0.3, metalness: 0.2 }),
  });

  defaultProj.objects.push(initialCube);
  projectStore.set(defaultProj.id, defaultProj);
  return defaultProj;
}

export function saveProjectToStore(project: Project) {
  projectStore.set(project.id, { ...project, updatedAt: Date.now() });
}

export function createMcpServerInstance(): McpServer {
  const server = new McpServer({
    name: "MvM3DForge MCP Server",
    version: "1.0.0",
  });

  // Resource: Project Scene Summary
  server.resource(
    "scene-summary",
    "mvm://scene/summary",
    async () => {
      const proj = getOrCreateProject();
      return {
        contents: [
          {
            uri: "mvm://scene/summary",
            mimeType: "application/json",
            text: buildMCPSceneResource(proj),
          },
        ],
      };
    }
  );

  // Tool 1: list_projects
  server.tool(
    "list_projects",
    "List all authorized 3D projects for the current session",
    {},
    async () => {
      const projects = Array.from(projectStore.values()).map((p) => ({
        id: p.id,
        name: p.name,
        objectsCount: p.objects.length,
        updatedAt: p.updatedAt,
      }));
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ status: "success", projects }, null, 2),
          },
        ],
      };
    }
  );

  // Tool 2: get_project
  server.tool(
    "get_project",
    "Retrieve complete project data including scene graph and code",
    { projectId: z.string().optional() },
    async ({ projectId }) => {
      const proj = getOrCreateProject(projectId);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ status: "success", project: proj }, null, 2),
          },
        ],
      };
    }
  );

  // Tool 3: create_project
  server.tool(
    "create_project",
    "Create a new 3D project or load a starter template",
    {
      name: z.string().default("New 3D Scene"),
      starterId: z.enum(["blank", "primitives", "pbr", "product", "animated"]).optional(),
    },
    async ({ name, starterId }) => {
      let proj: Project;
      if (starterId) {
        const starter = await createStarterProject(starterId);
        proj = { ...starter.project, id: `proj_${Date.now()}`, name };
      } else {
        proj = getOrCreateProject(`proj_${Date.now()}`);
        proj.name = name;
      }
      saveProjectToStore(proj);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ status: "success", projectId: proj.id, name: proj.name }, null, 2),
          },
        ],
      };
    }
  );

  // Tool 4: rename_project
  server.tool(
    "rename_project",
    "Rename an existing project",
    {
      projectId: z.string().optional(),
      newName: z.string(),
    },
    async ({ projectId, newName }) => {
      const proj = getOrCreateProject(projectId);
      proj.name = newName;
      saveProjectToStore(proj);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ status: "success", projectId: proj.id, newName: proj.name }, null, 2),
          },
        ],
      };
    }
  );

  // Tool 5: read_scene
  server.tool(
    "read_scene",
    "Read scene hierarchy, mesh objects, lights, and animation clips",
    { projectId: z.string().optional() },
    async ({ projectId }) => {
      const proj = getOrCreateProject(projectId);
      const summary = {
        projectId: proj.id,
        name: proj.name,
        objects: proj.objects.map((o) => ({
          id: o.id,
          name: o.name,
          type: o.type,
          position: o.position,
          rotation: o.rotation,
          scale: o.scale,
          visible: o.visible,
          geometryKind: o.geometry?.kind,
          materialColor: o.material?.color,
        })),
        clipsCount: proj.clips.length,
      };
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ status: "success", scene: summary }, null, 2),
          },
        ],
      };
    }
  );

  // Tool 6: inspect_object
  server.tool(
    "inspect_object",
    "Inspect details of a specific scene object by ID or name",
    {
      projectId: z.string().optional(),
      objectId: z.string(),
    },
    async ({ projectId, objectId }) => {
      const proj = getOrCreateProject(projectId);
      const node = proj.objects.find((o) => o.id === objectId || o.name === objectId);
      if (!node) {
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({ status: "error", message: `Object '${objectId}' not found.` }, null, 2),
            },
          ],
          isError: true,
        };
      }
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ status: "success", object: node }, null, 2),
          },
        ],
      };
    }
  );

  // Tool 7: create_primitive
  server.tool(
    "create_primitive",
    "Create a new 3D primitive mesh (box, sphere, cylinder, cone, torus, plane) in the scene",
    {
      projectId: z.string().optional(),
      kind: z.enum(["box", "sphere", "cylinder", "cone", "torus", "plane"]),
      name: z.string().optional(),
      position: z.tuple([z.number(), z.number(), z.number()]).default([0, 0, 0]),
      rotation: z.tuple([z.number(), z.number(), z.number()]).default([0, 0, 0]),
      scale: z.tuple([z.number(), z.number(), z.number()]).default([1, 1, 1]),
      color: z.string().default("#83f0ce"),
      roughness: z.number().min(0).max(1).default(0.3),
      metalness: z.number().min(0).max(1).default(0.2),
    },
    async ({ projectId, kind, name, position, rotation, scale, color, roughness, metalness }) => {
      const proj = getOrCreateProject(projectId);
      const objId = `mesh_${kind}_${Date.now()}`;
      const objName = name || `${kind.charAt(0).toUpperCase() + kind.slice(1)} ${proj.objects.length + 1}`;

      let geometry: GeometrySpec;
      if (kind === "box") {
        geometry = { kind: "box", width: 1, height: 1, depth: 1, widthSegments: 1, heightSegments: 1, depthSegments: 1 };
      } else if (kind === "sphere") {
        geometry = { kind: "sphere", radius: 0.5, widthSegments: 24, heightSegments: 16 };
      } else if (kind === "cylinder") {
        geometry = { kind: "cylinder", radiusTop: 0.5, radiusBottom: 0.5, height: 1, radialSegments: 24, openEnded: false };
      } else if (kind === "cone") {
        geometry = { kind: "cone", radius: 0.5, height: 1, radialSegments: 24 };
      } else if (kind === "torus") {
        geometry = { kind: "torus", radius: 0.5, tube: 0.2, radialSegments: 16, tubularSegments: 32 };
      } else {
        geometry = { kind: "plane", width: 1, height: 1, widthSegments: 1, heightSegments: 1 };
      }

      const newNode = makeNode({
        id: objId,
        name: objName,
        type: "mesh",
        position,
        rotation,
        scale,
        visible: true,
        geometry,
        material: defaultMaterial({ name: `${objName}Material`, color, roughness, metalness }),
      });

      proj.objects.push(newNode);
      saveProjectToStore(proj);

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ status: "success", objectId: objId, name: objName }, null, 2),
          },
        ],
      };
    }
  );

  // Tool 8: update_object
  server.tool(
    "update_object",
    "Update position, rotation, scale, name, visibility, or material of an existing object",
    {
      projectId: z.string().optional(),
      objectId: z.string(),
      name: z.string().optional(),
      position: z.tuple([z.number(), z.number(), z.number()]).optional(),
      rotation: z.tuple([z.number(), z.number(), z.number()]).optional(),
      scale: z.tuple([z.number(), z.number(), z.number()]).optional(),
      visible: z.boolean().optional(),
      color: z.string().optional(),
      roughness: z.number().min(0).max(1).optional(),
      metalness: z.number().min(0).max(1).optional(),
    },
    async ({ projectId, objectId, name, position, rotation, scale, visible, color, roughness, metalness }) => {
      const proj = getOrCreateProject(projectId);
      const nodeIndex = proj.objects.findIndex((o) => o.id === objectId || o.name === objectId);
      if (nodeIndex === -1) {
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({ status: "error", message: `Object '${objectId}' not found.` }, null, 2),
            },
          ],
          isError: true,
        };
      }

      const node = proj.objects[nodeIndex];
      if (name !== undefined) node.name = name;
      if (position !== undefined) node.position = position;
      if (rotation !== undefined) node.rotation = rotation;
      if (scale !== undefined) node.scale = scale;
      if (visible !== undefined) node.visible = visible;

      if (color !== undefined || roughness !== undefined || metalness !== undefined) {
        node.material = defaultMaterial({
          ...node.material,
          name: node.material?.name || `${node.name}Material`,
          color: color ?? node.material?.color ?? "#ffffff",
          roughness: roughness ?? node.material?.roughness ?? 0.5,
          metalness: metalness ?? node.material?.metalness ?? 0.0,
        });
      }

      saveProjectToStore(proj);

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ status: "success", object: node }, null, 2),
          },
        ],
      };
    }
  );

  // Tool 9: delete_object
  server.tool(
    "delete_object",
    "Delete an object from the project scene graph",
    {
      projectId: z.string().optional(),
      objectId: z.string(),
    },
    async ({ projectId, objectId }) => {
      const proj = getOrCreateProject(projectId);
      const initialCount = proj.objects.length;
      proj.objects = proj.objects.filter((o) => o.id !== objectId && o.name !== objectId);

      if (proj.objects.length === initialCount) {
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({ status: "error", message: `Object '${objectId}' not found.` }, null, 2),
            },
          ],
          isError: true,
        };
      }

      saveProjectToStore(proj);

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ status: "success", deletedId: objectId }, null, 2),
          },
        ],
      };
    }
  );

  // Tool 10: create_light
  server.tool(
    "create_light",
    "Add a light source (directional, point, ambient, spot) to the scene",
    {
      projectId: z.string().optional(),
      kind: z.enum(["ambient", "directional", "point", "spot"]),
      name: z.string().optional(),
      color: z.string().default("#ffffff"),
      intensity: z.number().default(1.0),
      position: z.tuple([z.number(), z.number(), z.number()]).default([2, 5, 2]),
    },
    async ({ projectId, kind, name, color, intensity, position }) => {
      const proj = getOrCreateProject(projectId);
      const lightId = `light_${kind}_${Date.now()}`;
      const lightName = name || `${kind.charAt(0).toUpperCase() + kind.slice(1)} Light`;

      const newLight = makeNode({
        id: lightId,
        name: lightName,
        type: "light",
        position,
        rotation: [0, 0, 0],
        scale: [1, 1, 1],
        visible: true,
        light: { kind, color, intensity },
      });

      proj.objects.push(newLight);
      saveProjectToStore(proj);

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ status: "success", lightId, name: lightName }, null, 2),
          },
        ],
      };
    }
  );

  // Tool 11: create_material
  server.tool(
    "create_material",
    "Create or assign PBR material settings to an object",
    {
      projectId: z.string().optional(),
      objectId: z.string(),
      color: z.string().default("#ffffff"),
      roughness: z.number().min(0).max(1).default(0.5),
      metalness: z.number().min(0).max(1).default(0.0),
      emissive: z.string().default("#000000"),
    },
    async ({ projectId, objectId, color, roughness, metalness, emissive }) => {
      const proj = getOrCreateProject(projectId);
      const node = proj.objects.find((o) => o.id === objectId || o.name === objectId);
      if (!node) {
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({ status: "error", message: `Object '${objectId}' not found.` }, null, 2),
            },
          ],
          isError: true,
        };
      }

      node.material = defaultMaterial({
        name: `${node.name}Material`,
        color,
        roughness,
        metalness,
        emissive,
      });

      saveProjectToStore(proj);

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ status: "success", updatedMaterial: node.material }, null, 2),
          },
        ],
      };
    }
  );

  // Tool 12: export_project_glb
  server.tool(
    "export_project_glb",
    "Export the 3D scene as binary glTF (GLB) file format metadata",
    {
      projectId: z.string().optional(),
    },
    async ({ projectId }) => {
      const proj = getOrCreateProject(projectId);
      const built = await assembleScene(proj, { mode: "material", shadows: false, onlyVisible: true });
      const exporter = new GLTFExporter();

      const output = await new Promise<ArrayBuffer>((resolve, reject) => {
        exporter.parse(
          built.scene,
          (result) => {
            if (result instanceof ArrayBuffer) resolve(result);
            else reject(new Error("Exporter did not return ArrayBuffer."));
          },
          (err) => reject(err),
          { binary: true, embedImages: true, animations: animationClips(proj, built.byId) }
        );
      });

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                status: "success",
                byteLength: output.byteLength,
                format: "glTF 2.0 Binary (GLB)",
                meshCount: proj.objects.filter((o) => o.type === "mesh").length,
              },
              null,
              2
            ),
          },
        ],
      };
    }
  );

  return server;
}
