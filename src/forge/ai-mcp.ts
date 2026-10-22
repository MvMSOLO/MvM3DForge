import type { Project } from "@/forge/types.ts";

export interface MCPConnectionConfig {
  id: string;
  name: string;
  transport: "http" | "sse" | "websocket";
  url: string;
  status: "connected" | "disconnected" | "error";
  permissions: {
    readScene: boolean;
    mutateScene: boolean;
    executeScript: boolean;
  };
}

export function buildMCPSceneResource(project: Project): string {
  const summary = {
    projectId: project.id,
    projectName: project.name,
    objectsCount: project.objects.length,
    meshes: project.objects.filter((o) => o.type === "mesh").map((m) => ({
      id: m.id,
      name: m.name,
      position: m.position,
      rotation: m.rotation,
      scale: m.scale,
      geometryKind: m.geometry?.kind,
      materialColor: m.material?.color,
    })),
    lights: project.objects.filter((o) => o.type === "light").map((l) => ({
      id: l.id,
      name: l.name,
      kind: l.light?.kind,
      color: l.light?.color,
      intensity: l.light?.intensity,
    })),
    clipsCount: project.clips.length,
  };
  return JSON.stringify(summary, null, 2);
}

export function validateMCPToolExecution(
  toolName: string,
  args: Record<string, unknown>,
  permissions: MCPConnectionConfig["permissions"]
): { allowed: boolean; reason?: string } {
  if (toolName.startsWith("read_") && !permissions.readScene) {
    return { allowed: false, reason: "Permission denied: readScene is disabled." };
  }
  if ((toolName.startsWith("create_") || toolName.startsWith("update_") || toolName.startsWith("delete_")) && !permissions.mutateScene) {
    return { allowed: false, reason: "Permission denied: mutateScene is disabled." };
  }
  if (toolName === "execute_script" && !permissions.executeScript) {
    return { allowed: false, reason: "Permission denied: executeScript is disabled." };
  }
  return { allowed: true };
}
