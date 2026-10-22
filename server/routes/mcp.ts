import { defineEventHandler, readBody, setHeader, setResponseStatus } from "h3";
import { getOrCreateProject } from "@/forge/mcp-server";
import { buildMCPSceneResource } from "@/forge/ai-mcp";
import { defaultMaterial } from "@/forge/materials";
import { makeNode } from "@/forge/nodes";
import { validateMcpRequestAuth, verifyProjectOwnership, checkScopePermission } from "@/lib/auth/mcp-auth";

export default defineEventHandler(async (event) => {
  const req = event.node?.req;
  const method = (req?.method || "GET").toUpperCase();

  // Enable CORS for MCP client integrations
  setHeader(event, "Access-Control-Allow-Origin", "*");
  setHeader(event, "Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  setHeader(event, "Access-Control-Allow-Headers", "Content-Type, Authorization, X-MCP-Version, X-API-Key");

  if (method === "OPTIONS") {
    setResponseStatus(event, 204);
    return "";
  }

  // Enforce authentication
  const auth = await validateMcpRequestAuth(event);
  if (!auth.authenticated) {
    setHeader(event, "WWW-Authenticate", 'Bearer resource_id="https://mvm3dforge.vercel.app/mcp", error="unauthorized"');
    setResponseStatus(event, 401);
    return {
      jsonrpc: "2.0",
      id: null,
      error: { code: -32001, message: auth.error || "Unauthorized access to MCP endpoint." },
    };
  }

  // Handle GET /mcp
  if (method === "GET") {
    setHeader(event, "Content-Type", "application/json");

    return {
      name: "MvM 3D Forge Remote MCP Server",
      status: "online",
      version: "1.0.0",
      mcpVersion: "2024-11-05",
      endpoint: "/mcp",
      authenticatedUser: auth.userId,
      scopes: auth.scopes,
      transport: "Streamable HTTP / JSON-RPC 2.0",
      capabilities: {
        tools: { list: true, call: true },
        resources: { list: true, read: true },
      },
      documentation: "https://mvm3dforge.vercel.app/studio",
    };
  }

  // Handle POST /mcp (JSON-RPC 2.0 requests)
  if (method === "POST") {
    setHeader(event, "Content-Type", "application/json");

    let body: any;
    try {
      body = await readBody(event);
    } catch {
      setResponseStatus(event, 400);
      return {
        jsonrpc: "2.0",
        id: null,
        error: { code: -32700, message: "Parse error: Invalid JSON was received by the server." },
      };
    }

    if (!body || typeof body !== "object" || body.jsonrpc !== "2.0") {
      setResponseStatus(event, 400);
      return {
        jsonrpc: "2.0",
        id: body?.id ?? null,
        error: { code: -32600, message: "Invalid Request: The JSON sent is not a valid JSON-RPC 2.0 Request object." },
      };
    }

    const { id, method: rpcMethod, params } = body;

    // Handle JSON-RPC methods
    switch (rpcMethod) {
      case "initialize": {
        return {
          jsonrpc: "2.0",
          id,
          result: {
            protocolVersion: params?.protocolVersion || "2024-11-05",
            capabilities: {
              tools: {},
              resources: {},
            },
            serverInfo: {
              name: "MvM 3D Forge Remote MCP Server",
              version: "1.0.0",
            },
          },
        };
      }

      case "notifications/initialized": {
        return { jsonrpc: "2.0", id, result: {} };
      }

      case "ping": {
        return { jsonrpc: "2.0", id, result: {} };
      }

      case "tools/list": {
        if (!checkScopePermission(auth.scopes, "project:read")) {
          return {
            jsonrpc: "2.0",
            id,
            error: { code: -32002, message: "Forbidden: Scope 'project:read' is required to list tools." },
          };
        }

        return {
          jsonrpc: "2.0",
          id,
          result: {
            tools: [
              {
                name: "list_projects",
                description: "List all authorized 3D projects",
                inputSchema: { type: "object", properties: {} },
              },
              {
                name: "get_project",
                description: "Retrieve complete project data",
                inputSchema: { type: "object", properties: { projectId: { type: "string" } } },
              },
              {
                name: "create_project",
                description: "Create a new 3D project or load a starter template",
                inputSchema: {
                  type: "object",
                  properties: {
                    name: { type: "string" },
                    starterId: { type: "string", enum: ["blank", "primitives", "pbr", "product", "animated"] },
                  },
                },
              },
              {
                name: "read_scene",
                description: "Read scene hierarchy, mesh objects, lights, and animation clips",
                inputSchema: { type: "object", properties: { projectId: { type: "string" } } },
              },
              {
                name: "inspect_object",
                description: "Inspect details of a specific scene object by ID or name",
                inputSchema: {
                  type: "object",
                  properties: { projectId: { type: "string" }, objectId: { type: "string" } },
                  required: ["objectId"],
                },
              },
              {
                name: "create_primitive",
                description: "Create a primitive mesh (box, sphere, cylinder, cone, torus, plane) in the scene",
                inputSchema: {
                  type: "object",
                  properties: {
                    projectId: { type: "string" },
                    kind: { type: "string", enum: ["box", "sphere", "cylinder", "cone", "torus", "plane"] },
                    name: { type: "string" },
                    position: { type: "array", items: { type: "number" }, minItems: 3, maxItems: 3 },
                    color: { type: "string" },
                    roughness: { type: "number" },
                    metalness: { type: "number" },
                  },
                  required: ["kind"],
                },
              },
              {
                name: "update_object",
                description: "Update position, rotation, scale, name, visibility, or material of an object",
                inputSchema: {
                  type: "object",
                  properties: {
                    projectId: { type: "string" },
                    objectId: { type: "string" },
                    position: { type: "array", items: { type: "number" }, minItems: 3, maxItems: 3 },
                    rotation: { type: "array", items: { type: "number" }, minItems: 3, maxItems: 3 },
                    scale: { type: "array", items: { type: "number" }, minItems: 3, maxItems: 3 },
                    visible: { type: "boolean" },
                    color: { type: "string" },
                    roughness: { type: "number" },
                    metalness: { type: "number" },
                  },
                  required: ["objectId"],
                },
              },
              {
                name: "delete_object",
                description: "Delete an object from the project scene graph",
                inputSchema: {
                  type: "object",
                  properties: { projectId: { type: "string" }, objectId: { type: "string" } },
                  required: ["objectId"],
                },
              },
              {
                name: "create_light",
                description: "Add a light source to the scene",
                inputSchema: {
                  type: "object",
                  properties: {
                    projectId: { type: "string" },
                    kind: { type: "string", enum: ["ambient", "directional", "point", "spot"] },
                    color: { type: "string" },
                    intensity: { type: "number" },
                  },
                  required: ["kind"],
                },
              },
              {
                name: "export_project_glb",
                description: "Export the 3D scene as binary glTF (GLB) file metadata",
                inputSchema: { type: "object", properties: { projectId: { type: "string" } } },
              },
            ],
          },
        };
      }

      case "tools/call": {
        const toolName = params?.name;
        const toolArgs = params?.arguments || {};

        // Scope verification
        const isMutationTool = ["create_project", "create_primitive", "update_object", "delete_object", "create_light"].includes(toolName);
        const requiredScope = isMutationTool ? "scene:write" : toolName === "export_project_glb" ? "assets:export" : "project:read";

        if (!checkScopePermission(auth.scopes, requiredScope)) {
          return {
            jsonrpc: "2.0",
            id,
            error: { code: -32002, message: `Forbidden: Required scope '${requiredScope}' missing for tool '${toolName}'.` },
          };
        }

        try {
          const proj = getOrCreateProject(toolArgs.projectId);

          // Ownership verification
          if (!verifyProjectOwnership(auth.userId, proj.author)) {
            return {
              jsonrpc: "2.0",
              id,
              error: { code: -32003, message: `Forbidden: You do not have ownership access to project '${proj.id}'.` },
            };
          }

          if (toolName === "read_scene") {
            return {
              jsonrpc: "2.0",
              id,
              result: {
                content: [
                  {
                    type: "text",
                    text: JSON.stringify({ status: "success", scene: proj }, null, 2),
                  },
                ],
              },
            };
          }

          if (toolName === "create_primitive") {
            const kind = toolArgs.kind || "box";
            const name = toolArgs.name || `${kind} object`;
            const pos = toolArgs.position || [0, 0, 0];
            const color = toolArgs.color || "#83f0ce";

            const newMesh = makeNode({
              id: `mesh_${kind}_${Date.now()}`,
              name,
              type: "mesh",
              position: pos as [number, number, number],
              rotation: [0, 0, 0],
              scale: [1, 1, 1],
              visible: true,
              geometry: { kind: "box", width: 1, height: 1, depth: 1, widthSegments: 1, heightSegments: 1, depthSegments: 1 },
              material: defaultMaterial({ name: `${name}Mat`, color, roughness: 0.3, metalness: 0.2 }),
            });

            proj.objects.push(newMesh);

            return {
              jsonrpc: "2.0",
              id,
              result: {
                content: [
                  {
                    type: "text",
                    text: JSON.stringify({ status: "success", createdObject: newMesh }, null, 2),
                  },
                ],
              },
            };
          }

          if (toolName === "update_object") {
            const objectId = toolArgs.objectId;
            const node = proj.objects.find((o) => o.id === objectId || o.name === objectId);
            if (!node) {
              return {
                jsonrpc: "2.0",
                id,
                error: { code: -32602, message: `Object '${objectId}' not found in project.` },
              };
            }

            if (toolArgs.position) node.position = toolArgs.position;
            if (toolArgs.rotation) node.rotation = toolArgs.rotation;
            if (toolArgs.scale) node.scale = toolArgs.scale;
            if (toolArgs.visible !== undefined) node.visible = toolArgs.visible;
            if (toolArgs.color && node.material) node.material.color = toolArgs.color;

            return {
              jsonrpc: "2.0",
              id,
              result: {
                content: [
                  {
                    type: "text",
                    text: JSON.stringify({ status: "success", updatedObject: node }, null, 2),
                  },
                ],
              },
            };
          }

          if (toolName === "delete_object") {
            const objectId = toolArgs.objectId;
            proj.objects = proj.objects.filter((o) => o.id !== objectId && o.name !== objectId);
            return {
              jsonrpc: "2.0",
              id,
              result: {
                content: [
                  {
                    type: "text",
                    text: JSON.stringify({ status: "success", deletedObjectId: objectId }, null, 2),
                  },
                ],
              },
            };
          }

          if (toolName === "list_projects") {
            return {
              jsonrpc: "2.0",
              id,
              result: {
                content: [
                  {
                    type: "text",
                    text: JSON.stringify({ status: "success", projects: [{ id: proj.id, name: proj.name }] }, null, 2),
                  },
                ],
              },
            };
          }

          return {
            jsonrpc: "2.0",
            id,
            error: { code: -32601, message: `Method or tool '${toolName}' not found.` },
          };
        } catch (err: any) {
          return {
            jsonrpc: "2.0",
            id,
            error: { code: -32603, message: `Internal MCP tool error: ${err.message}` },
          };
        }
      }

      case "resources/list": {
        return {
          jsonrpc: "2.0",
          id,
          result: {
            resources: [
              {
                uri: "mvm://scene/summary",
                name: "Scene Summary",
                mimeType: "application/json",
                description: "JSON summary of current scene graph and objects",
              },
            ],
          },
        };
      }

      case "resources/read": {
        const uri = params?.uri;
        if (uri === "mvm://scene/summary") {
          const proj = getOrCreateProject();
          return {
            jsonrpc: "2.0",
            id,
            result: {
              contents: [
                {
                  uri: "mvm://scene/summary",
                  mimeType: "application/json",
                  text: buildMCPSceneResource(proj),
                },
              ],
            },
          };
        }
        return {
          jsonrpc: "2.0",
          id,
          error: { code: -32602, message: `Resource URI '${uri}' not found.` },
        };
      }

      default: {
        return {
          jsonrpc: "2.0",
          id,
          error: { code: -32601, message: `Method '${rpcMethod}' not supported.` },
        };
      }
    }
  }

  setResponseStatus(event, 405);
  return { error: "Method Not Allowed" };
});
