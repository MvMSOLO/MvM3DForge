import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from "node:crypto";
import { getSql } from "@/lib/db";
import { mcpOAuthSigningSecret } from "@/lib/auth/server";

import { AI_PROVIDERS, isAiProviderId, parseAiProviderModels, type AiModel, type AiProviderId, type AiProviderKind } from "./provider-primitives.ts";
export { AI_PROVIDERS, isAiProviderId } from "./provider-primitives.ts";
export type { AiModel, AiProviderId, AiProviderKind } from "./provider-primitives.ts";

export interface AiProviderConnection {
  id: string;
  user_id: string;
  provider: AiProviderId;
  encrypted_api_key: string;
  preferred_model: string;
  created_at: number | string;
  updated_at: number | string;
}

export interface PublicAiProviderConnection {
  provider: AiProviderId;
  name: string;
  connected: true;
  preferredModel: string;
  updatedAt: number;
}


function providerConfig(provider: AiProviderId) {
  switch (provider) {
    case "openai": return { baseUrl: "https://api.openai.com/v1", kind: "openai" as const };
    case "anthropic": return { baseUrl: "https://api.anthropic.com/v1", kind: "anthropic" as const };
    case "google": return { baseUrl: "https://generativelanguage.googleapis.com/v1beta", kind: "google" as const };
    case "groq": return { baseUrl: "https://api.groq.com/openai/v1", kind: "openai" as const };
    case "openrouter": return { baseUrl: "https://openrouter.ai/api/v1", kind: "openai" as const };
    case "deepseek": return { baseUrl: "https://api.deepseek.com/v1", kind: "openai" as const };
    case "mistral": return { baseUrl: "https://api.mistral.ai/v1", kind: "openai" as const };
    case "xai": return { baseUrl: "https://api.x.ai/v1", kind: "openai" as const };
    case "together": return { baseUrl: "https://api.together.xyz/v1", kind: "openai" as const };
  }
}

function encryptionKey(): Buffer {
  return createHash("sha256")
    .update("mvm3d:ai-provider-secrets:v1:")
    .update(mcpOAuthSigningSecret)
    .digest();
}

function encryptApiKey(apiKey: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(apiKey, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv, tag, encrypted].map((part) => part.toString("base64url")).join(".");
}

function decryptApiKey(value: string): string {
  const parts = value.split(".");
  if (parts.length !== 3) throw new Error("The saved provider key could not be decrypted. Reconnect this provider.");
  const [ivText, tagText, encryptedText] = parts;
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(ivText, "base64url"));
  decipher.setAuthTag(Buffer.from(tagText, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(encryptedText, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}

function normalizeModelName(id: string): string {
  return id.replace(/^models\//, "").trim();
}

function modelIsChatCapable(id: string): boolean {
  return !/(^|[-_/])(embedding|embed|rerank|moderation|whisper|transcrib|tts|text-to-speech|image-generation|realtime-preview)([-_/]|$)/i.test(id);
}

function userFacingModelName(id: string, displayName?: string): string {
  const clean = (displayName || id).replace(/^models\//, "").slice(0, 180);
  return clean || id;
}

function parseProviderError(text: string, fallback: string): string {
  try {
    const parsed = JSON.parse(text) as Record<string, unknown>;
    const error = parsed.error;
    if (typeof error === "string") return error.slice(0, 400);
    if (error && typeof error === "object") {
      const row = error as Record<string, unknown>;
      const candidate = row.message ?? row.status ?? row.code;
      if (typeof candidate === "string") return candidate.slice(0, 400);
    }
    if (typeof parsed.message === "string") return parsed.message.slice(0, 400);
  } catch {
    // Provider errors are not guaranteed to use JSON. Do not return raw HTML.
  }
  return fallback;
}

async function providerFetch(url: string, apiKey: string, provider: AiProviderId, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set("accept", "application/json");
  if (provider === "anthropic") {
    headers.set("x-api-key", apiKey);
    headers.set("anthropic-version", "2023-06-01");
  } else if (provider === "google") {
    headers.set("x-goog-api-key", apiKey);
  } else {
    headers.set("authorization", `Bearer ${apiKey}`);
    if (provider === "openrouter") {
      headers.set("http-referer", "https://mvm3d.vercel.app");
      headers.set("x-title", "MVM3D");
    }
  }
  return fetch(url, {
    ...init,
    headers,
    redirect: "error",
    signal: init.signal ?? AbortSignal.timeout(12_000),
    cache: "no-store",
  });
}

export async function discoverAiModels(provider: AiProviderId, apiKey: string): Promise<AiModel[]> {
  const config = providerConfig(provider);
  const url = provider === "google"
    ? `${config.baseUrl}/models?pageSize=100`
    : `${config.baseUrl}/models`;
  let response: Response;
  try {
    response = await providerFetch(url, apiKey, provider, { method: "GET" });
  } catch {
    throw new Error("Could not reach the provider. Check your internet connection and try again.");
  }
  if (!response.ok) {
    const error = await response.text().catch(() => "");
    if (response.status === 401 || response.status === 403) {
      throw new Error("The provider rejected this API key. Check that the key belongs to the selected provider.");
    }
    throw new Error(parseProviderError(error, `Provider model discovery failed (HTTP ${response.status}).`));
  }
  const payload: unknown = await response.json();
  const models = parseAiProviderModels(provider, payload);
  if (!models.length) throw new Error("The provider authenticated, but did not return any supported chat models.");
  return models;
}

async function getConnection(userId: string, provider: AiProviderId): Promise<AiProviderConnection | null> {
  const sql = await getSql();
  const rows = await sql.query<AiProviderConnection>(
    "SELECT id, user_id, provider, encrypted_api_key, preferred_model, created_at, updated_at FROM ai_provider_connections WHERE user_id = $1 AND provider = $2 LIMIT 1",
    [userId, provider],
  );
  return rows[0] ?? null;
}

export async function listAiProviderConnections(userId: string): Promise<PublicAiProviderConnection[]> {
  const sql = await getSql();
  const rows = await sql.query<AiProviderConnection>(
    "SELECT id, user_id, provider, encrypted_api_key, preferred_model, created_at, updated_at FROM ai_provider_connections WHERE user_id = $1 ORDER BY provider",
    [userId],
  );
  const configs = new Map<string, (typeof AI_PROVIDERS)[number]>(AI_PROVIDERS.map((row) => [row.id, row]));
  return rows.flatMap((row) => {
    const config = configs.get(row.provider);
    if (!config) return [];
    return [{
      provider: row.provider,
      name: config.name,
      connected: true as const,
      preferredModel: row.preferred_model,
      updatedAt: Number(row.updated_at),
    }];
  });
}

export async function connectAiProvider(input: {
  userId: string;
  provider: AiProviderId;
  apiKey: string;
  preferredModel?: string;
}): Promise<{ connection: PublicAiProviderConnection; models: AiModel[] }> {
  const userId = input.userId.trim();
  const apiKey = input.apiKey.trim();
  if (!userId) throw new Error("Sign in before connecting an AI provider.");
  if (apiKey.length < 8 || apiKey.length > 4096 || /[\r\n]/.test(apiKey)) throw new Error("Enter a valid provider API key.");
  const models = await discoverAiModels(input.provider, apiKey);
  const requestedModel = typeof input.preferredModel === "string" ? normalizeModelName(input.preferredModel) : "";
  const model = requestedModel && models.some((item) => item.id === requestedModel)
    ? requestedModel
    : models[0].id;
  const now = Date.now();
  const sql = await getSql();
  const id = randomUUID();
  const encrypted = encryptApiKey(apiKey);
  await sql.query(
    `INSERT INTO ai_provider_connections (id, user_id, provider, encrypted_api_key, preferred_model, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $6)
     ON CONFLICT (user_id, provider)
     DO UPDATE SET encrypted_api_key = EXCLUDED.encrypted_api_key, preferred_model = EXCLUDED.preferred_model, updated_at = EXCLUDED.updated_at`,
    [id, userId, input.provider, encrypted, model, now],
  );
  const config = AI_PROVIDERS.find((item) => item.id === input.provider)!;
  return {
    connection: { provider: input.provider, name: config.name, connected: true, preferredModel: model, updatedAt: now },
    models,
  };
}

export async function listUserAiModels(userId: string, provider: AiProviderId): Promise<AiModel[]> {
  const record = await getConnection(userId, provider);
  if (!record) throw new Error("Connect this provider before loading its models.");
  return discoverAiModels(provider, decryptApiKey(record.encrypted_api_key));
}

export async function updateAiProviderModel(userId: string, provider: AiProviderId, modelValue: string): Promise<PublicAiProviderConnection> {
  const model = normalizeModelName(modelValue);
  if (!model || model.length > 240) throw new Error("Choose a valid model.");
  const record = await getConnection(userId, provider);
  if (!record) throw new Error("Connect this provider before selecting a model.");
  const models = await discoverAiModels(provider, decryptApiKey(record.encrypted_api_key));
  if (!models.some((entry) => entry.id === model)) throw new Error("This model was not returned by the provider. Refresh the model list and select an available one.");
  const now = Date.now();
  const sql = await getSql();
  await sql.query(
    "UPDATE ai_provider_connections SET preferred_model = $1, updated_at = $2 WHERE user_id = $3 AND provider = $4",
    [model, now, userId, provider],
  );
  const config = AI_PROVIDERS.find((item) => item.id === provider)!;
  return { provider, name: config.name, connected: true, preferredModel: model, updatedAt: now };
}

export async function disconnectAiProvider(userId: string, provider: AiProviderId): Promise<boolean> {
  const sql = await getSql();
  const rows = await sql.query<{ provider: string }>(
    "DELETE FROM ai_provider_connections WHERE user_id = $1 AND provider = $2 RETURNING provider",
    [userId, provider],
  );
  return rows.length > 0;
}

export async function generateWithAiProvider(input: {
  userId: string;
  provider: AiProviderId;
  prompt: string;
  code?: string;
}): Promise<{ provider: AiProviderId; model: string; text: string; code: string | null }> {
  const prompt = input.prompt.trim();
  if (!prompt || prompt.length > 12_000) throw new Error("Prompt must contain 1–12,000 characters.");
  const record = await getConnection(input.userId, input.provider);
  if (!record) throw new Error("Connect an AI provider in Studio → Integrations first.");
  const apiKey = decryptApiKey(record.encrypted_api_key);
  const config = providerConfig(input.provider);
  const system = [
    "You are the coding assistant inside MVM3D, a code-first 3D studio that builds actual scenes, not prompt-generated meshes.",
    "Generate complete JavaScript that runs in the MVM3D restricted browser sandbox. Do not use import statements, TypeScript syntax, Node APIs, process, arbitrary network requests, or environment variables.",
    "The sandbox provides mvm, THREE, scene, and console. Prefer mvm.geometry.*, mvm.material.pbr(...), mvm.scene.add(...), mvm.light.*, mvm.animation.clip/track/play, and mvm.texture.* for editable, persistable objects. Raw Three.js objects that are not recorded by the MVM SDK may not round-trip to project data.",
    "Create visible geometry and add it to the scene. Use realistic proportions, layered parts, purposeful materials, proper lights and an interesting camera composition. Avoid meaningless piles of primitives.",
    "For animations, use mvm.animation.clip({name,duration,loop}), mvm.animation.track(clip,{object,property,interpolation,keys}), and mvm.animation.play(name). Ensure clip keyframes stay within duration.",
    "Return a concise explanation first, then exactly one fenced JavaScript code block containing the complete script. Do not claim to have executed or tested code.",
  ].join("\n");
  const codeContext = (input.code || "").slice(0, 18_000);
  const userMessage = `USER TASK:\n${prompt}\n\nCURRENT STUDIO SCRIPT:\n${codeContext || "(empty script)"}`;
  let url: string;
  const headers: Record<string, string> = { "content-type": "application/json" };
  let body: unknown;
  if (config.kind === "anthropic") {
    url = `${config.baseUrl}/messages`;
    body = { model: record.preferred_model, max_tokens: 4096, temperature: 0.2, system, messages: [{ role: "user", content: userMessage }] };
  } else if (config.kind === "google") {
    url = `${config.baseUrl}/models/${encodeURIComponent(normalizeModelName(record.preferred_model))}:generateContent`;
    body = {
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ role: "user", parts: [{ text: userMessage }] }],
      generationConfig: { temperature: 0.2, maxOutputTokens: 4096 },
    };
  } else {
    url = `${config.baseUrl}/chat/completions`;
    body = {
      model: record.preferred_model,
      messages: [{ role: "system", content: system }, { role: "user", content: userMessage }],
      temperature: 0.2,
      max_tokens: 4096,
    };
  }
  let response: Response;
  try {
    response = await providerFetch(url, apiKey, input.provider, { method: "POST", headers, body: JSON.stringify(body), signal: AbortSignal.timeout(45_000) });
  } catch {
    throw new Error("The provider request failed to connect or timed out. Check the provider and model, then retry.");
  }
  if (!response.ok) {
    const error = await response.text().catch(() => "");
    if (response.status === 401 || response.status === 403) throw new Error("The provider rejected this key. Reconnect it with a valid API key.");
    throw new Error(parseProviderError(error, `The provider returned HTTP ${response.status}.`));
  }
  const payload = await response.json() as Record<string, unknown>;
  let text = "";
  if (config.kind === "anthropic") {
    const parts = Array.isArray(payload.content) ? payload.content : [];
    text = parts.flatMap((part) => part && typeof part === "object" && (part as Record<string, unknown>).type === "text" && typeof (part as Record<string, unknown>).text === "string" ? [(part as Record<string, string>).text] : []).join("\n");
  } else if (config.kind === "google") {
    const candidates = Array.isArray(payload.candidates) ? payload.candidates : [];
    for (const candidate of candidates) {
      if (!candidate || typeof candidate !== "object") continue;
      const content = (candidate as Record<string, unknown>).content;
      const parts = content && typeof content === "object" && Array.isArray((content as Record<string, unknown>).parts) ? (content as { parts: unknown[] }).parts : [];
      text += parts.flatMap((part) => part && typeof part === "object" && typeof (part as Record<string, unknown>).text === "string" ? [(part as Record<string, string>).text] : []).join("\n");
    }
  } else {
    const choices = Array.isArray(payload.choices) ? payload.choices : [];
    const message = choices[0] && typeof choices[0] === "object" ? (choices[0] as Record<string, unknown>).message : null;
    text = message && typeof message === "object" && typeof (message as Record<string, unknown>).content === "string"
      ? String((message as Record<string, unknown>).content)
      : "";
  }
  if (!text.trim()) throw new Error("The provider response did not contain any text. Try a different model.");
  const codeMatch = text.match(/```(?:javascript|js|mvm)?\s*\n([\s\S]*?)```/i);
  const generatedCode = codeMatch?.[1]?.trim() || null;
  const configName = input.provider;
  return { provider: configName, model: record.preferred_model, text: text.slice(0, 40_000), code: generatedCode && generatedCode.length <= 40_000 ? generatedCode : null };
}
