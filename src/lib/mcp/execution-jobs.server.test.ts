import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { validateMcpJobInput } from "./execution-jobs-primitives.ts";
describe("MCP browser execution job validation", () => {
  const base = { userId: "user-a", projectId: "project-a", kind: "script" as const, code: "mvm.geometry.box({ name: 'Preview' });", applyChanges: false, baseUpdatedAt: 123 };
  it("accepts preview and explicit apply jobs", () => {
    assert.doesNotThrow(() => validateMcpJobInput(base));
    assert.doesNotThrow(() => validateMcpJobInput({ ...base, applyChanges: true }));
  });
  it("rejects missing ownership fields, empty scripts and invalid revisions", () => {
    assert.throws(() => validateMcpJobInput({ ...base, userId: " " }));
    assert.throws(() => validateMcpJobInput({ ...base, projectId: "" }));
    assert.throws(() => validateMcpJobInput({ ...base, code: "" }));
    assert.throws(() => validateMcpJobInput({ ...base, baseUpdatedAt: -1 }));
  });
  it("accepts render jobs only without executable code", () => {
    assert.doesNotThrow(() => validateMcpJobInput({ ...base, kind: "render", code: "" }));
    assert.throws(() => validateMcpJobInput({ ...base, kind: "render", code: "console.log('no')" }));
  });
  it("rejects unsupported kinds and apply-on-render", () => {
    assert.throws(() => validateMcpJobInput({ ...base, kind: "shell" as never }));
    assert.throws(() => validateMcpJobInput({ ...base, kind: "render", code: "", applyChanges: true }));
  });
});
