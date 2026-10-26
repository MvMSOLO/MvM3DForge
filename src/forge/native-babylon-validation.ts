export const MAX_NATIVE_BABYLON_SCENE_CHARS = 2_000_000;
export const MAX_NATIVE_BABYLON_MESHES = 400;

/**
 * Server-side boundary for a native Babylon scene submitted by the browser bridge.
 * The browser enforces the same limits for UX, but the server does not trust that check.
 */
export function validateNativeBabylonScene(value: unknown): string | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return "Native Babylon patch is missing its serialized scene object.";
  }

  let serialized: string | undefined;
  try {
    serialized = JSON.stringify(value);
  } catch {
    return "Native Babylon scene cannot be serialized as JSON.";
  }
  if (!serialized) return "Native Babylon scene JSON is empty.";
  if (serialized.length > MAX_NATIVE_BABYLON_SCENE_CHARS) {
    return `Native Babylon scene exceeds the ${MAX_NATIVE_BABYLON_SCENE_CHARS}-character server limit.`;
  }

  const scene = value as Record<string, unknown>;
  if (!Array.isArray(scene.meshes)) {
    return "Native Babylon scene JSON is missing its meshes array.";
  }
  if (scene.meshes.length === 0) {
    return "Native Babylon scene must contain at least one mesh.";
  }
  if (scene.meshes.length > MAX_NATIVE_BABYLON_MESHES) {
    return `Native Babylon scene exceeds the ${MAX_NATIVE_BABYLON_MESHES}-mesh server limit.`;
  }
  if (scene.meshes.some((mesh) => !mesh || typeof mesh !== "object" || Array.isArray(mesh))) {
    return "Native Babylon scene contains an invalid mesh record.";
  }
  return null;
}
