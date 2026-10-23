import { createFileRoute } from "@tanstack/react-router";
import { auth } from "@/lib/auth/server";
import { resolveAuthDatabaseReadiness } from "@/lib/auth/deployment-readiness";

/**
 * Mount Better Auth's real server handler at /api/auth/*.
 *
 * Production account operations must never silently fall back to process-local
 * PGLite: different serverless instances would see different users/sessions.
 */
async function handlePost(request: Request): Promise<Response> {
  const readiness = resolveAuthDatabaseReadiness({
    nodeEnv: process.env.NODE_ENV,
    databaseUrl: process.env.DATABASE_URL,
  });

  if (!readiness.ok) {
    // Deliberately log only the missing configuration, never environment values.
    console.error("[auth] blocked account mutation: DATABASE_URL is not configured in production");
    return Response.json(
      { code: readiness.code, message: readiness.message },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }

  return auth.handler(request);
}

export const Route = createFileRoute("/api/auth/$")({
  server: {
    handlers: {
      GET: ({ request }) => auth.handler(request),
      POST: ({ request }) => handlePost(request),
    },
  },
});
