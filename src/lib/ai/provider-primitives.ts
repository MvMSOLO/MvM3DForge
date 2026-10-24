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
