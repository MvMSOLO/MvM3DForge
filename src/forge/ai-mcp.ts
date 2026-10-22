import type { Project, SceneNode } from "@/forge/types.ts";

export interface AIProviderConfig {
  id: string;
  name: string;
  type: "openai" | "anthropic" | "gemini" | "custom";
  endpoint?: string;
  apiKey?: string;
  model: string;
}

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

export const DEFAULT_AI_PROVIDERS: AIProviderConfig[] = [
  { id: "openai-default", name: "OpenAI GPT-4o", type: "openai", model: "gpt-4o" },
  { id: "anthropic-default", name: "Anthropic Claude 3.5 Sonnet", type: "anthropic", model: "claude-3-5-sonnet-20241022" },
  { id: "gemini-default", name: "Google Gemini 1.5 Pro", type: "gemini", model: "gemini-1.5-pro" },
  { id: "local-ollama", name: "Local Ollama / OpenAI Compatible", type: "custom", endpoint: "http://localhost:11434/v1", model: "llama3" },
];

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
