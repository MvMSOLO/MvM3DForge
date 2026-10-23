import type { brand } from "./brand.ts";

export type Vec3 = [number, number, number];

export type GeometrySpec =
  | {
      kind: "box";
      width: number;
      height: number;
      depth: number;
      widthSegments: number;
      heightSegments: number;
      depthSegments: number;
    }
  | { kind: "sphere"; radius: number; widthSegments: number; heightSegments: number }
  | {
      kind: "cylinder";
      radiusTop: number;
      radiusBottom: number;
      height: number;
      radialSegments: number;
      openEnded: boolean;
    }
  | { kind: "cone"; radius: number; height: number; radialSegments: number }
  | {
      kind: "torus";
      radius: number;
      tube: number;
      radialSegments: number;
      tubularSegments: number;
    }
  | {
      kind: "plane";
      width: number;
      height: number;
      widthSegments: number;
      heightSegments: number;
    }
  | {
      kind: "capsule";
      radius: number;
      length: number;
      capSegments: number;
      radialSegments: number;
    }
  | {
      kind: "custom";
      positions: number[];
      indices?: number[];
      normals?: number[];
      uvs?: number[];
    };

export type AlphaMode = "OPAQUE" | "BLEND" | "MASK";
export type MaterialSide = "front" | "back" | "double";
export type TextureWrap = "repeat" | "clamp";
export type TextureColorSpace = "srgb" | "linear";
export type TextureGenerator = "checker" | "stripes" | "dots" | "gradient" | "noise" | "solid";

export type MaterialSpec = {
  /** Optional display/export name supplied through mvm.material.pbr({ name }). */
  name?: string;
  color: string;
  roughness: number;
  metalness: number;
  opacity: number;
  emissive: string;
  emissiveIntensity: number;
  /** MeshPhysicalMaterial values; optional for backward-compatible older project files. */
  clearcoat?: number;
  clearcoatRoughness?: number;
  transmission?: number;
  ior?: number;
  thickness?: number;
  sheen?: number;
  sheenRoughness?: number;
  sheenColor?: string;
  /** Normal map intensity. Zero disables normal-map effect; defaults to 1. */
  normalScale?: number;
  /** Optional PBR texture channels. Missing IDs mean the channel is untextured. */
  emissiveMapId?: string | null;
  clearcoatMapId?: string | null;
  clearcoatRoughnessMapId?: string | null;
  transmissionMapId?: string | null;
  thicknessMapId?: string | null;
  sheenColorMapId?: string | null;
  alphaMode: AlphaMode;
  alphaCutoff: number;
  side: MaterialSide;
  mapId: string | null;
  normalMapId: string | null;
  aoMapId: string | null;
  roughnessMapId: string | null;
  metalnessMapId: string | null;
  repeat: [number, number];
  offset: [number, number];
  rotation: number;
  wrap: TextureWrap;
};

export type LightSpec = {
  kind: "ambient" | "hemisphere" | "directional" | "point" | "spot";
  color: string;
  intensity: number;
  groundColor?: string;
  distance?: number;
  decay?: number;
  angle?: number;
  penumbra?: number;
  castShadow?: boolean;
  target?: Vec3;
};

export type TextureAsset = {
  id: string;
  name: string;
  source: "script" | "import" | "user";
  colorSpace: TextureColorSpace;
  width: number;
  height: number;
  dataUrl?: string;
  generator?: TextureGenerator;
  params?: Record<string, string | number>;
};

export type NodeSource = "script" | "manual" | "editor" | "import";

export type MeshStats = {
  vertices: number;
  triangles: number;
  hasUV: boolean;
  hasNormals: boolean;
  bboxMin: Vec3;
  bboxMax: Vec3;
};

export type AnimProperty = "position" | "rotation" | "scale" | "quaternion";

export type AnimKeyframe = {
  time: number;
  value: number[];
};

export type AnimTrack = {
  id: string;
  objectId: string;
  property: AnimProperty;
  interpolation: "linear" | "smooth" | "step";
  keyframes: AnimKeyframe[];
};

export type AnimClip = {
  id: string;
  name: string;
  duration: number;
  loop: boolean;
  tracks: AnimTrack[];
  source: "script" | "import" | "user";
};

export type SceneNode = {
  id: string;
  name: string;
  type: "mesh" | "group" | "light" | "camera";
  parentId: string | null;
  source: NodeSource;
  visible: boolean;
  locked: boolean;
  /** Local position in metres. */
  position: Vec3;
  /** Local Euler XYZ in degrees. */
  rotation: Vec3;
  scale: Vec3;
  geometry?: GeometrySpec;
  material?: MaterialSpec;
  light?: LightSpec;
  /** True when the user edited transform/material after the last script run. */
  scriptDirty?: boolean;
  stats?: MeshStats;
};

export type CameraState = {
  type: "perspective" | "orthographic";
  fov: number;
  near: number;
  far: number;
  position: Vec3;
  target: Vec3;
  orthoSize: number;
};

export type EnvironmentPreset = "studio" | "neutral" | "city" | "sunset" | "warehouse" | "none";

export type SceneSettings = {
  background: string;
  grid: boolean;
  axes: boolean;
  shadows: boolean;
  environment: EnvironmentPreset;
  /** Optional HDR/EXR or equirectangular image URL for custom IBL (code-first, no AI). */
  environmentUrl?: string | null;
  exposure: number;
  camera: CameraState;
};

export type Project = {
  id: string;
  name: string;
  schemaVersion: typeof brand.schemaVersion;
  apiVersion: string;
  appVersion: string;
  createdAt: number;
  updatedAt: number;
  code: string;
  codeLanguage: "javascript";
  author: string;
  objects: SceneNode[];
  textures: TextureAsset[];
  clips: AnimClip[];
  /** Script-requested clip to start in the viewport. */
  autoplayClipId?: string | null;
  scene: SceneSettings;
  description: string;
};

export type LogEntry = {
  id: string;
  level: "log" | "info" | "warn" | "error";
  message: string;
  timestamp: number;
};

export type IssueSeverity = "error" | "warning" | "info";

export type ForgeIssue = {
  code: string;
  message: string;
  severity: IssueSeverity;
  line?: number;
  column?: number;
  recoveryHint?: string;
  context?: Record<string, string | number | boolean | null>;
  timestamp: number;
};

export type ExportRequest = {
  filename?: string;
  visibleOnly?: boolean;
  includeAnimations?: boolean;
};

export type ScriptSceneMutation = "none" | "replace" | "clear";

export type ScriptPatch = {
  /** Whether the script generated a scene, explicitly cleared it, or only changed settings/assets. */
  sceneMutation?: ScriptSceneMutation;
  objects: SceneNode[];
  textures: TextureAsset[];
  clips: AnimClip[];
  background?: string;
  environment?: EnvironmentPreset;
  environmentUrl?: string | null;
  exposure?: number;
  camera?: CameraState;
  projectName?: string;
  exportRequest?: ExportRequest | null;
  autoplayClipId?: string | null;
  issues: ForgeIssue[];
};

export type RunSuccess = { ok: true; patch: ScriptPatch; logs: LogEntry[] };
export type RunFailure = { ok: false; error: ForgeIssue; logs: LogEntry[]; issues: ForgeIssue[] };
export type RunResult = RunSuccess | RunFailure;

export type ToolId = "select" | "move" | "rotate" | "scale";
export type ViewMode = "solid" | "wireframe" | "material";
export type DockTab = "code" | "console" | "assets" | "timeline";
export type MobilePanel = "viewport" | "code" | "objects" | "inspect" | "assets" | "timeline";
export type Quality = "low" | "balanced" | "high";
export type MotionPref = "full" | "reduced" | "minimal";

export type UserPrefs = {
  motion: MotionPref;
  sound: boolean;
  volume: number;
  quality: Quality;
  /** When false, Run stages a preview until Apply. When true, Run commits immediately. */
  autoApply: boolean;
};

export type ExportSummary = {
  filename: string;
  bytes: number;
  meshes: number;
  triangles: number;
  materials: number;
  textures: number;
  animations: number;
  lights: number;
  cameras: number;
  warnings: ForgeIssue[];
  roundTripOk: boolean;
  roundTripNote: string;
  importedMeshes?: number;
  importedAnimations?: number;
  importedMaterials?: number;
  extensions: string[];
};

export type ViewCommand =
  | { id: number; type: "frame-selected" }
  | { id: number; type: "frame-all" }
  | { id: number; type: "preset"; preset: CameraPreset }
  | { id: number; type: "reset-transform" };

export type CameraPreset = "front" | "back" | "left" | "right" | "top" | "three-quarter";
