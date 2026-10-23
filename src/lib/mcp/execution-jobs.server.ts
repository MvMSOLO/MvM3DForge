import { randomUUID } from "node:crypto";
import { getSql } from "@/lib/db";
import { LIMITS } from "@/forge/limits.ts";

export type McpExecutionJobKind = "script" | "render";
export type McpExecutionJobStatus = "queued" | "running" | "awaiting_capture" | "completed" | "failed";

export interface McpExecutionJob {
  id: string;
  userId: string;
  projectId: string;
  kind: McpExecutionJobKind;
  code: string;
  applyChanges: boolean;
  baseUpdatedAt: number;
  status: McpExecutionJobStatus;
  result: Record<string, unknown> | null;
  screenshotDataUrl: string | null;
  error: string | null;
  createdAt: number;
  updatedAt: number;
  claimedAt: number | null;
  completedAt: number | null;
}

export interface EnqueueMcpExecutionJobInput {
  userId: string;
  projectId: string;
  kind: McpExecutionJobKind;
  code: string;
  applyChanges: boolean;
  baseUpdatedAt: number;
}

export interface McpExecutionQueue {
  enqueue(input: EnqueueMcpExecutionJobInput): Promise<McpExecutionJob>;
  get(userId: string, jobId: string): Promise<McpExecutionJob | null>;
}

interface McpExecutionJobRow {
  id: string;
  user_id: string;
  project_id: string;
  job_kind: McpExecutionJobKind;
  code: string;
  apply_changes: boolean;
  base_updated_at: number;
  status: McpExecutionJobStatus;
  result_json: string | null;
  screenshot_data_url: string | null;
  error: string | null;
  created_at: number;
  updated_at: number;
  claimed_at: number | null;
  completed_at: number | null;
}

function toJob(row: McpExecutionJobRow): McpExecutionJob {
  let result: Record<string, unknown> | null = null;
  if (row.result_json) {
    try {
      const parsed: unknown = JSON.parse(row.result_json);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        result = parsed as Record<string, unknown>;
      }
    } catch {
      result = { ok: false, error: "Saved job result was not valid JSON." };
    }
  }
  return {
    id: row.id,
    userId: row.user_id,
    projectId: row.project_id,
    kind: row.job_kind,
    code: row.code,
    applyChanges: Boolean(row.apply_changes),
    baseUpdatedAt: Number(row.base_updated_at),
    status: row.status,
    result,
    screenshotDataUrl: row.screenshot_data_url,
    error: row.error,
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
    claimedAt: row.claimed_at == null ? null : Number(row.claimed_at),
    completedAt: row.completed_at == null ? null : Number(row.completed_at),
  };
}

export function validateMcpJobInput(input: EnqueueMcpExecutionJobInput): void {
  if (!input.userId.trim()) throw new Error("A verified user identity is required.");
  if (!input.projectId.trim()) throw new Error("A saved project is required.");
  if (input.kind !== "script" && input.kind !== "render") throw new Error("Unsupported MCP job kind.");
  if (input.kind === "script" && (!input.code.trim() || input.code.length > LIMITS.maxCodeChars)) {
    throw new Error("Script code must contain 1 to " + LIMITS.maxCodeChars + " characters.");
  }
  if (input.kind === "render" && input.code.length !== 0) {
    throw new Error("Render jobs do not accept executable code.");
  }
  if (!Number.isSafeInteger(input.baseUpdatedAt) || input.baseUpdatedAt < 0) {
    throw new Error("Project revision is invalid.");
  }
  if (input.applyChanges && input.kind !== "script") {
    throw new Error("Only script jobs can apply changes.");
  }
}

export async function enqueueMcpExecutionJob(input: EnqueueMcpExecutionJobInput): Promise<McpExecutionJob> {
  validateMcpJobInput(input);
  const sql = await getSql();
  const now = Date.now();
  const id = randomUUID();
  const rows = await sql<McpExecutionJobRow>`
    INSERT INTO mcp_execution_jobs (
      id, user_id, project_id, job_kind, code, apply_changes, base_updated_at,
      status, result_json, screenshot_data_url, error, created_at, updated_at, claimed_at, completed_at
    ) VALUES (
      ${id}, ${input.userId}, ${input.projectId}, ${input.kind}, ${input.code},
      ${input.applyChanges}, ${input.baseUpdatedAt}, 'queued', NULL, NULL, NULL,
      ${now}, ${now}, NULL, NULL
    )
    RETURNING *
  `;
  if (!rows[0]) throw new Error("Could not queue the MCP job.");
  return toJob(rows[0]);
}

export async function getMcpExecutionJob(userId: string, jobId: string): Promise<McpExecutionJob | null> {
  if (!userId || !jobId) return null;
  const sql = await getSql();
  const rows = await sql<McpExecutionJobRow>`
    SELECT * FROM mcp_execution_jobs WHERE id = ${jobId} AND user_id = ${userId} LIMIT 1
  `;
  return rows[0] ? toJob(rows[0]) : null;
}

/**
 * Claim one queued job for the signed-in owner and the exact open project.
 * The UPDATE's status predicate makes simultaneous Studio tabs safe: only one
 * browser can claim a job.
 */
export async function claimNextMcpExecutionJob(userId: string, projectId: string): Promise<McpExecutionJob | null> {
  const sql = await getSql();
  const now = Date.now();
  const staleAt = now - 3 * 60 * 1000;

  await sql`
    UPDATE mcp_execution_jobs
       SET status = 'failed',
           error = 'Studio timed out before returning a result. Reopen the project and submit the job again.',
           updated_at = ${now},
           completed_at = ${now}
     WHERE user_id = ${userId}
       AND project_id = ${projectId}
       AND status IN ('running', 'awaiting_capture')
       AND updated_at < ${staleAt}
  `;

  const pending = await sql<{ id: string }>`
    SELECT id FROM mcp_execution_jobs
     WHERE user_id = ${userId} AND project_id = ${projectId} AND status = 'queued'
     ORDER BY created_at ASC
     LIMIT 1
  `;
  if (!pending[0]) return null;
  const claimed = await sql<McpExecutionJobRow>`
    UPDATE mcp_execution_jobs
       SET status = 'running', claimed_at = ${now}, updated_at = ${now}
     WHERE id = ${pending[0].id} AND user_id = ${userId} AND status = 'queued'
     RETURNING *
  `;
  return claimed[0] ? toJob(claimed[0]) : null;
}

export async function recordMcpExecutionResult(
  userId: string,
  jobId: string,
  result: Record<string, unknown>,
): Promise<boolean> {
  const sql = await getSql();
  const resultJson = JSON.stringify(result);
  if (resultJson.length > 1_000_000) throw new Error("Execution result is too large to store.");
  const now = Date.now();
  const rows = await sql<{ id: string }>`
    UPDATE mcp_execution_jobs
       SET status = 'awaiting_capture', result_json = ${resultJson}, error = NULL, updated_at = ${now}
     WHERE id = ${jobId} AND user_id = ${userId} AND status = 'running'
     RETURNING id
  `;
  return rows.length > 0;
}

export async function completeMcpExecutionJob(
  userId: string,
  jobId: string,
  screenshotDataUrl: string | null,
  renderError?: string | null,
): Promise<boolean> {
  if (screenshotDataUrl && (
    screenshotDataUrl.length > 4_000_000 ||
    !/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(screenshotDataUrl)
  )) {
    throw new Error("Screenshot must be a small base64 JPEG, PNG or WebP data URL.");
  }
  const sql = await getSql();
  const now = Date.now();
  const cleanError = renderError?.trim().slice(0, 2000) || null;
  const rows = await sql<{ id: string }>`
    UPDATE mcp_execution_jobs
       SET status = 'completed',
           screenshot_data_url = ${screenshotDataUrl},
           error = ${cleanError},
           completed_at = ${now},
           updated_at = ${now}
     WHERE id = ${jobId} AND user_id = ${userId} AND status = 'awaiting_capture'
     RETURNING id
  `;
  return rows.length > 0;
}

export async function failMcpExecutionJob(userId: string, jobId: string, error: string): Promise<boolean> {
  const sql = await getSql();
  const now = Date.now();
  const cleanError = error.trim().slice(0, 2000) || "Studio execution failed.";
  const rows = await sql<{ id: string }>`
    UPDATE mcp_execution_jobs
       SET status = 'failed', error = ${cleanError}, completed_at = ${now}, updated_at = ${now}
     WHERE id = ${jobId} AND user_id = ${userId} AND status IN ('queued', 'running', 'awaiting_capture')
     RETURNING id
  `;
  return rows.length > 0;
}

export const databaseMcpExecutionQueue: McpExecutionQueue = {
  enqueue: enqueueMcpExecutionJob,
  get: getMcpExecutionJob,
};
