export const AI_PROVIDERS = [
  { id: "openai", name: "OpenAI", kind: "openai" },
  { id: "anthropic", name: "Anthropic", kind: "anthropic" },
  { id: "google", name: "Google Gemini", kind: "google" },
  { id: "groq", name: "Groq", kind: "openai" },
  { id: "openrouter", name: "OpenRouter", kind: "openai" },
  { id: "deepseek", name: "DeepSeek", kind: "openai" },
  { id: "mistral", name: "Mistral AI", kind: "openai" },
  { id: "xai", name: "xAI", kind: "openai" },
  { id: "together", name: "Together AI", kind: "openai" },
] as const;

export type AiProviderId = (typeof AI_PROVIDERS)[number]["id"];
export type AiProviderKind = (typeof AI_PROVIDERS)[number]["kind"];

export function isAiProviderId(value: unknown): value is AiProviderId {
  return typeof value === "string" && AI_PROVIDERS.some((provider) => provider.id === value);
}

export interface AiModel {
  id: string;
  name: string;
}

function normalizeModelId(value: string): string {
  return value.replace(/^models\//, "").trim();
}

function isChatCapableModel(value: string): boolean {
  return !/(embedding|rerank|moderation|whisper|transcrib|\btts\b|text-to-speech|image-generation|realtime-preview)/i.test(value);
}

/** Normalizes common provider model-list response shapes without making network calls. */
export function parseAiProviderModels(provider: AiProviderId, payload: unknown): AiModel[] {
  const body = payload && typeof payload === "object" && !Array.isArray(payload)
    ? payload as Record<string, unknown>
    : {};
  const records: unknown[] = Array.isArray(payload)
    ? payload
    : provider === "google"
      ? (Array.isArray(body.models) ? body.models : [])
      : (Array.isArray(body.data) ? body.data : Array.isArray(body.models) ? body.models : []);
  const byId = new Map<string, AiModel>();
  for (const item of records) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const row = item as Record<string, unknown>;
    const rawId = typeof row.id === "string" ? row.id : typeof row.name === "string" ? row.name : "";
    const id = normalizeModelId(rawId);
    if (!id || id.length > 240 || !isChatCapableModel(id)) continue;
    if (provider === "google") {
      const methods = row.supportedGenerationMethods;
      if (Array.isArray(methods) && !methods.includes("generateContent")) continue;
    }
    const rawName = typeof row.displayName === "string"
      ? row.displayName
      : typeof row.display_name === "string"
        ? row.display_name
        : id;
    const name = rawName.replace(/^models\//, "").trim().slice(0, 180) || id;
    byId.set(id, { id, name });
  }
  return [...byId.values()].sort((a, b) => a.id.localeCompare(b.id)).slice(0, 250);
}
