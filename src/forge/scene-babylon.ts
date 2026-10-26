import {
  Animation,
  ArcRotateCamera,
  Color3,
  Color4,
  CubeTexture,
  DirectionalLight,
  Engine,
  HDRCubeTexture,
  HemisphericLight,
  Light,
  Material,
  Mesh,
  MeshBuilder,
  PBRMaterial,
  PointLight,
  Quaternion,
  RawTexture,
  Scene,
  ShadowGenerator,
  SpotLight,
  Texture,
  TransformNode,
  Vector3,
  VertexData,
  WebGPUEngine,
} from "@babylonjs/core";
import type { MaterialSpec, Project, SceneNode, TextureAsset, ViewMode } from "./types.ts";
import { rasterizeTexture } from "./textures.ts";

/**
 * MVM BABYLON is a renderer backend for Forge's validated, engine-neutral project scene.
 * The authoring schema remains the source of truth so existing projects and MCP jobs are
 * not destructively migrated when a renderer is switched.
 */
export type BabylonViewportHandle = {
  backend: "WebGPU" | "WebGL";
  dispose: () => void;
  setPlayback: (playing: boolean, clipId: string | null) => void;
};

export type BabylonViewportOptions = {
  mode: ViewMode;
  onFrame?: (canvas: HTMLCanvasElement) => void;
  onBackend?: (backend: "WebGPU" | "WebGL") => void;
  onWarning?: (message: string) => void;
};

export type BabylonMaterialState = {
  color: string;
  roughness: number;
  metallic: number;
  opacity: number;
  emissive: string;
  emissiveIntensity: number;
  clearcoat: number;
  clearcoatRoughness: number;
  transmission: number;
  ior: number;
  thickness: number;
  sheen: number;
  sheenRoughness: number;
  sheenColor: string;
  textureIds: Partial<Record<keyof MaterialSpec, string | null | undefined>>;
};

/** Pure conversion used by both the renderer and its regression tests. */
export function toBabylonMaterialState(
  spec: MaterialSpec,
  mode: ViewMode,
): BabylonMaterialState {
  const shaded = mode === "material";
  return {
    color: spec.color,
    roughness: shaded ? spec.roughness : 0.84,
    metallic: shaded ? spec.metalness : 0,
    opacity: spec.opacity,
    emissive: shaded ? spec.emissive : "#000000",
    emissiveIntensity: shaded ? spec.emissiveIntensity : 0,
    clearcoat: shaded ? (spec.clearcoat ?? 0) : 0,
    clearcoatRoughness: shaded ? (spec.clearcoatRoughness ?? 0) : 0,
    transmission: shaded ? (spec.transmission ?? 0) : 0,
    ior: spec.ior ?? 1.5,
    thickness: shaded ? (spec.thickness ?? 0) : 0,
    sheen: shaded ? (spec.sheen ?? 0) : 0,
    sheenRoughness: spec.sheenRoughness ?? 0.5,
    sheenColor: spec.sheenColor ?? "#ffffff",
    textureIds: shaded
      ? {
          mapId: spec.mapId,
          normalMapId: spec.normalMapId,
          aoMapId: spec.aoMapId,
          roughnessMapId: spec.roughnessMapId,
          metalnessMapId: spec.metalnessMapId,
          emissiveMapId: spec.emissiveMapId,
          clearcoatMapId: spec.clearcoatMapId,
          clearcoatRoughnessMapId: spec.clearcoatRoughnessMapId,
          transmissionMapId: spec.transmissionMapId,
          thicknessMapId: spec.thicknessMapId,
          sheenColorMapId: spec.sheenColorMapId,
        }
      : {},
  };
}

function color3(value: string, fallback = "#ffffff"): Color3 {
  try {
    return Color3.FromHexString(value.startsWith("#") ? value : `#${value}`);
  } catch {
    return Color3.FromHexString(fallback);
  }
}

function radians(value: number): number {
  return (value * Math.PI) / 180;
}

function vector3(values: readonly number[]): Vector3 {
  return new Vector3(values[0] ?? 0, values[1] ?? 0, values[2] ?? 0);
}

async function createEngine(
  canvas: HTMLCanvasElement,
): Promise<{ engine: Engine | WebGPUEngine; backend: "WebGPU" | "WebGL" }> {
  try {
    if (await WebGPUEngine.IsSupportedAsync) {
      const gpu = new WebGPUEngine(canvas, { antialias: true, adaptToDeviceRatio: true });
      try {
        await gpu.initAsync();
        return { engine: gpu, backend: "WebGPU" };
      } catch {
        gpu.dispose();
      }
    }
  } catch {
    // Browser or adapter does not expose a usable WebGPU device. WebGL2 is the real fallback.
  }
  return {
    engine: new Engine(canvas, true, { powerPreference: "high-performance" }, true),
    backend: "WebGL",
  };
}

function setTextureTransform(
  texture: Texture,
  asset: TextureAsset,
  material: MaterialSpec,
  isColorMap: boolean,
): void {
  texture.gammaSpace = isColorMap && asset.colorSpace === "srgb";
  texture.coordinatesMode = Texture.EXPLICIT_MODE;
  texture.wrapU = material.wrap === "clamp" ? Texture.CLAMP_ADDRESSMODE : Texture.WRAP_ADDRESSMODE;
  texture.wrapV = texture.wrapU;
  texture.uScale = material.repeat[0];
  texture.vScale = material.repeat[1];
  texture.uOffset = material.offset[0];
  texture.vOffset = material.offset[1];
  texture.wAng = radians(material.rotation);
  texture.updateSamplingMode(Texture.TRILINEAR_SAMPLINGMODE);
}

async function loadTextureAsset(
  asset: TextureAsset,
  scene: Scene,
  spec: MaterialSpec,
  isColorMap: boolean,
): Promise<Texture | null> {
  let texture: Texture | null = null;
  if (asset.generator) {
    const pixels = rasterizeTexture(asset);
    if (!pixels) return null;
    texture = RawTexture.CreateRGBATexture(
      new Uint8Array(pixels.data),
      pixels.width,
      pixels.height,
      scene,
      true,
      false,
      Texture.TRILINEAR_SAMPLINGMODE,
    );
  } else if (asset.dataUrl) {
    texture = await new Promise<Texture>((resolve, reject) => {
      let created: Texture;
      created = new Texture(
        asset.dataUrl,
        scene,
        false,
        false,
        Texture.TRILINEAR_SAMPLINGMODE,
        () => resolve(created),
        (message, exception) => reject(exception ?? new Error(message || "Texture decode failed")),
      );
    });
  }
  if (texture) setTextureTransform(texture, asset, spec, isColorMap);
  return texture;
}

async function createMaterial(
  node: SceneNode,
  textures: TextureAsset[],
  scene: Scene,
  mode: ViewMode,
): Promise<PBRMaterial> {
  const spec = node.material!;
  const state = toBabylonMaterialState(spec, mode);
  const material = new PBRMaterial(`${node.name} · MVM PBR`, scene);
  material.albedoColor = color3(state.color);
  material.roughness = state.roughness;
  material.metallic = state.metallic;
  material.alpha = state.opacity;
  material.emissiveColor = color3(state.emissive).scale(state.emissiveIntensity);
  material.backFaceCulling = spec.side !== "double";
  material.sideOrientation = spec.side === "back" ? Mesh.BACKSIDE : Mesh.FRONTSIDE;
  material.wireframe = mode === "wireframe";
  material.transparencyMode =
    spec.alphaMode === "MASK"
      ? Material.MATERIAL_ALPHATEST
      : spec.alphaMode === "BLEND" || spec.opacity < 0.999 || state.transmission > 0.001
        ? Material.MATERIAL_ALPHABLEND
        : Material.MATERIAL_OPAQUE;
  material.alphaCutOff = spec.alphaCutoff;
  material.useAlphaFromAlbedoTexture = spec.alphaMode !== "OPAQUE";
  material.useAmbientInGrayScale = true;
  material.ambientTextureStrength = 1;

  if (state.clearcoat > 0) {
    material.clearCoat.isEnabled = true;
    material.clearCoat.intensity = state.clearcoat;
    material.clearCoat.roughness = state.clearcoatRoughness;
  }
  if (state.sheen > 0) {
    material.sheen.isEnabled = true;
    material.sheen.intensity = state.sheen;
    material.sheen.roughness = state.sheenRoughness;
    material.sheen.color = color3(state.sheenColor);
  }
  if (state.transmission > 0) {
    // PBR refraction needs a concrete environment source. Scene-screen transmission
    // requires a separate render-graph pipeline and is not claimed by this adapter.
    material.refractionTexture = scene.environmentTexture;
    material.subSurface.isRefractionEnabled = true;
    material.subSurface.refractionIntensity = state.transmission;
    material.subSurface.indexOfRefraction = state.ior;
    material.subSurface.minimumThickness = 0;
    material.subSurface.maximumThickness = Math.max(state.thickness, 0.01);
  }

  const byId = new Map(textures.map((asset) => [asset.id, asset]));
  const assign = async (
    id: string | null | undefined,
    slot:
      | "albedo"
      | "normal"
      | "ambient"
      | "roughness"
      | "metallic"
      | "emissive"
      | "clearcoat"
      | "clearcoatRoughness"
      | "transmission"
      | "thickness"
      | "sheen",
    colorData = false,
  ) => {
    if (!id || mode !== "material") return;
    const asset = byId.get(id);
    if (!asset) return;
    try {
      const texture = await loadTextureAsset(asset, scene, spec, colorData);
      if (!texture) return;
      switch (slot) {
        case "albedo":
          material.albedoTexture = texture;
          material.useAlphaFromAlbedoTexture = spec.alphaMode !== "OPAQUE";
          break;
        case "normal":
          material.bumpTexture = texture;
          material.invertNormalMapX = false;
          material.invertNormalMapY = false;
          break;
        case "ambient":
          material.ambientTexture = texture;
          break;
        case "roughness":
          material.microSurfaceTexture = texture;
          break;
        case "metallic":
          material.metallicTexture = texture;
          break;
        case "emissive":
          material.emissiveTexture = texture;
          break;
        case "clearcoat":
          material.clearCoat.texture = texture;
          break;
        case "clearcoatRoughness":
          material.clearCoat.roughnessTexture = texture;
          break;
        case "transmission":
          material.subSurface.refractionIntensityTexture = texture;
          material.subSurface.isRefractionEnabled = true;
          break;
        case "thickness":
          material.subSurface.thicknessTexture = texture;
          break;
        case "sheen":
          material.sheen.texture = texture;
          break;
      }
    } catch {
      // Broken optional maps must not take down the whole scene; other channels still render.
    }
  };

  await Promise.all([
    assign(state.textureIds.mapId, "albedo", true),
    assign(state.textureIds.normalMapId, "normal"),
    assign(state.textureIds.aoMapId, "ambient"),
    assign(state.textureIds.roughnessMapId, "roughness"),
    assign(state.textureIds.metalnessMapId, "metallic"),
    assign(state.textureIds.emissiveMapId, "emissive", true),
    assign(state.textureIds.clearcoatMapId, "clearcoat"),
    assign(state.textureIds.clearcoatRoughnessMapId, "clearcoatRoughness"),
    assign(state.textureIds.transmissionMapId, "transmission"),
    assign(state.textureIds.thicknessMapId, "thickness"),
    assign(state.textureIds.sheenColorMapId, "sheen", true),
  ]);
  return material;
}

function createMesh(node: SceneNode, scene: Scene): Mesh | null {
  const spec = node.geometry;
  if (node.type !== "mesh" || !spec) return null;
  switch (spec.kind) {
    case "box":
      return MeshBuilder.CreateBox(node.name, {
        width: spec.width,
        height: spec.height,
        depth: spec.depth,
        updatable: false,
      }, scene);
    case "sphere":
      return MeshBuilder.CreateSphere(node.name, {
        diameter: spec.radius * 2,
        segments: Math.max(8, spec.widthSegments),
      }, scene);
    case "cylinder":
      return MeshBuilder.CreateCylinder(node.name, {
        height: spec.height,
        diameterTop: spec.radiusTop * 2,
        diameterBottom: spec.radiusBottom * 2,
        tessellation: Math.max(3, spec.radialSegments),
        subdivisions: 1,
        cap: spec.openEnded ? Mesh.NO_CAP : Mesh.CAP_ALL,
      }, scene);
    case "cone":
      return MeshBuilder.CreateCylinder(node.name, {
        height: spec.height,
        diameterTop: 0,
        diameterBottom: spec.radius * 2,
        tessellation: Math.max(3, spec.radialSegments),
      }, scene);
    case "torus":
      return MeshBuilder.CreateTorus(node.name, {
        diameter: spec.radius * 2,
        thickness: spec.tube * 2,
        tessellation: Math.max(12, spec.tubularSegments),
      }, scene);
    case "plane":
      return MeshBuilder.CreatePlane(node.name, {
        width: spec.width,
        height: spec.height,
        sideOrientation: Mesh.DOUBLESIDE,
      }, scene);
    case "capsule":
      return MeshBuilder.CreateCapsule(node.name, {
        radius: spec.radius,
        height: spec.length + spec.radius * 2,
        tessellation: Math.max(8, spec.radialSegments),
        subdivisions: Math.max(1, spec.capSegments),
      }, scene);
    case "custom": {
      const mesh = new Mesh(node.name, scene);
      const data = new VertexData();
      const positions = [...spec.positions];
      const indices = spec.indices?.length
        ? [...spec.indices]
        : Array.from({ length: Math.floor(positions.length / 3) }, (_, index) => index);
      data.positions = positions;
      data.indices = indices;
      if (spec.normals?.length === positions.length) data.normals = [...spec.normals];
      else {
        const normals: number[] = [];
        VertexData.ComputeNormals(positions, indices, normals);
        data.normals = normals;
      }
      if (spec.uvs?.length === (positions.length / 3) * 2) data.uvs = [...spec.uvs];
      data.applyToMesh(mesh, false);
      return mesh;
    }
    default: {
      const exhaustive: never = spec;
      return exhaustive;
    }
  }
}

function applyTransform(node: SceneNode, object: TransformNode): void {
  object.position.copyFrom(vector3(node.position));
  object.rotation.set(
    radians(node.rotation[0]),
    radians(node.rotation[1]),
    radians(node.rotation[2]),
  );
  object.scaling.copyFrom(vector3(node.scale));
  object.setEnabled(node.visible);
  object.isPickable = true;
}

function makeGrid(scene: Scene): void {
  const minor: Vector3[][] = [];
  const major: Vector3[][] = [];
  const half = 10;
  for (let i = -half * 2; i <= half * 2; i += 1) {
    const coordinate = i / 2;
    const target = i % 2 === 0 ? major : minor;
    target.push([new Vector3(-half, 0.004, coordinate), new Vector3(half, 0.004, coordinate)]);
    target.push([new Vector3(coordinate, 0.004, -half), new Vector3(coordinate, 0.004, half)]);
  }
  const minorGrid = MeshBuilder.CreateLineSystem("MVM Grid · Minor", { lines: minor }, scene);
  minorGrid.color = color3("#1d2a34");
  minorGrid.isPickable = false;
  const majorGrid = MeshBuilder.CreateLineSystem("MVM Grid · Major", { lines: major }, scene);
  majorGrid.color = color3("#2a3b47");
  majorGrid.isPickable = false;

  const xAxis = MeshBuilder.CreateLines("MVM Axis · X", {
    points: [new Vector3(-1.5, 0.008, 0), new Vector3(1.5, 0.008, 0)],
  }, scene);
  xAxis.color = color3("#ef7272");
  xAxis.isPickable = false;
  const zAxis = MeshBuilder.CreateLines("MVM Axis · Z", {
    points: [new Vector3(0, 0.008, -1.5), new Vector3(0, 0.008, 1.5)],
  }, scene);
  zAxis.color = color3("#7ba7ff");
  zAxis.isPickable = false;
  const yAxis = MeshBuilder.CreateLines("MVM Axis · Y", {
    points: [new Vector3(0, 0.008, 0), new Vector3(0, 1.5, 0)],
  }, scene);
  yAxis.color = color3("#79d7a4");
  yAxis.isPickable = false;
}

function makeGround(scene: Scene): Mesh {
  const ground = MeshBuilder.CreatePlane("MVM Studio Ground", {
    width: 200,
    height: 200,
    sideOrientation: Mesh.DOUBLESIDE,
  }, scene);
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.025;
  const material = new PBRMaterial("MVM Ground · Matte", scene);
  material.albedoColor = color3("#111820");
  material.roughness = 0.96;
  material.metallic = 0;
  material.backFaceCulling = false;
  ground.material = material;
  ground.receiveShadows = true;
  ground.isPickable = false;
  return ground;
}

function makeLight(node: SceneNode, scene: Scene): Light | null {
  if (node.type !== "light" || !node.light) return null;
  const spec = node.light;
  const position = vector3(node.position);
  const direction = spec.target
    ? vector3(spec.target).subtract(position).normalize()
    : new Vector3(-0.65, -1, 0.55).normalize();
  let light: Light;
  switch (spec.kind) {
    case "ambient":
    case "hemisphere": {
      const hemi = new HemisphericLight(node.name, new Vector3(0, 1, 0), scene);
      hemi.diffuse = color3(spec.color);
      hemi.groundColor = color3(spec.groundColor ?? "#243140");
      hemi.intensity = spec.intensity;
      light = hemi;
      break;
    }
    case "point": {
      const point = new PointLight(node.name, position, scene);
      point.diffuse = color3(spec.color);
      point.intensity = spec.intensity;
      point.range = spec.distance ?? 0;
      light = point;
      break;
    }
    case "spot": {
      const spot = new SpotLight(
        node.name,
        position,
        direction,
        radians(spec.angle ?? 35),
        Math.max(1, Math.round((spec.penumbra ?? 0.4) * 8)),
        scene,
      );
      spot.diffuse = color3(spec.color);
      spot.intensity = spec.intensity;
      light = spot;
      break;
    }
    default: {
      const directional = new DirectionalLight(node.name, direction, scene);
      directional.diffuse = color3(spec.color);
      directional.intensity = spec.intensity;
      light = directional;
      break;
    }
  }
  light.name = node.name;
  light.metadata = { mvmId: node.id };
  return light;
}

function addEnvironment(scene: Scene, project: Pick<Project, "scene">, onWarning?: (message: string) => void): void {
  const url = project.scene.environmentUrl;
  const preset = project.scene.environment ?? "studio";
  const intensity: Record<string, number> = {
    studio: 1,
    neutral: 0.72,
    city: 1.1,
    sunset: 1.05,
    warehouse: 0.8,
    none: 0,
  };
  scene.environmentIntensity = intensity[preset] ?? 1;
  if (preset === "none" && !url) return;

  try {
    if (url) {
      const path = url.split(/[?#]/, 1)[0] ?? url;
      if (/\.env$/i.test(path)) {
        scene.environmentTexture = CubeTexture.CreateFromPrefilteredData(url, scene);
      } else if (/\.hdr$/i.test(path)) {
        scene.environmentTexture = new HDRCubeTexture(url, scene, 128, false, true, false, true);
      } else {
        onWarning?.("MVM BABYLON uses prefiltered .env or .hdr environment maps. This URL is not supported by the Babylon backend; using the built-in studio environment.");
        scene.environmentTexture = CubeTexture.CreateFromPrefilteredData(
          "https://assets.babylonjs.com/environments/environmentSpecular.env",
          scene,
        );
      }
      return;
    }

    // Official, prefiltered PBR environment. It is a fallback lighting asset, not an engine CDN.
    scene.environmentTexture = CubeTexture.CreateFromPrefilteredData(
      "https://assets.babylonjs.com/environments/environmentSpecular.env",
      scene,
    );
  } catch (error) {
    const detail = error instanceof Error ? error.message : "Environment texture could not be initialized.";
    onWarning?.(`MVM BABYLON environment: ${detail}`);
  }
}

function installAnimations(
  project: Pick<Project, "clips">,
  objects: Map<string, TransformNode>,
): Map<string, { duration: number; loop: boolean; tracks: Array<{ target: TransformNode; animation: Animation }> }> {
  const clips = new Map<string, { duration: number; loop: boolean; tracks: Array<{ target: TransformNode; animation: Animation }> }>();
  for (const clip of project.clips) {
    const tracks: Array<{ target: TransformNode; animation: Animation }> = [];
    for (const track of clip.tracks) {
      const target = objects.get(track.objectId);
      if (!target || track.keyframes.length === 0) continue;
      const quaternionTrack = track.property === "quaternion" || track.property === "rotation";
      const property = track.property === "position"
        ? "position"
        : track.property === "scale"
          ? "scaling"
          : "rotationQuaternion";
      const animation = new Animation(
        `${clip.name} · ${track.id}`,
        property,
        30,
        quaternionTrack ? Animation.ANIMATIONTYPE_QUATERNION : Animation.ANIMATIONTYPE_VECTOR3,
        clip.loop ? Animation.ANIMATIONLOOPMODE_CYCLE : Animation.ANIMATIONLOOPMODE_CONSTANT,
      );
      const keys = [...track.keyframes]
        .sort((a, b) => a.time - b.time)
        .map((key) => {
          let value: Vector3 | Quaternion;
          if (track.property === "position" || track.property === "scale") {
            value = vector3(key.value);
          } else if (track.property === "quaternion") {
            value = new Quaternion(
              key.value[0] ?? 0,
              key.value[1] ?? 0,
              key.value[2] ?? 0,
              key.value[3] ?? 1,
            );
          } else {
            value = Quaternion.FromEulerAngles(
              radians(key.value[0] ?? 0),
              radians(key.value[1] ?? 0),
              radians(key.value[2] ?? 0),
            );
          }
          return { frame: key.time * 30, value };
        });
      animation.setKeys(keys);
      tracks.push({ target, animation });
    }
    if (tracks.length) clips.set(clip.id, { duration: clip.duration, loop: clip.loop, tracks });
  }
  return clips;
}

export async function mountBabylonViewport(
  host: HTMLElement,
  project: Project,
  options: BabylonViewportOptions,
): Promise<BabylonViewportHandle> {
  const canvas = document.createElement("canvas");
  canvas.setAttribute("aria-label", "MVM BABYLON 3D viewport");
  canvas.style.display = "block";
  canvas.style.width = "100%";
  canvas.style.height = "100%";
  canvas.style.outline = "none";
  canvas.style.touchAction = "none";
  host.replaceChildren(canvas);

  const { engine, backend } = await createEngine(canvas);
  options.onBackend?.(backend);
  engine.setHardwareScalingLevel(1 / Math.min(window.devicePixelRatio || 1, 1.5));

  const scene = new Scene(engine);
  scene.useRightHandedSystem = true;
  scene.clearColor = new Color4(
    color3(project.scene.background || "#10161e").r,
    color3(project.scene.background || "#10161e").g,
    color3(project.scene.background || "#10161e").b,
    1,
  );
  scene.imageProcessingConfiguration.toneMappingEnabled = true;
  scene.imageProcessingConfiguration.toneMappingType = 1;
  scene.imageProcessingConfiguration.exposure = project.scene.exposure || 1;
  scene.imageProcessingConfiguration.contrast = 1.15;
  addEnvironment(scene, project, options.onWarning);

  const objectsById = new Map<string, TransformNode>();
  const lightNodes: Array<{ node: SceneNode; light: Light }> = [];
  const meshes: Mesh[] = [];

  for (const node of project.objects) {
    let object: TransformNode | null = null;
    const mesh = createMesh(node, scene);
    if (mesh) {
      object = mesh;
      mesh.metadata = { ...(mesh.metadata ?? {}), mvmId: node.id };
      mesh.receiveShadows = Boolean(project.scene.shadows);
      meshes.push(mesh);
      if (node.material) {
        mesh.material = await createMaterial(node, project.textures, scene, options.mode);
      }
    } else if (node.type === "group") {
      object = new TransformNode(node.name, scene);
      object.metadata = { mvmId: node.id };
    } else {
      const light = makeLight(node, scene);
      if (light) {
        lightNodes.push({ node, light });
        // A shadow light is position-bearing; the scene hierarchy is still represented by its Node parent.
        if (light instanceof PointLight || light instanceof SpotLight || light instanceof DirectionalLight) {
          light.position.copyFrom(vector3(node.position));
        }
      }
    }
    if (object) {
      object.name = node.name;
      applyTransform(node, object);
      objectsById.set(node.id, object);
    }
  }

  // Rebuild the hierarchy after all nodes exist; saved projects need not be parent-first ordered.
  for (const node of project.objects) {
    const child = objectsById.get(node.id);
    const parent = node.parentId ? objectsById.get(node.parentId) : undefined;
    if (child && parent && child !== parent) child.parent = parent;
  }

  const hasHemi = lightNodes.some(({ node }) => node.light?.kind === "ambient" || node.light?.kind === "hemisphere");
  const hasDirectional = lightNodes.some(({ node }) =>
    node.light?.kind === "directional" || node.light?.kind === "spot",
  );
  if (!hasHemi) {
    const hemi = new HemisphericLight("MVM BABYLON · Fill", new Vector3(0, 1, 0), scene);
    hemi.intensity = 0.68;
    hemi.diffuse = color3("#d9e6f2");
    hemi.groundColor = color3("#293541");
  }
  let defaultKey: DirectionalLight | null = null;
  if (!hasDirectional) {
    defaultKey = new DirectionalLight("MVM BABYLON · Key", new Vector3(-0.65, -1, 0.55).normalize(), scene);
    defaultKey.intensity = 2.1;
    defaultKey.diffuse = color3("#fff2df");
  }

  if (project.scene.shadows) {
    const caster = lightNodes.find(({ node, light }) =>
      Boolean(node.light?.castShadow) && (light instanceof DirectionalLight || light instanceof SpotLight),
    );
    const shadowLight = caster?.light instanceof DirectionalLight || caster?.light instanceof SpotLight
      ? caster.light
      : defaultKey;
    if (shadowLight) {
      const shadows = new ShadowGenerator(1024, shadowLight);
      shadows.useBlurExponentialShadowMap = true;
      shadows.blurKernel = 16;
      shadows.bias = 0.00035;
      shadows.normalBias = 0.02;
      for (const mesh of meshes) shadows.addShadowCaster(mesh, true);
    }
  }

  if (project.scene.grid) makeGrid(scene);
  makeGround(scene);

  const target = vector3(project.scene.camera.target);
  const cameraPosition = vector3(project.scene.camera.position);
  const radius = Math.max(0.1, Vector3.Distance(target, cameraPosition));
  const camera = new ArcRotateCamera("MVM BABYLON · Camera", -Math.PI / 2, Math.PI / 3, radius, target, scene);
  camera.setPosition(cameraPosition);
  camera.setTarget(target);
  camera.fov = radians(project.scene.camera.fov || 42);
  camera.minZ = project.scene.camera.near || 0.05;
  camera.maxZ = project.scene.camera.far || 400;
  camera.lowerRadiusLimit = 0.25;
  camera.upperRadiusLimit = 150;
  camera.wheelDeltaPercentage = 0.012;
  camera.panningSensibility = 55;
  camera.attachControl(canvas, true);

  const clipMap = installAnimations(project, objectsById);
  let activeAnimatables: Array<{ stop: () => void }> = [];
  const setPlayback = (playing: boolean, clipId: string | null) => {
    scene.stopAllAnimations();
    activeAnimatables = [];
    if (!playing || !clipId) return;
    const clip = clipMap.get(clipId);
    if (!clip) return;
    const endFrame = Math.max(1, clip.duration * 30);
    for (const track of clip.tracks) {
      activeAnimatables.push(
        scene.beginDirectAnimation(track.target, [track.animation], 0, endFrame, clip.loop),
      );
    }
  };

  let disposed = false;
  const resizeObserver = new ResizeObserver(() => engine.resize());
  resizeObserver.observe(host);
  engine.resize();
  engine.runRenderLoop(() => {
    if (disposed) return;
    scene.render();
    options.onFrame?.(canvas);
  });

  return {
    backend,
    setPlayback,
    dispose: () => {
      if (disposed) return;
      disposed = true;
      resizeObserver.disconnect();
      activeAnimatables.forEach((animatable) => animatable.stop());
      scene.stopAllAnimations();
      camera.detachControl();
      scene.dispose();
      engine.stopRenderLoop();
      engine.dispose();
      canvas.remove();
    },
  };
}
