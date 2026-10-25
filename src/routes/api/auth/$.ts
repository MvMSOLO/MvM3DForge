import { createFileRoute } from "@tanstack/react-router";
import { auth } from "@/lib/auth/server";
import {
  databaseReadinessResponse,
  inspectDatabaseReadiness,
} from "@/lib/db-readiness.server";

/**
 * Mount Better Auth's real server handler at /api/auth/*.
 *
 * Probe connectivity and all required auth/project/MCP relations before handing
 * any request to Better Auth. Client responses are intentionally sanitized;
 * diagnostic reason codes are written only to server logs.
 */
async function handleAuth(request: Request): Promise<Response> {
  const readiness = await inspectDatabaseReadiness();
  if (!readiness.ok) return databaseReadinessResponse(readiness);

  return auth.handler(request);
}

export const Route = createFileRoute("/api/auth/$")({
  server: {
    handlers: {
      GET: ({ request }) => handleAuth(request),
      POST: ({ request }) => handleAuth(request),
    },
  },
});
