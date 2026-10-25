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

const MCP_APPS_VIEW_URI = "ui://mvm3d/viewport.html";
const MCP_APPS_VIEW_HTML = "<!doctype html><html lang=\"en\"><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\"><title>MVM3D AI Viewport</title><style>\n:root{color-scheme:dark;--bg:#081019;--panel:#0d1823;--line:rgba(196,220,236,.14);--text:#eef7fb;--muted:#91a8b8;--mint:#83f0ce;--amber:#f3cb83;--red:#ff9f9f}*{box-sizing:border-box}body{margin:0;padding:12px;background:var(--bg);color:var(--text);font:13px/1.5 system-ui,-apple-system,\"Segoe UI\",sans-serif}.shell{overflow:hidden;border:1px solid var(--line);border-radius:16px;background:linear-gradient(155deg,rgba(131,240,206,.04),transparent 45%),var(--panel)}header{display:flex;justify-content:space-between;align-items:center;gap:10px;padding:13px 15px;border-bottom:1px solid var(--line)}.brand{font-size:11px;font-weight:800;letter-spacing:.16em}.brand span{color:var(--mint)}.eyebrow{margin-top:3px;font-size:9px;text-transform:uppercase;letter-spacing:.17em;color:var(--muted)}.pill{white-space:nowrap;border:1px solid rgba(131,240,206,.3);border-radius:999px;background:rgba(131,240,206,.07);padding:4px 8px;color:var(--mint);font-size:9px}.main{padding:14px}.title{font-size:16px;font-weight:750;line-height:1.3;letter-spacing:-.02em}.desc{margin-top:4px;color:var(--muted);font-size:11px}.preview{position:relative;display:grid;place-items:center;min-height:180px;max-height:560px;overflow:hidden;margin-top:13px;border:1px solid var(--line);border-radius:12px;background:radial-gradient(ellipse at 50% 35%,rgba(83,127,160,.18),transparent 58%),#080d13}.preview:before{content:\"\";position:absolute;inset:0;pointer-events:none;opacity:.22;background-image:linear-gradient(rgba(160,190,210,.15) 1px,transparent 1px),linear-gradient(90deg,rgba(160,190,210,.15) 1px,transparent 1px);background-size:28px 28px;mask-image:linear-gradient(to bottom,black,transparent)}#shot{display:none;position:relative;z-index:1;max-width:100%;max-height:540px;object-fit:contain}.empty{position:relative;z-index:1;max-width:330px;padding:26px;text-align:center;color:var(--muted)}.orb{display:grid;place-items:center;width:38px;height:38px;margin:0 auto 10px;border:1px solid rgba(131,240,206,.3);border-radius:12px;background:rgba(131,240,206,.06);color:var(--mint);font-size:19px}.metrics{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;margin-top:10px}.metric{min-width:0;padding:9px;border:1px solid var(--line);border-radius:10px;background:rgba(0,0,0,.12)}.label{font-size:8px;text-transform:uppercase;letter-spacing:.14em;color:var(--muted)}.value{margin-top:4px;overflow:hidden;font-size:10px;font-weight:650;white-space:nowrap;text-overflow:ellipsis}.logs{display:none;margin-top:10px;padding:10px;border:1px solid var(--line);border-radius:10px;background:rgba(0,0,0,.14)}pre{max-height:150px;overflow:auto;margin:6px 0 0;white-space:pre-wrap;word-break:break-word;font:10px/1.5 ui-monospace,Consolas,monospace;color:#c8d9e5}.actions{display:flex;flex-wrap:wrap;gap:8px;margin-top:12px}.btn{border:1px solid var(--line);border-radius:9px;padding:8px 11px;background:rgba(255,255,255,.025);color:#d9e5eb;font:600 10px system-ui;cursor:pointer}.primary{border-color:transparent;background:var(--mint);color:#071511}.btn:disabled{opacity:.4;cursor:default}.foot{display:flex;gap:7px;margin-top:11px;color:var(--muted);font-size:9px}.dot{flex:none;width:6px;height:6px;margin-top:5px;border-radius:50%;background:var(--mint)}.mono{font-family:ui-monospace,Consolas,monospace}@media(max-width:360px){.metrics{grid-template-columns:1fr}}\n</style></head><body><div class=\"shell\"><header><div><div class=\"brand\">MVM <span>3D</span> / AIS</div><div class=\"eyebrow\">Visual execution bridge</div></div><div id=\"state\" class=\"pill\">Connecting…</div></header><main class=\"main\"><div class=\"title\" id=\"title\">Waiting for the first result</div><div class=\"desc\" id=\"desc\">Call a viewport or image tool to display its real result here.</div><div class=\"preview\"><img id=\"shot\" alt=\"Actual MVM3D viewport screenshot\"><div class=\"empty\" id=\"empty\"><div class=\"orb\">◇</div><strong id=\"empty-title\">Your 3D preview appears here</strong><div id=\"empty-text\" style=\"margin-top:6px;font-size:10px\">This panel displays the image returned by the connected MCP tool. It does not generate a fake render.</div></div></div><div class=\"metrics\"><div class=\"metric\"><div class=\"label\">Job status</div><div id=\"job-status\" class=\"value\">—</div></div><div class=\"metric\"><div class=\"label\">Project</div><div id=\"project\" class=\"value mono\">—</div></div><div class=\"metric\"><div class=\"label\">Job / asset</div><div id=\"kind\" class=\"value\">—</div></div></div><div id=\"logs\" class=\"logs\"><div class=\"label\">Execution details</div><pre id=\"log-text\"></pre></div><div class=\"actions\"><button id=\"ask\" class=\"btn primary\" type=\"button\" disabled>Ask AI to inspect / improve</button><button id=\"studio\" class=\"btn\" type=\"button\">Open MVM3D Studio ↗</button></div><div class=\"foot\"><span class=\"dot\"></span><span id=\"foot-text\">Ready to receive MCP tool results. Clients without MCP Apps UI still receive standard text and image blocks.</span></div></main></div>\n<script>\n(function(){\"use strict\";var nextId=1,pending=Object.create(null),lastSummary=null,lastImage=null,toolInput=null;function el(id){return document.getElementById(id)}function state(text,tone){el(\"state\").textContent=text;el(\"state\").style.color=tone===\"red\"?\"var(--red)\":tone===\"amber\"?\"var(--amber)\":\"var(--mint)\";el(\"state\").style.borderColor=tone===\"red\"?\"rgba(255,159,159,.3)\":tone===\"amber\"?\"rgba(243,203,131,.3)\":\"rgba(131,240,206,.3)\"}function request(method,params){return new Promise(function(resolve,reject){var id=nextId++,timer=setTimeout(function(){delete pending[id];reject(new Error(\"Host request timed out\"))},5000);pending[id]={resolve:resolve,reject:reject,timer:timer};window.parent.postMessage({jsonrpc:\"2.0\",id:id,method:method,params:params||{}},\"*\")})}function notify(method,params){window.parent.postMessage({jsonrpc:\"2.0\",method:method,params:params||{}},\"*\")}function summaryFrom(content){for(var i=0;i<content.length;i++){if(content[i]&&content[i].type===\"text\"&&typeof content[i].text===\"string\"){try{return JSON.parse(content[i].text)}catch(_){}}}return null}function render(result){var content=result&&Array.isArray(result.content)?result.content:[];lastSummary=summaryFrom(content);lastImage=null;for(var i=0;i<content.length;i++){var item=content[i];if(item&&item.type===\"image\"&&typeof item.data===\"string\"&&typeof item.mimeType===\"string\"){lastImage=\"data:\"+item.mimeType+\";base64,\"+item.data;break}}var s=lastSummary;if(lastImage){el(\"shot\").src=lastImage;el(\"shot\").style.display=\"block\";el(\"empty\").style.display=\"none\";el(\"title\").textContent=s&&s.status===\"completed\"?\"3D viewport · completed\":\"Visual result returned\";el(\"desc\").textContent=\"This is the actual image block returned by MVM3D.\"}else{el(\"shot\").removeAttribute(\"src\");el(\"shot\").style.display=\"none\";el(\"empty\").style.display=\"block\";el(\"title\").textContent=s&&s.waitingForStudio?\"Waiting for the Studio browser worker\":s&&s.status===\"failed\"?\"Execution failed\":\"Tool result received\";el(\"empty-title\").textContent=s&&s.waitingForStudio?\"Studio has not returned a frame yet\":\"No viewport image in this response\";el(\"empty-text\").textContent=s&&s.waitingForStudio?\"Keep the exact saved project open in Studio, then call get_execution_job again after the job finishes.\":\"This response may contain a reference image or a pending job. Check the details below.\"}el(\"job-status\").textContent=s&&s.status||\"image / reference\";el(\"project\").textContent=s&&s.projectId||toolInput&&toolInput.projectId||\"—\";el(\"kind\").textContent=s&&s.kind||toolInput&&toolInput.textureId||\"tool result\";var info=[];if(s&&s.error)info.push(\"Error: \"+s.error);if(s&&s.result)info.push(JSON.stringify(s.result,null,2));if(result&&result.isError)info.push(\"MCP reported this tool call as an error.\");if(!info.length&&!s){for(var j=0;j<content.length;j++){if(content[j]&&content[j].type===\"text\"&&content[j].text)info.push(content[j].text)}}el(\"logs\").style.display=info.length?\"block\":\"none\";el(\"log-text\").textContent=info.join(\"\\n\\n\").slice(0,12000);el(\"ask\").disabled=false;if(result&&result.isError||s&&s.status===\"failed\"){state(\"Execution error\",\"red\");el(\"foot-text\").textContent=\"Review the error, then ask the AI to fix the scene and rerun preview.\"}else if(s&&s.waitingForStudio){state(\"Waiting for Studio\",\"amber\");el(\"foot-text\").textContent=\"Keep the matching saved project open in Studio and have the AI poll get_execution_job until the screenshot arrives.\"}else if(lastImage){state(\"Real image returned\",\"\");el(\"foot-text\").textContent=\"The screenshot/reference is available inside this panel and in the tool's image content. Ask the AI to inspect it, make corrections, and render again.\"}else{state(\"Tool result ready\",\"\");el(\"foot-text\").textContent=\"If this was a reference image, the connected AI should inspect it and then call create_3d_from_image in preview mode.\"}}window.addEventListener(\"message\",function(event){if(event.source!==window.parent)return;var m=event.data;if(!m||typeof m!==\"object\")return;if(m.id!==undefined&&pending[m.id]){var p=pending[m.id];delete pending[m.id];clearTimeout(p.timer);if(m.error)p.reject(new Error(m.error.message||\"Host request failed\"));else p.resolve(m.result);return}if(m.method===\"ui/notifications/tool-input\"){toolInput=m.params&&m.params.arguments||{};if(toolInput.jobId)el(\"desc\").textContent=\"Execution job \"+toolInput.jobId+\" · waiting for tool result…\"}if(m.method===\"ui/notifications/tool-input-partial\"){toolInput=m.params&&m.params.arguments||toolInput}if(m.method===\"ui/notifications/tool-result\")render(m.params||{});if(m.method===\"ui/notifications/tool-cancelled\"){state(\"Tool cancelled\",\"amber\");el(\"foot-text\").textContent=m.params&&m.params.reason||\"The host cancelled this tool call.\"}if(m.method===\"ui/notifications/host-context-changed\"&&m.params&&m.params.theme){document.documentElement.style.colorScheme=m.params.theme}if(m.method===\"ui/resource-teardown\"&&m.id!==undefined)window.parent.postMessage({jsonrpc:\"2.0\",id:m.id,result:{}},\"*\")});el(\"ask\").addEventListener(\"click\",function(){var prompt=\"Inspect the latest MVM3D visual result shown in the AIS viewport. Use the actual returned image, not only source code. \";if(lastSummary&&lastSummary.status)prompt+=\"Current job status: \"+lastSummary.status+\". \";if(lastSummary&&lastSummary.error)prompt+=\"Reported error: \"+lastSummary.error+\". \";prompt+=\"If the scene is wrong, diagnose it, call run_script or create_3d_from_image in preview mode, poll get_execution_job until completed, inspect the next screenshot, and iterate. Do not apply changes until I approve.\";request(\"ui/message\",{role:\"user\",content:{type:\"text\",text:prompt}}).then(function(){state(\"Improvement request sent\",\"\")}).catch(function(){state(\"Host message unsupported\",\"amber\");el(\"foot-text\").textContent=\"This client may not support UI-to-chat messages. Ask the AI directly to inspect the latest MCP image result.\"})});el(\"studio\").addEventListener(\"click\",function(){request(\"ui/open-link\",{url:\"https://mvm3d.vercel.app/studio\"}).catch(function(){state(\"Use Studio link\",\"amber\");el(\"foot-text\").textContent=\"Open https://mvm3d.vercel.app/studio in another tab. Keep the matching saved cloud project open while MCP jobs run.\"})});async function init(){try{await request(\"ui/initialize\",{protocolVersion:\"2026-01-26\",appInfo:{name:\"MVM3D AI Viewport\",version:\"1.0.0\"},appCapabilities:{availableDisplayModes:[\"inline\",\"fullscreen\"]}});notify(\"ui/notifications/initialized\",{});state(\"Connected\",\"\");el(\"foot-text\").textContent=\"Connected to the chat host. Results appear when a compatible host invokes this MCP tool.\"}catch(_){state(\"Image / text fallback\",\"amber\");el(\"foot-text\").textContent=\"This client may not support MCP Apps. Tools still return standard text and image content; ask get_execution_job for the actual screenshot.\"}}init()})();\n</script></body></html>";

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
    withViewportApp = false,
  ) {
    const callback = async (args: JsonRecord) => {
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
    };
    if (withViewportApp) {
      const appMeta = {
        ui: { resourceUri: MCP_APPS_VIEW_URI, visibility: ["model", "app"] },
        "ui/resourceUri": MCP_APPS_VIEW_URI,
      };
      (server as any).registerTool(name, { description, inputSchema: schema, _meta: appMeta }, callback);
    } else {
      server.tool(name, description, schema, callback);
    }
  }

  server.resource(
    "mvm3d-viewport-app",
    MCP_APPS_VIEW_URI,
    { description: "MVM3D visual viewport for real tool results", mimeType: "text/html;profile=mcp-app" },
    async () => ({
      contents: [{
        uri: MCP_APPS_VIEW_URI,
        mimeType: "text/html;profile=mcp-app",
        text: MCP_APPS_VIEW_HTML,
        _meta: { ui: { prefersBorder: true } },
      }],
    } as any),
  );

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


  register(
    "get_reference_image",
    "Return a saved Studio reference image as standard MCP image content so a vision-capable connected AI can actually inspect the pixels. Call this before reconstructing a 3D object from an image. The Studio stores image references as texture assets; this tool returns one image plus its metadata, not a fake AI analysis.",
    {
      projectId: z.string().min(1).optional(),
      textureId: z.string().min(1).optional(),
    },
    "project:read",
    async (args) => {
      const project = await getProject(args.projectId);
      const asset = project.textures.find((texture) =>
        (!args.textureId || texture.id === args.textureId) && typeof texture.dataUrl === "string",
      );
      if (!asset?.dataUrl) {
        throw new Error("No saved image reference was found. In Studio, use Import Image first, then call this tool again.");
      }
      const match = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/=\r\n]+)$/.exec(asset.dataUrl);
      if (!match) {
        throw new Error("This reference is not a supported PNG, JPEG, or WebP image. Re-import it as PNG/JPEG/WebP.");
      }
      const data = match[2].replace(/\s+/g, "");
      if (data.length > 2_900_000) {
        throw new Error("Reference image is too large to safely return to the AI client. Re-import an image under 2 MB.");
      }
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              projectId: project.id,
              projectName: project.name,
              textureId: asset.id,
              imageName: asset.name,
              width: asset.width,
              height: asset.height,
              instruction: "Inspect this image visually. Use its silhouette, proportions, major parts, colors, and visible details to build editable 3D geometry; do not simply place the flat reference plane into the final model.",
            }, null, 2),
          },
          { type: "image", mimeType: "image/" + match[1], data },
        ],
      };
    },
    true,
  );

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

  register(
    "get_ai_workflow",
    "Explain the supported AI workflow: inspect the scene, diagnose, run JavaScript in the open Studio browser sandbox, poll the job result, inspect the returned render screenshot, and iterate. The app does not call an AI model itself; any MCP-compatible AI client can orchestrate these tools.",
    {},
    "project:read",
    async () => ({
      endpoint: "/mcp",
      workflow: [
        "1. Call list_projects, then get_project or read_scene for the target project.",
        "1a. If a Studio image reference exists, call get_reference_image so the model receives actual MCP image content; use create_3d_from_image to queue a model-authored reconstruction for preview.",
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
    "create_3d_from_image",
    "Image-to-3D workbench tool. After visually inspecting the user's supplied image or calling get_reference_image, provide a concise visual analysis and complete JavaScript scene code. This queues that code in the project's real Studio browser sandbox. Default to preview, then call get_execution_job until it completes, inspect the returned viewport image, correct issues, and only use apply when the user approves. This tool does not call or pretend to contain a separate image-generation AI model; the connected AI supplies the visual reasoning and code.",
    {
      projectId: z.string().min(1),
      imageAnalysis: z.string().trim().min(1).max(6000),
      code: z.string().min(1).max(LIMITS.maxCodeChars),
      mode: z.enum(["preview", "apply"]).default("preview"),
    },
    "scene:execute",
    async (args) => {
      if (args.mode === "apply") requireScope("scene:write");
      const project = await repository.load(context.userId, args.projectId);
      if (!project || project.author !== context.userId) {
        throw new Error("Project not found or access denied.");
      }
      const job = await executionQueue.enqueue({
        userId: context.userId,
        projectId: project.id,
        kind: "script",
        code: args.code,
        applyChanges: args.mode === "apply",
        baseUpdatedAt: project.updatedAt,
      });
      return {
        jobId: job.id,
        status: job.status,
        mode: args.mode,
        projectId: job.projectId,
        projectRevision: job.baseUpdatedAt,
        imageAnalysis: args.imageAnalysis,
        needsOpenStudioTab: true,
        nextTool: "get_execution_job",
        instructions: "Keep the exact saved project open in Studio. Poll get_execution_job with this jobId until completed or failed. When completed, inspect the returned MCP image and logs. Iterate with preview if needed; apply changes only after the visual result is acceptable.",
      };
    },
    true,
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
    true,
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
    true,
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
