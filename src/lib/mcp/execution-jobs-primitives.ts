import { LIMITS } from "../../forge/limits.ts";
export type McpExecutionJobKind = "script" | "render";
export type McpExecutionJobStatus = "queued" | "running" | "awaiting_capture" | "completed" | "failed";
export interface EnqueueMcpExecutionJobInput {
  userId: string; projectId: string; kind: McpExecutionJobKind;
  code: string; applyChanges: boolean; baseUpdatedAt: number;
}
export function validateMcpJobInput(input: EnqueueMcpExecutionJobInput): void {
  if (!input.userId.trim()) throw new Error("A verified user identity is required.");
  if (!input.projectId.trim()) throw new Error("A saved project is required.");
  if (input.kind !== "script" && input.kind !== "render") throw new Error("Unsupported MCP job kind.");
  if (input.kind === "script" && (!input.code.trim() || input.code.length > LIMITS.maxCodeChars)) {
    throw new Error("Script code must contain 1 to " + LIMITS.maxCodeChars + " characters.");
  }
  if (input.kind === "render" && input.code.length !== 0) throw new Error("Render jobs do not accept executable code.");
  if (!Number.isSafeInteger(input.baseUpdatedAt) || input.baseUpdatedAt < 0) throw new Error("Project revision is invalid.");
  if (input.applyChanges && input.kind !== "script") throw new Error("Only script jobs can apply changes.");
}
