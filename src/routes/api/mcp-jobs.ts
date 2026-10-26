import { createFileRoute } from "@tanstack/react-router";
import { auth } from "@/lib/auth/server";
import { loadProjectFromDb, saveProjectToDb } from "@/lib/projects.server.ts";
import { applyScriptPatch } from "@/forge/project.ts";
import type { Project, ScriptPatch } from "@/forge/types.ts";
import { BUDGET_CEILINGS, LIMITS } from "@/forge/limits.ts";
import { validateScene } from "@/forge/validate.ts";
import { validateNativeBabylonScene } from "@/forge/native-babylon-validation.ts";
import {
  claimNextMcpExecutionJob, completeMcpExecutionJob, failMcpExecutionJob,
  getMcpExecutionJob, recordMcpExecutionResult, type McpExecutionJob,
} from "@/lib/mcp/execution-jobs.server.ts";
function json(data: unknown, status = 200): Response {
  return Response.json(data, { status, headers: { "cache-control": "no-store" } });
}
async function signedInUserId(request: Request): Promise<string | null> {
  const session = await auth.api.getSession({ headers: request.headers });
  return session?.user?.id ?? null;
}
function isSameOriginMutation(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) return false;
  const fetchSite = request.headers.get("sec-fetch-site");
  return !fetchSite || fetchSite === "same-origin" || fetchSite === "none";
}
async function bodyObject(request: Request): Promise<Record<string, unknown> | null> {
  if (Number(request.headers.get("content-length") || 0) > 8_000_000) return null;
  const body = await request.text();
  if (body.length > 8_000_000) return null;
  try {
    const value: unknown = JSON.parse(body);
    return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
  } catch { return null; }
}
function safeIssue(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const issue = value as Record<string, unknown>;
  return {
    code: typeof issue.code === "string" ? issue.code.slice(0, 120) : "MVM_E_UNKNOWN",
    message: typeof issue.message === "string" ? issue.message.slice(0, 2000) : "The script failed.",
    severity: issue.severity === "warning" || issue.severity === "info" ? issue.severity : "error",
    ...(typeof issue.line === "number" ? { line: issue.line } : {}),
    ...(typeof issue.column === "number" ? { column: issue.column } : {}),
    ...(typeof issue.recoveryHint === "string" ? { recoveryHint: issue.recoveryHint.slice(0, 1000) } : {}),
  };
}
function safeLogs(value: unknown): Array<{ level: string; message: string; timestamp?: number }> {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 100).map((entry) => {
    const row = entry && typeof entry === "object" ? entry as Record<string, unknown> : {};
    return {
      level: row.level === "error" || row.level === "warn" || row.level === "info" ? row.level : "log",
      message: typeof row.message === "string" ? row.message.slice(0, 2000) : String(row.message ?? "").slice(0, 2000),
      ...(typeof row.timestamp === "number" ? { timestamp: row.timestamp } : {}),
    };
  });
}
function projectSummary(project: Project) {
  return {
    projectId: project.id, projectName: project.name, objectCount: project.objects.length,
    meshCount: project.objects.filter((object) => object.type === "mesh").length,
    lightCount: project.objects.filter((object) => object.type === "light").length,
    textureCount: project.textures.length, clipCount: project.clips.length,
    objectNames: project.objects.slice(0, 200).map((object) => object.name),
  };
}
async function ownedProject(userId: string, projectId: string): Promise<Project | null> {
  const project = await loadProjectFromDb(userId, projectId);
  return project && project.author === userId ? project : null;
}
async function handleExecutionResult(userId: string, job: McpExecutionJob, body: Record<string, unknown>): Promise<Response> {
  const project = await ownedProject(userId, job.projectId);
  if (!project) {
    await failMcpExecutionJob(userId, job.id, "Project not found or access denied.");
    return json({ error: "Project not found or access denied." }, 404);
  }
  if (project.updatedAt !== job.baseUpdatedAt) {
    const summary = {
      ok: false, phase: "conflict",
      error: "The saved project changed after this AI job was queued. Reload the project in Studio and submit a new job.",
      expectedRevision: job.baseUpdatedAt, actualRevision: project.updatedAt, logs: [], issues: [],
    };
    const recorded = await recordMcpExecutionResult(userId, job.id, summary);
    return recorded ? json({ ok: true, applied: false, summary, needsCapture: true }) : json({ error: "Job is no longer running." }, 409);
  }
  if (job.kind === "render") {
    const summary = { ok: true, phase: "render", applied: false, project: projectSummary(project), logs: [], issues: [] };
    const recorded = await recordMcpExecutionResult(userId, job.id, summary);
    return recorded ? json({ ok: true, applied: false, summary, needsCapture: true }) : json({ error: "Job is no longer running." }, 409);
  }
  if (job.code.length > LIMITS.maxCodeChars) return json({ error: "Stored script exceeds the current code limit." }, 400);
  const runResult = body.runResult as Record<string, unknown> | undefined;
  if (!runResult || typeof runResult.ok !== "boolean") return json({ error: "Expected the browser sandbox runResult." }, 400);
  const logs = safeLogs(runResult.logs);
  if (runResult.ok !== true) {
    const summary = {
      ok: false, phase: "execution",
      error: safeIssue(runResult.error) ?? { code: "MVM_E_UNKNOWN", message: "Script execution failed.", severity: "error" },
      logs, issues: Array.isArray(runResult.issues) ? runResult.issues.slice(0, 100).map(safeIssue).filter(Boolean) : [],
      project: projectSummary(project),
    };
    const recorded = await recordMcpExecutionResult(userId, job.id, summary);
    return recorded ? json({ ok: true, applied: false, summary, needsCapture: true }) : json({ error: "Job is no longer running." }, 409);
  }
  const patchValue = runResult.patch;
  if (!patchValue || typeof patchValue !== "object" || Array.isArray(patchValue)) return json({ error: "Browser returned a malformed script patch." }, 400);
  const patch = patchValue as ScriptPatch;
  if (!Array.isArray(patch.objects) || !Array.isArray(patch.textures) || !Array.isArray(patch.clips) || patch.objects.length > BUDGET_CEILINGS.maxObjects || patch.textures.length > BUDGET_CEILINGS.maxTextures) {
    return json({ error: "Script patch exceeds the hard scene or texture budget." }, 400);
  }
  if (patch.engine === "babylon") {
    const nativeSceneError = validateNativeBabylonScene(patch.nativeBabylonScene);
    if (nativeSceneError) return json({ error: nativeSceneError }, 400);
  }
  let candidate: Project;
  try {
    candidate = applyScriptPatch(project, patch);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not apply the script patch.";
    const summary = { ok: false, phase: "patch", error: { code: "MVM_E_PATCH_INVALID", message: message.slice(0, 2000), severity: "error" }, logs, issues: [], project: projectSummary(project) };
    const recorded = await recordMcpExecutionResult(userId, job.id, summary);
    return recorded ? json({ ok: true, applied: false, summary, needsCapture: true }) : json({ error: "Job is no longer running." }, 409);
  }
  const issues = validateScene(
    { objects: candidate.objects, textures: candidate.textures, clips: candidate.clips },
    { maxObjects: BUDGET_CEILINGS.maxObjects, maxTextures: BUDGET_CEILINGS.maxTextures, maxTrianglesHard: BUDGET_CEILINGS.maxTrianglesHard },
  );
  const hardIssues = issues.filter((issue) => issue.severity === "error");
  const warnings = [...(Array.isArray(patch.issues) ? patch.issues.map(safeIssue).filter(Boolean) : []), ...issues.map(safeIssue).filter(Boolean)].slice(0, 150);
  if (hardIssues.length) {
    const summary = { ok: false, phase: "validation", error: safeIssue(hardIssues[0]), logs, issues: warnings, project: projectSummary(project), previewAvailable: true };
    const recorded = await recordMcpExecutionResult(userId, job.id, summary);
    return recorded ? json({ ok: true, applied: false, summary, needsCapture: true, previewCandidate: true }) : json({ error: "Job is no longer running." }, 409);
  }
  const saved = job.applyChanges
    ? await saveProjectToDb(userId, { ...candidate, code: job.code, author: userId, updatedAt: Date.now() })
    : candidate;
  const summary = {
    ok: true, phase: "execution", applied: job.applyChanges, project: projectSummary(saved),
    ...(job.applyChanges ? { projectUpdatedAt: saved.updatedAt } : {}),
    logs, issues: warnings, sceneMutation: patch.sceneMutation ?? (patch.objects.length ? "replace" : "none"),
  };
  const recorded = await recordMcpExecutionResult(userId, job.id, summary);
  return recorded
    ? json({ ok: true, applied: job.applyChanges, summary, projectUpdatedAt: job.applyChanges ? saved.updatedAt : undefined, needsCapture: true })
    : json({ error: "Job is no longer running." }, 409);
}
export const Route = createFileRoute("/api/mcp-jobs")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        try {
          const userId = await signedInUserId(request);
          if (!userId) return json({ error: "Unauthorized." }, 401);
          const projectId = new URL(request.url).searchParams.get("projectId")?.trim();
          if (!projectId) return json({ error: "projectId is required." }, 400);
          const project = await ownedProject(userId, projectId);
          if (!project) return json({ error: "Project not found or access denied." }, 404);
          const job = await claimNextMcpExecutionJob(userId, projectId);
          if (!job) return new Response(null, { status: 204, headers: { "cache-control": "no-store" } });
          return json({ job: { id: job.id, projectId: job.projectId, kind: job.kind, code: job.code, applyChanges: job.applyChanges, baseUpdatedAt: job.baseUpdatedAt } });
        } catch (error) {
          return json({ error: error instanceof Error ? error.message : "Could not check the AI job queue." }, 500);
        }
      },
      POST: async ({ request }) => {
        if (!isSameOriginMutation(request)) return json({ error: "Cross-origin request rejected." }, 403);
        const userId = await signedInUserId(request);
        if (!userId) return json({ error: "Unauthorized." }, 401);
        const body = await bodyObject(request);
        if (!body || typeof body.action !== "string" || typeof body.jobId !== "string") return json({ error: "Expected action and jobId in a JSON object." }, 400);
        const job = await getMcpExecutionJob(userId, body.jobId);
        if (!job) return json({ error: "Job not found or access denied." }, 404);
        try {
          if (body.action === "execution-result") {
            if (job.status !== "running") return json({ error: "Job is not running." }, 409);
            return await handleExecutionResult(userId, job, body);
          }
          if (body.action === "capture") {
            if (job.status !== "awaiting_capture") return json({ error: "Job is not waiting for a screenshot." }, 409);
            const screenshot = typeof body.screenshotDataUrl === "string" ? body.screenshotDataUrl : null;
            const renderError = typeof body.renderError === "string" ? body.renderError : null;
            const completed = await completeMcpExecutionJob(userId, job.id, screenshot, renderError);
            return completed ? json({ ok: true, status: "completed" }) : json({ error: "Job changed before capture completed." }, 409);
          }
          if (body.action === "fail") {
            const error = typeof body.error === "string" ? body.error : "Studio could not process the AI job.";
            const failed = await failMcpExecutionJob(userId, job.id, error);
            return failed ? json({ ok: true, status: "failed" }) : json({ error: "Job can no longer be failed." }, 409);
          }
          return json({ error: "Unsupported action." }, 400);
        } catch (error) {
          const message = error instanceof Error ? error.message : "Could not process the AI job.";
          if (job.status === "running") await failMcpExecutionJob(userId, job.id, message);
          return json({ error: message }, 500);
        }
      },
    },
  },
});
