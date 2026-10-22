import { GLTFExporter } from "three/addons/exporters/GLTFExporter.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import * as THREE from "three";
import { ForgeError, issue } from "./errors.ts";
import { animationClips, assembleScene } from "./scene-three.ts";
import type { ExportSummary, ForgeIssue, Project } from "./types.ts";
import { validateScene } from "./validate.ts";

export type ExportOptions = {
  filename: string;
  visibleOnly: boolean;
  includeAnimations: boolean;
  copyright?: string;
  maxTextureSize?: number;
};

function glbJson(buffer: ArrayBuffer): { json: Record<string, unknown>; byteLength: number } {
  const view = new DataView(buffer);
  const magic = String.fromCharCode(view.getUint8(0), view.getUint8(1), view.getUint8(2), view.getUint8(3));
  if (magic !== "glTF") {
    throw new ForgeError("MVM_E_EXPORT_FAILED", "Exporter did not return a binary glTF. The file was not saved.", {
      recoveryHint: "This is an internal exporter failure, not a successful download.",
    });
  }
  const version = view.getUint32(4, true);
  const length = view.getUint32(8, true);
  if (version !== 2 || length !== buffer.byteLength) {
    throw new ForgeError("MVM_E_EXPORT_FAILED", `Unexpected glB header (version ${version}, length ${length}).`, {
      recoveryHint: "Do not use this buffer as a .glb file.",
    });
  }
  const chunkLength = view.getUint32(12, true);
  const chunkType = view.getUint32(16, true);
  if (chunkType !== 0x4e4f534a) {
    throw new ForgeError("MVM_E_EXPORT_FAILED", "The first glB chunk is not JSON.", {
      recoveryHint: "Export stopped before download.",
    });
  }
  const jsonText = new TextDecoder().decode(new Uint8Array(buffer, 20, chunkLength));
  return { json: JSON.parse(jsonText) as Record<string, unknown>, byteLength: buffer.byteLength };
}

function ensureFileReader() {
  if (typeof globalThis.FileReader !== "undefined") return;
  class FileReaderPolyfill {
    result: ArrayBuffer | string | null = null;
    onloadend: null | (() => void) = null;
    readAsArrayBuffer(blob: Blob) {
      void blob.arrayBuffer().then((buffer) => {
        this.result = buffer;
        this.onloadend?.();
      });
    }
    readAsDataURL(blob: Blob) {
      void blob.arrayBuffer().then((buffer) => {
        const bytes = new Uint8Array(buffer);
        let binary = "";
        for (let index = 0; index < bytes.length; index += 0x2000) {
          binary += String.fromCharCode(...bytes.subarray(index, index + 0x2000));
        }
        this.result = `data:application/octet-stream;base64,${btoa(binary)}`;
        this.onloadend?.();
      });
    }
  }
  Object.defineProperty(globalThis, "FileReader", { value: FileReaderPolyfill, configurable: true });
}
  project: Project,
  options: ExportOptions,
): Promise<{ buffer: ArrayBuffer; summary: ExportSummary; issues: ForgeIssue[] }> {
  const issues = validateScene({
    objects: options.visibleOnly ? project.objects.filter((node) => node.visible) : project.objects,
    textures: project.textures,
    clips: options.includeAnimations ? project.clips : [],
  });
  const blocking = issues.filter((item) => item.severity === "error" && item.code !== "MVM_E_EXPORT_EMPTY");
  if (issues.some((item) => item.code === "MVM_E_EXPORT_EMPTY")) {
    throw new ForgeError("MVM_E_EXPORT_EMPTY", "There is no mesh to export.", {
      recoveryHint: options.visibleOnly
        ? "Turn objects visible, or export with hidden objects included."
        : "Add a mesh, then export again.",
    });
  }
  if (blocking.length) {
    throw new ForgeError(blocking[0].code, blocking[0].message, {
      recoveryHint: blocking[0].recoveryHint,
    });
  }

  const built = await assembleScene(project, {
    mode: "material",
    shadows: false,
    onlyVisible: options.visibleOnly,
  });
  const camera =
    project.scene.camera.type === "orthographic"
      ? new THREE.OrthographicCamera(-1, 1, 1, -1, project.scene.camera.near, project.scene.camera.far)
      : new THREE.PerspectiveCamera(
          project.scene.camera.fov,
          1,
          project.scene.camera.near,
          project.scene.camera.far,
        );
  camera.name = "Viewport Camera";
  camera.position.set(
    project.scene.camera.position[0],
    project.scene.camera.position[1],
    project.scene.camera.position[2],
  );
  built.scene.add(camera);
  const clips = options.includeAnimations ? animationClips(project, built.byId) : [];
  const exporter = new GLTFExporter();
  let raw: ArrayBuffer | { [key: string]: unknown };
  try {
    raw = await exporter.parseAsync(built.scene, {
      binary: true,
      onlyVisible: options.visibleOnly,
      embedImages: true,
      maxTextureSize: options.maxTextureSize ?? 2048,
      animations: clips,
      copyright: options.copyright?.trim() || undefined,
    });
  } catch (error) {
    throw new ForgeError("MVM_E_EXPORT_FAILED", error instanceof Error ? error.message : "GLB export failed.", {
      recoveryHint: "Check non-finite transforms and texture sizes. Nothing was downloaded.",
    });
  }
  if (!(raw instanceof ArrayBuffer)) {
    throw new ForgeError("MVM_E_EXPORT_FAILED", "Exporter returned JSON instead of a binary GLB.", {
      recoveryHint: "Binary mode was requested. The file was not downloaded.",
    });
  }
  const parsed = glbJson(raw);
  const smoke = await smokeImport(raw);
  const meshes = Array.isArray(parsed.json.meshes) ? parsed.json.meshes.length : 0;
  const materials = Array.isArray(parsed.json.materials) ? parsed.json.materials.length : 0;
  const textures = Array.isArray(parsed.json.textures) ? parsed.json.textures.length : 0;
  const animations = Array.isArray(parsed.json.animations) ? parsed.json.animations.length : 0;
  const extensions = Object.keys((parsed.json.extensionsUsed as Record<string, unknown>) ?? {});
  const nodes = Array.isArray(parsed.json.nodes) ? (parsed.json.nodes as { camera?: number; extensions?: Record<string, unknown> }[]) : [];
  const cameras = nodes.filter((node) => node.camera !== undefined).length;
  const lights = nodes.filter((node) => node.extensions && "KHR_lights_punctual" in node.extensions).length;
  let triangles = 0;
  for (const node of project.objects) {
    if (options.visibleOnly && !node.visible) continue;
    if (node.type === "mesh") triangles += node.stats?.triangles ?? 0;
  }
  const summary: ExportSummary = {
    filename: options.filename.endsWith(".glb") ? options.filename : `${options.filename}.glb`,
    bytes: raw.byteLength,
    meshes,
    triangles: Math.round(triangles),
    materials,
    textures,
    animations,
    lights,
    cameras,
    warnings: issues.filter((item) => item.severity === "warning"),
    roundTripOk: smoke.ok,
    roundTripNote: smoke.note,
    importedMeshes: smoke.meshes,
    importedAnimations: smoke.animations,
    importedMaterials: smoke.materials,
    extensions,
  };
  if (!smoke.ok) {
    throw new ForgeError("MVM_E_EXPORT_FAILED", smoke.note, {
      recoveryHint: "The binary was produced but failed to load back. It was not downloaded.",
    });
  }
  return { buffer: raw, summary, issues };
}

function smokeImport(buffer: ArrayBuffer): Promise<{ ok: boolean; note: string; meshes: number; animations: number; materials: number }> {
  return new Promise((resolve) => {
    const loader = new GLTFLoader();
    loader.parse(
      buffer,
      "",
      (gltf) => {
        let meshes = 0;
        gltf.scene.traverse((object) => {
          if ((object as THREE.Mesh).isMesh) meshes += 1;
        });
        resolve({
          ok: true,
          note: `Re-import loaded ${meshes} mesh(es) and ${gltf.animations.length} clip(s).`,
          meshes,
          animations: gltf.animations.length,
          materials: gltf.parser ? 0 : 0,
        });
      },
      (error) => {
        resolve({
          ok: false,
          note: `Re-import failed: ${error instanceof Error ? error.message : String(error)}`,
          meshes: 0,
          animations: 0,
          materials: 0,
        });
      },
    );
  });
}

export function triggerDownload(buffer: ArrayBuffer, filename: string) {
  const blob = new Blob([buffer], { type: "model/gltf-binary" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export function issueFromUnknown(error: unknown): ForgeIssue {
  if (error instanceof ForgeError) {
    return issue(error.code, error.message, { recoveryHint: error.recoveryHint, context: error.context });
  }
  return issue("MVM_E_EXPORT_FAILED", error instanceof Error ? error.message : String(error), {
    recoveryHint: "Nothing was downloaded.",
  });
}
