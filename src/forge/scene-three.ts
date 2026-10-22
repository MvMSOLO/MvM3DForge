import * as THREE from "three";
import { canvasFromPixels, loadHtmlImage, rasterizeTexture } from "./textures.ts";
import { buildGeometry } from "./geometry-build.ts";
import type { MaterialSpec, Project, SceneNode, TextureAsset } from "./types.ts";

const sourceCache = new Map<string, THREE.Texture>();

export function textureKey(asset: TextureAsset): string {
  return `${asset.id}:${asset.width}x${asset.height}:${asset.colorSpace}:${asset.generator ?? "image"}:${JSON.stringify(asset.params ?? {})}:${asset.dataUrl?.length ?? 0}`;
}

export async function loadTextureSource(asset: TextureAsset): Promise<THREE.Texture | null> {
  const key = textureKey(asset);
  const cached = sourceCache.get(key);
  if (cached) return cached;
  let texture: THREE.Texture | null = null;
  if (asset.generator) {
    const pixels = rasterizeTexture(asset);
    if (!pixels) return null;
    if (typeof document === "undefined") {
      texture = new THREE.DataTexture(pixels.data, pixels.width, pixels.height, THREE.RGBAFormat);
    } else {
      const canvas = canvasFromPixels(pixels.data, pixels.width, pixels.height);
      texture = new THREE.CanvasTexture(canvas);
    }
  } else if (asset.dataUrl && typeof document !== "undefined") {
    const image = await loadHtmlImage(asset.dataUrl);
    texture = new THREE.Texture(image);
    texture.needsUpdate = true;
  }
  if (!texture) return null;
  texture.colorSpace = asset.colorSpace === "srgb" ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  texture.flipY = false;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.needsUpdate = true;
  sourceCache.set(key, texture);
  return texture;
}

export function disposeTextureCache() {
  for (const texture of sourceCache.values()) texture.dispose();
  sourceCache.clear();
}

function bindMap(
  source: THREE.Texture,
  spec: MaterialSpec,
  colorSpace: THREE.ColorSpace,
): THREE.Texture {
  const map = source.clone();
  map.colorSpace = colorSpace;
  map.flipY = false;
  map.wrapS = spec.wrap === "clamp" ? THREE.ClampToEdgeWrapping : THREE.RepeatWrapping;
  map.wrapT = map.wrapS;
  map.repeat.set(spec.repeat[0], spec.repeat[1]);
  map.offset.set(spec.offset[0], spec.offset[1]);
  map.rotation = THREE.MathUtils.degToRad(spec.rotation);
  map.needsUpdate = true;
  return map;
}

export async function materialFor(
  spec: MaterialSpec,
  textures: TextureAsset[],
  mode: "material" | "solid" | "wireframe",
): Promise<THREE.MeshStandardMaterial> {
  const material = new THREE.MeshStandardMaterial();
  material.name = spec.name ?? "";
  if (mode === "solid") {
    material.color.set(spec.color);
    material.roughness = 0.82;
    material.metalness = 0;
    material.emissive.set("#000000");
  } else {
    material.color.set(spec.color);
    material.roughness = spec.roughness;
    material.metalness = spec.metalness;
    material.emissive.set(spec.emissive);
    material.emissiveIntensity = spec.emissiveIntensity;
  }
  material.opacity = spec.opacity;
  material.transparent = spec.alphaMode === "BLEND" || spec.opacity < 0.999;
  material.alphaTest = spec.alphaMode === "MASK" ? spec.alphaCutoff : 0;
  material.depthWrite = spec.alphaMode !== "BLEND";
  material.side =
    spec.side === "double" ? THREE.DoubleSide : spec.side === "back" ? THREE.BackSide : THREE.FrontSide;
  material.wireframe = mode === "wireframe";
  if (mode === "material") {
    const byId = new Map(textures.map((tex) => [tex.id, tex]));
    const assign = async (id: string | null, slot: "map" | "normalMap" | "aoMap" | "roughnessMap" | "metalnessMap") => {
      if (!id) return;
      const asset = byId.get(id);
      if (!asset) return;
      const source = await loadTextureSource(asset);
      if (!source) return;
      const colorSpace = slot === "map" && asset.colorSpace === "srgb" ? THREE.SRGBColorSpace : THREE.NoColorSpace;
      material[slot] = bindMap(source, spec, colorSpace);
    };
    await assign(spec.mapId, "map");
    await assign(spec.normalMapId, "normalMap");
    await assign(spec.aoMapId, "aoMap");
    await assign(spec.roughnessMapId, "roughnessMap");
    await assign(spec.metalnessMapId, "metalnessMap");
  }
  return material;
}

export function uniqueExportName(name: string, used: Set<string>): string {
  const base = name.replace(/[^\w .+\-]/g, "").trim() || "Node";
  let next = base;
  let index = 2;
  while (used.has(next)) {
    next = `${base} ${index}`;
    index += 1;
  }
  used.add(next);
  return next;
}

export async function buildObject(
  node: SceneNode,
  textures: TextureAsset[],
  mode: "material" | "solid" | "wireframe",
  shadow: boolean,
): Promise<THREE.Object3D | null> {
  if (node.type === "group") {
    const group = new THREE.Group();
    group.name = node.name;
    group.userData.mvmId = node.id;
    return group;
  }
  if (node.type === "light" && node.light) {
    const spec = node.light;
    let light: THREE.Light;
    if (spec.kind === "ambient") light = new THREE.AmbientLight(spec.color, spec.intensity);
    else if (spec.kind === "hemisphere") {
      light = new THREE.HemisphereLight(spec.color, spec.groundColor ?? "#243140", spec.intensity);
    } else if (spec.kind === "point") {
      light = new THREE.PointLight(spec.color, spec.intensity, spec.distance ?? 0, spec.decay ?? 2);
    } else if (spec.kind === "spot") {
      light = new THREE.SpotLight(
        spec.color,
        spec.intensity,
        spec.distance ?? 0,
        THREE.MathUtils.degToRad(spec.angle ?? 35),
        spec.penumbra ?? 0.4,
        spec.decay ?? 2,
      );
    } else {
      light = new THREE.DirectionalLight(spec.color, spec.intensity);
    }
    light.castShadow = Boolean(shadow && spec.castShadow && (spec.kind === "directional" || spec.kind === "spot"));
    if ((light instanceof THREE.DirectionalLight || light instanceof THREE.SpotLight) && light.shadow && light.castShadow) {
      light.shadow.mapSize.set(1024, 1024);
      light.shadow.bias = -0.0004;
      const cam = light.shadow.camera as THREE.OrthographicCamera;
      if (cam.left !== undefined) {
        cam.left = -8;
        cam.right = 8;
        cam.top = 8;
        cam.bottom = -8;
        cam.near = 0.2;
        cam.far = 30;
      }
    }
    light.name = node.name;
    light.userData.mvmId = node.id;
    if ((light instanceof THREE.DirectionalLight || light instanceof THREE.SpotLight) && spec.target) {
      const offset = new THREE.Vector3(
        spec.target[0] - node.position[0],
        spec.target[1] - node.position[1],
        spec.target[2] - node.position[2],
      );
      if (offset.lengthSq() < 1e-8) offset.set(0, 0, -1);
      light.target.position.copy(offset);
      light.target.name = `${node.name} Target`;
      light.add(light.target);
    }
    return light;
  }
  if (node.type === "mesh" && node.geometry && node.material) {
    const geometry = buildGeometry(node.geometry);
    if (node.material.aoMapId && geometry.getAttribute("uv") && !geometry.getAttribute("uv2")) {
      geometry.setAttribute("uv2", geometry.getAttribute("uv").clone());
    }
    const material = await materialFor(node.material, textures, mode);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.castShadow = shadow;
    mesh.receiveShadow = shadow;
    mesh.name = node.name;
    mesh.userData.mvmId = node.id;
    return mesh;
  }
  return null;
}

export function applyLocalTransform(object: THREE.Object3D, node: SceneNode) {
  object.position.set(node.position[0], node.position[1], node.position[2]);
  object.rotation.set(
    THREE.MathUtils.degToRad(node.rotation[0]),
    THREE.MathUtils.degToRad(node.rotation[1]),
    THREE.MathUtils.degToRad(node.rotation[2]),
    "XYZ",
  );
  object.scale.set(node.scale[0], node.scale[1], node.scale[2]);
  object.visible = node.visible;
}

export async function assembleScene(
  project: Pick<Project, "objects" | "textures" | "scene">,
  options: { mode: "material" | "solid" | "wireframe"; shadows: boolean; onlyVisible: boolean },
): Promise<{ scene: THREE.Scene; byId: Map<string, THREE.Object3D>; roots: THREE.Object3D[] }> {
  const scene = new THREE.Scene();
  const byId = new Map<string, THREE.Object3D>();
  let shadowsLeft = 1;

  // Build all nodes first so child nodes can resolve parents regardless of order.
  for (const node of project.objects) {
    if (options.onlyVisible && !node.visible) continue;
    const allowShadow = Boolean(node.light?.castShadow) && shadowsLeft > 0 && options.shadows;
    if (allowShadow) shadowsLeft -= 1;
    const object = await buildObject(
      node,
      project.textures,
      options.mode,
      options.shadows && (allowShadow || node.type === "mesh"),
    );
    if (!object) continue;
    byId.set(node.id, object);
    object.userData.mvmId = node.id;
    object.name = node.name;
  }

  const roots: THREE.Object3D[] = [];
  for (const node of project.objects) {
    const object = byId.get(node.id);
    if (!object) continue;
    const parent = node.parentId ? byId.get(node.parentId) : undefined;
    if (parent && parent !== object) {
      parent.add(object);
    } else {
      scene.add(object);
      roots.push(object);
    }
    applyLocalTransform(object, node);
  }

  // Directional/spot light targets must be part of the scene graph.
  scene.traverse((object) => {
    const light = object as THREE.DirectionalLight | THREE.SpotLight;
    if ((light instanceof THREE.DirectionalLight || light instanceof THREE.SpotLight) && light.target.parent === null) {
      scene.add(light.target);
    }
  });

  return { scene, byId, roots };
}
export function animationClips(
  project: Pick<Project, "clips" | "objects">,
  byId: Map<string, THREE.Object3D>,
): THREE.AnimationClip[] {
  const used = new Set<string>();
  for (const [id, object] of byId) {
    const node = project.objects.find((item) => item.id === id);
    object.name = uniqueExportName(node?.name || object.name || "Node", used);
  }
  const clips: THREE.AnimationClip[] = [];
  for (const clip of project.clips) {
    const tracks: THREE.KeyframeTrack[] = [];
    for (const track of clip.tracks) {
      const object = byId.get(track.objectId);
      if (!object || track.keyframes.length < 1) continue;
      const times = track.keyframes.map((key) => key.time);
      if (track.property === "position" || track.property === "scale") {
        const values = track.keyframes.flatMap((key) => key.value.slice(0, 3));
        const keyframe =
          track.property === "position"
            ? new THREE.VectorKeyframeTrack(`${object.name}.position`, times, values)
            : new THREE.VectorKeyframeTrack(`${object.name}.scale`, times, values);
        keyframe.setInterpolation(track.interpolation === "smooth" ? THREE.InterpolateSmooth : THREE.InterpolateLinear);
        tracks.push(keyframe);
      } else if (track.property === "quaternion") {
        const values = track.keyframes.flatMap((key) => key.value.slice(0, 4));
        const keyframe = new THREE.QuaternionKeyframeTrack(`${object.name}.quaternion`, times, values);
        keyframe.setInterpolation(THREE.InterpolateLinear);
        tracks.push(keyframe);
      } else {
        const values = track.keyframes.flatMap((key) => {
          const euler = new THREE.Euler(
            THREE.MathUtils.degToRad(key.value[0] ?? 0),
            THREE.MathUtils.degToRad(key.value[1] ?? 0),
            THREE.MathUtils.degToRad(key.value[2] ?? 0),
            "XYZ",
          );
          const q = new THREE.Quaternion().setFromEuler(euler);
          return [q.x, q.y, q.z, q.w];
        });
        const keyframe = new THREE.QuaternionKeyframeTrack(`${object.name}.quaternion`, times, values);
        keyframe.setInterpolation(THREE.InterpolateLinear);
        tracks.push(keyframe);
      }
    }
    if (tracks.length) clips.push(new THREE.AnimationClip(clip.name, clip.duration, tracks));
  }
  return clips;
}

export function disposeObject(object: THREE.Object3D) {
  object.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (mesh.geometry) mesh.geometry.dispose();
    const material = mesh.material;
    const list = Array.isArray(material) ? material : material ? [material] : [];
    for (const entry of list) {
      const std = entry as THREE.MeshStandardMaterial;
      for (const key of ["map", "normalMap", "aoMap", "roughnessMap", "metalnessMap"] as const) {
        const map = std[key];
        if (map && map.uuid !== sourceCacheGetUuid(map)) map.dispose();
      }
      entry.dispose();
    }
  });
}

function sourceCacheGetUuid(map: THREE.Texture): string | null {
  for (const texture of sourceCache.values()) if (texture.uuid === map.uuid) return texture.uuid;
  return null;
}
