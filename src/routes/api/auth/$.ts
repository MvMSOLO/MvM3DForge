import { createFileRoute } from "@tanstack/react-router";
import { auth } from "@/lib/auth/server";

/**
 * Mount Better Auth's real server handler at /api/auth/*.
 *
 * Without this catch-all, the browser client can render the sign-in UI but
 * sign-up/sign-in requests are not routed to Better Auth.
 */
export const Route = createFileRoute("/api/auth/$")({
  server: {
    handlers: {
      GET: ({ request }) => auth.handler(request),
      POST: ({ request }) => auth.handler(request),
    },
  },
});
