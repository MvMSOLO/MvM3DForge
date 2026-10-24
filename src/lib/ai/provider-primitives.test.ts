import assert from "node:assert/strict";
import test from "node:test";
import { AI_PROVIDERS, isAiProviderId } from "./provider-primitives.ts";

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
