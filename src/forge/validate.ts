import { LIMITS } from "./limits.ts";
import { issue } from "./errors.ts";
import type { AnimClip, ForgeIssue, SceneNode, TextureAsset } from "./types.ts";
import { vecFinite } from "./nodes.ts";

export function validateScene(input: {
  objects: SceneNode[];
  textures: TextureAsset[];
  clips: AnimClip[];
}): ForgeIssue[] {
  const issues: ForgeIssue[] = [];
  const ids = new Set<string>();
  let triangles = 0;
  let shadowLights = 0;
  const texIds = new Set(input.textures.map((t) => t.id));

  if (input.objects.length > LIMITS.maxObjects) {
    issues.push(
      issue(
        "MVM_E_OBJECT_LIMIT",
        `Scene has ${input.objects.length} objects. Budget is ${LIMITS.maxObjects}.`,
        { recoveryHint: "Delete objects or split the project." },
      ),
    );
  }

  for (const node of input.objects) {
    if (ids.has(node.id)) {
      issues.push(issue("MVM_E_DUPLICATE_ID", `Duplicate object id ${node.id}.`, { context: { id: node.id } }));
    }
    ids.add(node.id);
    if (!vecFinite(node.position) || !vecFinite(node.rotation) || !vecFinite(node.scale)) {
      issues.push(
        issue(
          "MVM_E_TRANSFORM_NON_FINITE",
          `${node.name} has a non-finite transform.`,
          { context: { id: node.id, name: node.name }, recoveryHint: "Reset the transform to 0,0,0 / 1,1,1." },
        ),
      );
    }
    if (node.scale.some((n) => n === 0)) {
      issues.push(
        issue("MVM_E_SCALE_ZERO", `${node.name} has a zero scale component and may disappear or break export.`, {
          severity: "warning",
          context: { id: node.id },
          recoveryHint: "Use a small non-zero scale instead of 0.",
        }),
      );
    }
    if (node.parentId && !input.objects.some((o) => o.id === node.parentId)) {
      issues.push(
        issue("MVM_E_PARENT_MISSING", `${node.name} references a missing parent.`, {
          severity: "warning",
          context: { id: node.id, parentId: node.parentId },
        }),
      );
    }
    if (node.type === "mesh" && node.geometry) {
      const tris = node.stats?.triangles ?? 0;
      triangles += tris;
      if (node.stats && !node.stats.hasUV) {
        const mat = node.material;
        const textured = Boolean(mat && (mat.mapId || mat.normalMapId || mat.aoMapId || mat.roughnessMapId || mat.metalnessMapId));
        if (textured) {
          issues.push(
            issue("MVM_E_UV_MISSING", `${node.name} uses a texture but has no UVs. The texture will not map correctly.`, {
              severity: "warning",
              context: { id: node.id },
              recoveryHint: "Provide uvs on the custom mesh, or use a primitive.",
            }),
          );
        }
      }
      if (node.geometry.kind === "custom") {
        const count = node.geometry.positions.length / 3;
        if (node.geometry.positions.length % 3 !== 0) {
          issues.push(issue("MVM_E_GEOMETRY_CUSTOM_INVALID", `${node.name} positions length is not a multiple of 3.`));
        }
        const idx = node.geometry.indices ?? [];
        for (const i of idx) {
          if (!Number.isInteger(i) || i < 0 || i >= count) {
            issues.push(
              issue("MVM_E_GEOMETRY_CUSTOM_INVALID", `${node.name} has an index outside the vertex range.`, {
                context: { id: node.id },
              }),
            );
            break;
          }
        }
      }
      const mat = node.material;
      if (mat) {
        const dataMaps: { key: "normalMapId" | "aoMapId" | "roughnessMapId" | "metalnessMapId"; label: string }[] = [
          { key: "normalMapId", label: "normal" },
          { key: "aoMapId", label: "ambient occlusion" },
          { key: "roughnessMapId", label: "roughness" },
          { key: "metalnessMapId", label: "metalness" },
        ];
        for (const key of ["mapId", "normalMapId", "aoMapId", "roughnessMapId", "metalnessMapId"] as const) {
          const id = mat[key];
          if (id && !texIds.has(id)) {
            issues.push(
              issue("MVM_E_TEXTURE_MISSING", `${node.name} ${key} points at a missing texture.`, {
                severity: "warning",
                context: { id: node.id, textureId: id },
              }),
            );
          }
        }
        for (const entry of dataMaps) {
          const id = mat[entry.key];
          const tex = input.textures.find((item) => item.id === id);
          if (tex && tex.colorSpace === "srgb") {
            issues.push(
              issue(
                "MVM_E_COLORSPACE",
                `${node.name} uses ${tex.name} as a ${entry.label} map but the texture is tagged sRGB. Data maps should be linear.`,
                {
                  severity: "warning",
                  context: { id: node.id, textureId: tex.id },
                  recoveryHint: "Create the texture with colorSpace: \"linear\". The renderer still samples this channel as linear data.",
                },
              ),
            );
          }
        }
        if (mat.alphaMode === "BLEND" && mat.metalness > 0.2) {
          issues.push(
            issue(
              "MVM_E_MATERIAL_BLEND_METAL",
              `${node.name} combines blend alpha with noticeable metalness. glTF viewers may not match the viewport.`,
              { severity: "warning", context: { id: node.id }, recoveryHint: "Prefer MASK alpha for metals, or lower metalness." },
            ),
          );
        }
      }
    }
    if (node.type === "light" && node.light?.kind === "hemisphere") {
      issues.push(
        issue(
          "MVM_E_LIGHT_VIEWPORT_ONLY",
          `${node.name} is a hemisphere light. It lights the viewport but is not written into GLB (KHR_lights_punctual has no hemisphere type).`,
          {
            severity: "warning",
            context: { id: node.id },
            recoveryHint: "Add a directional or ambient-equivalent point/spot light if the file must carry that fill.",
          },
        ),
      );
    }
    if (node.type === "light" && node.light?.castShadow) shadowLights += 1;
  }

  if (shadowLights > LIMITS.shadowLights) {
    issues.push(
      issue(
        "MVM_E_SHADOW_BUDGET",
        `${shadowLights} lights request shadows. Only the first ${LIMITS.shadowLights} is rendered with a shadow map.`,
        {
          severity: "warning",
          recoveryHint: "Disable castShadow on extra lights. They still export as punctual lights.",
        },
      ),
    );
  }

  if (triangles > LIMITS.maxTrianglesHard) {
    issues.push(
      issue("MVM_E_TRIANGLE_LIMIT", `Triangle count ${Math.round(triangles)} exceeds the hard limit ${LIMITS.maxTrianglesHard}.`),
    );
  } else if (triangles > LIMITS.maxTrianglesWarning) {
    issues.push(
      issue(
        "MVM_E_TRIANGLE_WARNING",
        `Triangle count ${Math.round(triangles)} is above the warning threshold ${LIMITS.maxTrianglesWarning}.`,
        { severity: "warning", recoveryHint: "Reduce segments before exporting for real-time use." },
      ),
    );
  }

  if (input.textures.length > LIMITS.maxTextures) {
    issues.push(
      issue("MVM_E_TEXTURE_LIMIT", `Texture count ${input.textures.length} exceeds ${LIMITS.maxTextures}.`),
    );
  }
  for (const tex of input.textures) {
    if (tex.width > LIMITS.maxTextureSize || tex.height > LIMITS.maxTextureSize) {
      issues.push(
        issue(
          "MVM_E_TEXTURE_LIMIT",
          `Texture ${tex.name} is ${tex.width}×${tex.height}. Max edge is ${LIMITS.maxTextureSize}. It will be downscaled on export.`,
          { severity: "warning", context: { id: tex.id } },
        ),
      );
    }
    if (!tex.generator && !tex.dataUrl) {
      issues.push(
        issue("MVM_E_TEXTURE_EMPTY", `Texture ${tex.name} has no pixels.`, {
          severity: "warning",
          context: { id: tex.id },
        }),
      );
    }
  }

  const meshIds = new Set(input.objects.filter((o) => o.type === "mesh" || o.type === "group" || o.type === "light").map((o) => o.id));
  for (const clip of input.clips) {
    if (!(clip.duration > 0) || !Number.isFinite(clip.duration)) {
      issues.push(issue("MVM_E_ANIMATION_INVALID", `Clip ${clip.name} has a non-positive duration.`));
    }
    for (const track of clip.tracks) {
      if (!meshIds.has(track.objectId)) {
        issues.push(
          issue("MVM_E_ANIMATION_INVALID", `Clip ${clip.name} targets a missing object.`, {
            severity: "warning",
            context: { track: track.id, objectId: track.objectId },
          }),
        );
      }
      if (track.keyframes.length > LIMITS.maxKeyframesPerTrack) {
        issues.push(
          issue("MVM_E_ANIMATION_INVALID", `A track on ${clip.name} exceeds ${LIMITS.maxKeyframesPerTrack} keys.`, {
            severity: "warning",
          }),
        );
      }
      for (const key of track.keyframes) {
        const expect = track.property === "quaternion" ? 4 : 3;
        if (!Number.isFinite(key.time) || key.time < 0 || key.value.length < expect || key.value.some((n) => !Number.isFinite(n))) {
          issues.push(
            issue("MVM_E_ANIMATION_INVALID", `Clip ${clip.name} has a non-finite or short keyframe.`, {
              context: { track: track.id },
            }),
          );
          break;
        }
      }
    }
  }

  const meshes = input.objects.filter((o) => o.type === "mesh" && o.geometry);
  if (!meshes.length) {
    issues.push(
      issue("MVM_E_EXPORT_EMPTY", "No mesh geometry in the scene.", {
        severity: "warning",
        recoveryHint: "Create a primitive or run a script that calls mvm.scene.add.",
      }),
    );
  }
  return issues;
}

export function triangleTotal(objects: SceneNode[]): number {
  return objects.reduce((sum, node) => sum + (node.stats?.triangles ?? 0), 0);
}
