import { defineEventHandler, getQuery, readBody, setResponseStatus } from "h3";
import type { H3Event } from "h3";
import { auth, authConfigured } from "@/lib/auth/server";
import { dbSource } from "@/lib/db";
import { migrateProject } from "@/forge/project.ts";
import type { Project } from "@/forge/types.ts";
import { deleteProjectFromDb, listUserProjectsFromDb, loadProjectFromDb, saveProjectToDb } from "@/lib/projects.server";

function requestHeaders(event: H3Event): Headers {
  // Nitro 3 / H3 v2 uses the Web Request as the portable source of headers.
  // The deprecated event.node.req is absent on some Vercel deployments.
  return new Headers(event.req.headers);
}

function originIsAllowed(event: H3Event): boolean {
  const origin = event.req.headers.get("origin");
  if (!origin) return true;
  const host = (
    event.req.headers.get("host") ||
    event.req.headers.get("x-forwarded-host") ||
    ""
  ).split(",")[0].trim();
  try {
    return new URL(origin).host.toLowerCase() === host.toLowerCase();
  } catch {
    return false;
  }
}

async function getUserId(event: H3Event): Promise<string | null> {
  if (!authConfigured) return null;
  const session = await auth.api.getSession({ headers: requestHeaders(event) });
  return session?.user?.id ?? null;
}

export default defineEventHandler(async (event) => {
  const method = event.req.method.toUpperCase();
  if (!originIsAllowed(event)) {
    setResponseStatus(event, 403);
    return { error: "Cross-origin project requests are not allowed." };
  }
  if (process.env.NODE_ENV === "production" && dbSource !== "neon") {
    setResponseStatus(event, 503);
    return { error: "Cloud projects require a persistent DATABASE_URL." };
  }

  let userId: string | null = null;
  try {
    userId = await getUserId(event);
  } catch {
    userId = null;
  }
  if (!userId) {
    setResponseStatus(event, 401);
    return { error: "Sign in to access cloud projects." };
  }

  if (method === "GET") {
    const id = String(getQuery(event).id || "");
    if (!id) return { projects: await listUserProjectsFromDb(userId) };
    const project = await loadProjectFromDb(userId, id);
    if (!project || project.author !== userId) {
      setResponseStatus(event, 404);
      return { error: "Project not found." };
    }
    return { project };
  }

  if (method === "POST") {
    let body: unknown;
    try {
      body = await readBody(event);
    } catch {
      setResponseStatus(event, 400);
      return { error: "Request body must be valid JSON." };
    }
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      setResponseStatus(event, 400);
      return { error: "Request body must be an object containing project." };
    }
    try {
      const raw = (body as Record<string, unknown>).project;
      const project = migrateProject(raw) as Project;
      project.author = userId;
      const saved = await saveProjectToDb(userId, project);
      return { project: saved, saved: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not save cloud project.";
      setResponseStatus(event, message.includes("ownership conflict") ? 403 : 400);
      return { error: message };
    }
  }

  if (method === "DELETE") {
    const id = String(getQuery(event).id || "");
    if (!id || id.length > 100) {
      setResponseStatus(event, 400);
      return { error: "A valid project id is required." };
    }
    const deleted = await deleteProjectFromDb(userId, id);
    if (!deleted) {
      setResponseStatus(event, 404);
      return { error: "Project not found." };
    }
    return { deleted: true };
  }

  setResponseStatus(event, 405);
  return { error: "Method Not Allowed", allowed: ["GET", "POST", "DELETE"] };
});
