import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { defaultMaterial } from "./materials.ts";
import { makeNode } from "./nodes.ts";
import { LIMITS } from "./limits.ts";
import type { AnimClip, AnimTrack, GeometrySpec, MaterialSpec, Project, SceneNode, TextureAsset } from "./types.ts";

export type GlbImportResult = {
  project: Project;
  meshesAdded: number;
  texturesAdded: number;
  animationsAdded: number;
  warnings: string[];
};

type TextureSlot =
  | ["map", "mapId", "srgb"]
  | ["normalMap", "normalMapId", "linear"]
  | ["roughnessMap", "roughnessMapId", "linear"]
  | ["metalnessMap", "metalnessMapId", "linear"]
  | ["aoMap", "aoMapId", "linear"]
  | ["emissiveMap", "emissiveMapId", "srgb"]
  | ["clearcoatMap", "clearcoatMapId", "linear"]
  | ["clearcoatRoughnessMap", "clearcoatRoughnessMapId", "linear"]
  | ["transmissionMap", "transmissionMapId", "linear"]
  | ["thicknessMap", "thicknessMapId", "linear"]
  | ["sheenColorMap", "sheenColorMapId", "srgb"];

const TEXTURE_SLOTS: TextureSlot[] = [
  ["map", "mapId", "srgb"],
  ["normalMap", "normalMapId", "linear"],
  ["roughnessMap", "roughnessMapId", "linear"],
  ["metalnessMap", "metalnessMapId", "linear"],
  ["aoMap", "aoMapId", "linear"],
  ["emissiveMap", "emissiveMapId", "srgb"],
  ["clearcoatMap", "clearcoatMapId", "linear"],
  ["clearcoatRoughnessMap", "clearcoatRoughnessMapId", "linear"],
  ["transmissionMap", "transmissionMapId", "linear"],
  ["thicknessMap", "thicknessMapId", "linear"],
  ["sheenColorMap", "sheenColorMapId", "srgb"],
];

function finiteNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function vec3Array(value: THREE.Vector3): [number, number, number] {
  return [value.x, value.y, value.z];
}

function rotationDegrees(object: THREE.Object3D): [number, number, number] {
  const euler = new THREE.Euler().setFromQuaternion(object.quaternion, "XYZ");
  return [
    THREE.MathUtils.radToDeg(euler.x),
    THREE.MathUtils.radToDeg(euler.y),
    THREE.MathUtils.radToDeg(euler.z),
  ];
}

function readAttribute(attribute: THREE.BufferAttribute | THREE.InterleavedBufferAttribute | undefined, size: number): number[] | undefined {
  if (!attribute) return undefined;
  const out: number[] = [];
  for (let i = 0; i < attribute.count; i += 1) {
    out.push(attribute.getX(i));
    if (size > 1) out.push(attribute.getY(i));
    if (size > 2) out.push(attribute.getZ(i));
    if (size > 3) out.push(attribute.getW(i));
  }
  return out;
}

function customGeometry(geometry: THREE.BufferGeometry, group?: { start: number; count: number }): GeometrySpec | null {
  const position = geometry.getAttribute("position");
  if (!position || position.count < 3) return null;
  const positions = readAttribute(position, 3);
  if (!positions) return null;
  const normals = readAttribute(geometry.getAttribute("normal"), 3);
  const uvAttribute = geometry.getAttribute("uv");
  const uvs = readAttribute(uvAttribute, 2);
  let indices: number[] | undefined;
  const index = geometry.getIndex();
  if (group) {
    if (index) {
      indices = Array.from(index.array as ArrayLike<number>).slice(group.start, group.start + group.count);
    } else {
      const start = group.start;
      const end = Math.min(position.count, start + group.count);
      return {
        kind: "custom",
        positions: positions.slice(start * 3, end * 3),
        normals: normals?.slice(start * 3, end * 3),
        uvs: uvs?.slice(start * 2, end * 2),
      };
    }
  } else if (index) {
    indices = Array.from(index.array as ArrayLike<number>);
  }
  return { kind: "custom", positions, indices, normals, uvs };
}

function imageDimensions(image: unknown): { width: number; height: number } | null {
  if (!image || typeof image !== "object") return null;
  const source = image as { naturalWidth?: number; naturalHeight?: number; videoWidth?: number; videoHeight?: number; width?: number; height?: number };
  const width = source.naturalWidth || source.videoWidth || source.width || 0;
  const height = source.naturalHeight || source.videoHeight || source.height || 0;
  return width > 0 && height > 0 ? { width, height } : null;
}

async function textureDataUrl(texture: THREE.Texture): Promise<{ dataUrl: string; width: number; height: number } | null> {
  const image = texture.image;
  const dimensions = imageDimensions(image);
  if (!dimensions || typeof document === "undefined") return null;
  const factor = Math.min(1, 2048 / Math.max(dimensions.width, dimensions.height));
  const width = Math.max(1, Math.round(dimensions.width * factor));
  const height = Math.max(1, Math.round(dimensions.height * factor));
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");
  if (!context) return null;
  canvas.width = width;
  canvas.height = height;
  try {
    context.drawImage(image as CanvasImageSource, 0, 0, width, height);
    let dataUrl = canvas.toDataURL("image/webp", 0.9);
    if (!dataUrl.startsWith("data:image/webp")) dataUrl = canvas.toDataURL("image/png");
    if (dataUrl.length > 11_500_000) {
      canvas.width = Math.max(1, Math.round(width / 2));
      canvas.height = Math.max(1, Math.round(height / 2));
      context.drawImage(image as CanvasImageSource, 0, 0, canvas.width, canvas.height);
      dataUrl = canvas.toDataURL("image/webp", 0.86);
      if (!dataUrl.startsWith("data:image/webp")) dataUrl = canvas.toDataURL("image/png");
    }
    if (dataUrl.length > 12_000_000) return null;
    return { dataUrl, width: canvas.width, height: canvas.height };
  } catch {
    return null;
  }
}

export async function importGlbFile(file: File, current: Project): Promise<GlbImportResult> {
  if (!file.name.toLowerCase().endsWith(".glb") && !file.name.toLowerCase().endsWith(".gltf")) {
    throw new Error("Choose a .glb or .gltf file.");
  }
  if (file.size > 100 * 1024 * 1024) {
    throw new Error("Model is larger than 100 MB. Optimize it and retry.");
  }

  const loader = new GLTFLoader();
  const gltf = await loader.parseAsync(await file.arrayBuffer(), "");
  const root = gltf.scene;
  if (!root) throw new Error("This glTF file has no default scene.");

  const warnings = new Set<string>();
  const nodes: SceneNode[] = [];
  const textures: TextureAsset[] = [];
  const textureCache = new Map<string, string>();
  const nameCounts = new Map<string, number>();
  const nodeByName = new Map<string, string>();
  const ambiguousNames = new Set<string>();
  const availableTextureSlots = Math.max(0, LIMITS.maxTextures - current.textures.length);

  root.traverse((object) => {
    if (object.name) nameCounts.set(object.name, (nameCounts.get(object.name) ?? 0) + 1);
  });
  for (const [name, count] of nameCounts) {
    if (count > 1) ambiguousNames.add(name);
  }

  async function textureId(texture: THREE.Texture | null | undefined, slot: string, colorSpace: "srgb" | "linear"): Promise<string | null> {
    if (!texture) return null;
    const cacheKey = texture.uuid + "|" + colorSpace;
    const cached = textureCache.get(cacheKey);
    if (cached) return cached;
    if (textures.length >= availableTextureSlots) {
      warnings.add("Some material maps were omitted because the project texture limit is 32.");
      return null;
    }
    const pixels = await textureDataUrl(texture);
    if (!pixels) {
      warnings.add("Some embedded texture images could not be converted and were skipped.");
      return null;
    }
    const id = crypto.randomUUID();
    const textureName = ((texture.name || file.name.replace(/\.(glb|gltf)$/i, "")) + " · " + slot).slice(0, 100);
    textures.push({
      id,
      name: textureName,
      source: "import",
      colorSpace,
      width: pixels.width,
      height: pixels.height,
      dataUrl: pixels.dataUrl,
    });
    textureCache.set(cacheKey, id);
    return id;
  }

  async function materialSpec(material: THREE.Material | THREE.Material[] | undefined, meshName: string): Promise<MaterialSpec> {
    const selected = Array.isArray(material) ? material[0] : material;
    if (!selected) return defaultMaterial();
    if (Array.isArray(material) && material.length > 1) {
      warnings.add("A mesh with multiple materials was split by its geometry groups where possible.");
    }
    const source = selected as THREE.MeshStandardMaterial;
    const physical = selected as THREE.MeshPhysicalMaterial;
    const side = selected.side === THREE.DoubleSide ? "double" : selected.side === THREE.BackSide ? "back" : "front";
    const color = source.color instanceof THREE.Color ? "#" + source.color.getHexString() : "#C5D0DB";
    const emissive = source.emissive instanceof THREE.Color ? "#" + source.emissive.getHexString() : "#000000";
    const spec = defaultMaterial({
      name: selected.name || meshName,
      color,
      roughness: finiteNumber(source.roughness, 0.8),
      metalness: finiteNumber(source.metalness, 0),
      opacity: finiteNumber(selected.opacity, 1),
      emissive,
      emissiveIntensity: finiteNumber(source.emissiveIntensity, 1),
      alphaMode: selected.transparent ? "BLEND" : selected.alphaTest > 0 ? "MASK" : "OPAQUE",
      alphaCutoff: finiteNumber(selected.alphaTest, 0.5),
      side,
      clearcoat: finiteNumber(physical.clearcoat, 0),
      clearcoatRoughness: finiteNumber(physical.clearcoatRoughness, 0.12),
      transmission: finiteNumber(physical.transmission, 0),
      ior: finiteNumber(physical.ior, 1.5),
      thickness: finiteNumber(physical.thickness, 0),
      sheen: finiteNumber(physical.sheen, 0),
      sheenRoughness: finiteNumber(physical.sheenRoughness, 0.5),
      sheenColor: physical.sheenColor instanceof THREE.Color ? "#" + physical.sheenColor.getHexString() : "#FFFFFF",
    });
    const channelIds: Record<string, string | null> = {};
    for (const [property, idKey, colorSpace] of TEXTURE_SLOTS) {
      const texture = (selected as unknown as Record<string, THREE.Texture | null | undefined>)[property];
      channelIds[idKey] = await textureId(texture, property, colorSpace);
    }
    Object.assign(spec, channelIds);
    const baseMap = source.map;
    if (baseMap) {
      spec.repeat = [baseMap.repeat.x, baseMap.repeat.y];
      spec.offset = [baseMap.offset.x, baseMap.offset.y];
      spec.rotation = THREE.MathUtils.radToDeg(baseMap.rotation);
      spec.wrap = baseMap.wrapS === THREE.ClampToEdgeWrapping ? "clamp" : "repeat";
    }
    if (selected.side !== THREE.FrontSide && selected.side !== THREE.BackSide && selected.side !== THREE.DoubleSide) {
      warnings.add("An imported material used an unsupported side mode and was normalized.");
    }
    return spec;
  }

  function addNode(node: SceneNode): string {
    if (current.objects.length + nodes.length >= LIMITS.maxObjects) {
      throw new Error("Import would exceed the project object limit of 400. Import a smaller or optimized model.");
    }
    nodes.push(node);
    return node.id;
  }

  async function visit(object: THREE.Object3D, parentId: string | null): Promise<void> {
    if ((object as THREE.Camera).isCamera) {
      warnings.add("Cameras in imported GLB files are not imported into the editable scene.");
      return;
    }
    if ((object as THREE.Light).isLight) {
      warnings.add("Lights in imported GLB files are not imported as editable Forge lights yet.");
      return;
    }

    const mesh = object as THREE.Mesh;
    const isMesh = Boolean(mesh.isMesh && mesh.geometry);
    let nodeId: string;
    let childParentId: string;

    if (isMesh) {
      if (object instanceof THREE.SkinnedMesh || mesh.geometry.morphAttributes.position?.length) {
        warnings.add("Rigged/skinned or morph-target meshes are imported in their current base pose; deformation/face animation is not preserved yet.");
      }
      const position = mesh.geometry.getAttribute("position");
      if (!position || position.count < 3) {
        warnings.add("A mesh with no usable position data was skipped.");
        return;
      }
      if (position.count > LIMITS.maxVerticesPerMesh) {
        warnings.add("A mesh above the per-mesh vertex limit was skipped.");
        return;
      }

      const matArray = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      const groups = mesh.geometry.groups.filter((group) => group.count > 0);
      const splitGroups = matArray.length > 1 && groups.length > 0;
      if (splitGroups) {
        const groupNode = makeNode({
          name: object.name || "Imported Mesh",
          type: "group",
          source: "import",
          parentId,
          position: vec3Array(object.position),
          rotation: rotationDegrees(object),
          scale: vec3Array(object.scale),
        });
        nodeId = addNode(groupNode);
        childParentId = nodeId;
        if (object.name && !ambiguousNames.has(object.name)) nodeByName.set(object.name, nodeId);
        for (const group of groups) {
          const materialIndex = group.materialIndex ?? 0;
          const material = matArray[materialIndex] ?? matArray[0];
          const geometry = customGeometry(mesh.geometry, group);
          if (!geometry) continue;
          const surface = await materialSpec(material, object.name || "Imported Surface");
          const child = makeNode({
            name: (object.name || "Imported Mesh") + " · surface " + (materialIndex + 1),
            type: "mesh",
            source: "import",
            parentId: nodeId,
            position: [0, 0, 0],
            rotation: [0, 0, 0],
            scale: [1, 1, 1],
            geometry,
            material: surface,
          });
          addNode(child);
        }
      } else {
        const geometry = customGeometry(mesh.geometry);
        if (!geometry) {
          warnings.add("A mesh geometry could not be converted and was skipped.");
          return;
        }
        const material = await materialSpec(matArray[0], object.name || "Imported Mesh");
        const node = makeNode({
          name: object.name || "Imported Mesh",
          type: "mesh",
          source: "import",
          parentId,
          position: vec3Array(object.position),
          rotation: rotationDegrees(object),
          scale: vec3Array(object.scale),
          geometry,
          material,
        });
        nodeId = addNode(node);
        childParentId = nodeId;
          if (object.name && !ambiguousNames.has(object.name)) nodeByName.set(object.name, nodeId);
      }
    } else {
      const node = makeNode({
        name: object.name || (object === root ? file.name.replace(/\.(glb|gltf)$/i, "") : object.type || "Imported Group"),
        type: "group",
        source: "import",
        parentId,
        position: vec3Array(object.position),
        rotation: rotationDegrees(object),
        scale: vec3Array(object.scale),
      });
      nodeId = addNode(node);
      childParentId = nodeId;
      if (object.name && !ambiguousNames.has(object.name)) nodeByName.set(object.name, nodeId);
    }

    for (const child of object.children) {
      await visit(child, childParentId);
    }
  }

  await visit(root, null);

  const clips: AnimClip[] = [];
  let droppedAnimationTracks = 0;
  for (const animation of gltf.animations) {
    const tracks: AnimTrack[] = [];
    for (const track of animation.tracks) {
      const match = track.name.match(/^(.*)\.(position|rotation|quaternion|scale)$/);
      if (!match || match[1].includes(".bones[") || ambiguousNames.has(match[1])) {
        droppedAnimationTracks += 1;
        continue;
      }
      const objectId = nodeByName.get(match[1]);
      if (!objectId) {
        droppedAnimationTracks += 1;
        continue;
      }
      const propertyName = match[2];
      const valueSize = track.getValueSize();
      const expected = propertyName === "quaternion" ? 4 : 3;
      if (valueSize !== expected || track.values.length < track.times.length * valueSize) {
        droppedAnimationTracks += 1;
        continue;
      }
      const property: AnimTrack["property"] =
        propertyName === "quaternion" ? "quaternion" : propertyName as AnimTrack["property"];
      const keyframes = Array.from(track.times).map((time, index) => ({
        time,
        value: Array.from(track.values.slice(index * valueSize, (index + 1) * valueSize)),
      }));
      tracks.push({
        id: crypto.randomUUID(),
        objectId,
        property,
        interpolation: "linear" as const,
        keyframes,
      });
    }
    if (tracks.length) {
      clips.push({
        id: crypto.randomUUID(),
        name: animation.name || "Imported Animation " + (clips.length + 1),
        duration: Math.max(0.01, animation.duration),
        loop: true,
        source: "import",
        tracks,
      });
    }
  }
  if (droppedAnimationTracks > 0) {
    warnings.add(droppedAnimationTracks + " animation track(s) could not be converted to Forge transform tracks; skeletal and morph animation are not preserved yet.");
  }
  if (!nodes.some((node) => node.type === "mesh")) {
    throw new Error("No editable mesh was found in this GLB.");
  }

  const mergedObjects = [...current.objects, ...nodes];
  const mergedTextures = [...current.textures, ...textures];
  const mergedClips = [...current.clips, ...clips];
  const bounds = new THREE.Box3().setFromObject(root);
  const center = new THREE.Vector3();
  const size = new THREE.Vector3();
  bounds.getCenter(center);
  bounds.getSize(size);
  const span = Math.max(size.x, size.y, size.z, 1);
  const viewDirection = new THREE.Vector3(1, 0.65, 1.35).normalize();
  const cameraDistance = span * 1.9 + 0.5;
  const framedCamera = {
    ...current.scene.camera,
    target: vec3Array(center),
    position: [
      center.x + viewDirection.x * cameraDistance,
      center.y + viewDirection.y * cameraDistance,
      center.z + viewDirection.z * cameraDistance,
    ] as [number, number, number],
    near: Math.max(0.01, span / 10000),
    far: Math.max(400, span * 100),
  };
  return {
    project: {
      ...current,
      name: current.name || file.name.replace(/\.(glb|gltf)$/i, ""),
      objects: mergedObjects,
      textures: mergedTextures,
      clips: mergedClips,
      scene: { ...current.scene, camera: framedCamera },
      autoplayClipId: clips[0]?.id ?? current.autoplayClipId ?? null,
      updatedAt: Date.now(),
    },
    meshesAdded: nodes.filter((node) => node.type === "mesh").length,
    texturesAdded: textures.length,
    animationsAdded: clips.length,
    warnings: [...warnings],
  };
}
