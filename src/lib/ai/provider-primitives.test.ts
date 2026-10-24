import assert from "node:assert/strict";
import test from "node:test";
import { AI_PROVIDERS, isAiProviderId, parseAiProviderModels } from "./provider-primitives.ts";

test("the AI provider catalog exposes nine supported integrations", () => {
  assert.equal(AI_PROVIDERS.length, 9);
  assert.deepEqual(AI_PROVIDERS.map((provider) => provider.id), [
    "openai", "anthropic", "google", "groq", "openrouter",
    "deepseek", "mistral", "xai", "together",
  ]);
});

test("provider validation rejects unknown and malformed identifiers", () => {
  for (const id of AI_PROVIDERS.map((provider) => provider.id)) assert.equal(isAiProviderId(id), true);
  assert.equal(isAiProviderId("random-host"), false);
  assert.equal(isAiProviderId("../api"), false);
  assert.equal(isAiProviderId(null), false);
  assert.equal(isAiProviderId({ id: "openai" }), false);
});

test("provider model parser accepts list and OpenAI-compatible data response shapes", () => {
  const direct = [
    { id: "gpt-4.1", display_name: "GPT 4.1" },
    { id: "text-embedding-3-small", display_name: "Embedding model" },
    { id: "gpt-4o-mini", displayName: "GPT-4o mini" },
  ];
  const models = parseAiProviderModels("openai", direct);
  assert.deepEqual(models, [
    { id: "gpt-4o-mini", name: "GPT-4o mini" },
    { id: "gpt-4.1", name: "GPT 4.1" },
  ]);
  assert.deepEqual(parseAiProviderModels("groq", { data: [{ id: "llama-3.3-70b-versatile" }] }), [
    { id: "llama-3.3-70b-versatile", name: "llama-3.3-70b-versatile" },
  ]);
});

test("Gemini model parser keeps only models that support generateContent", () => {
  const models = parseAiProviderModels("google", {
    models: [
      { name: "models/gemini-2.5-flash", displayName: "Gemini 2.5 Flash", supportedGenerationMethods: ["generateContent"] },
      { name: "models/text-embedding-004", supportedGenerationMethods: ["embedContent"] },
      { name: "models/imagen-4", supportedGenerationMethods: ["predict"] },
      { name: "models/gemini-2.0-flash-tts", supportedGenerationMethods: ["generateContent"] },
    ],
  });
  assert.deepEqual(models, [{ id: "gemini-2.5-flash", name: "Gemini 2.5 Flash" }]);
});

test("model parser rejects malformed entries and normalizes duplicate identifiers", () => {
  const models = parseAiProviderModels("openrouter", {
    data: [
      { id: "model-b", name: "first" },
      { id: "model-b", display_name: "second" },
      { id: "too-long" + "x".repeat(250) },
      null,
      "not-a-model",
    ],
  });
  assert.deepEqual(models, [{ id: "model-b", name: "second" }]);
});
