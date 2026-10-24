import { createFileRoute } from "@tanstack/react-router";
import { auth } from "@/lib/auth/server";
import { generateWithAiProvider, isAiProviderId } from "@/lib/ai/providers.server";

function json(data: unknown, status = 200): Response {
  return Response.json(data, { status, headers: { "cache-control": "no-store" } });
}

async function bodyObject(request: Request): Promise<Record<string, unknown> | null> {
  if (Number(request.headers.get("content-length") || 0) > 60_000) return null;
  const raw = await request.text();
  if (raw.length > 60_000) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

function isSameOriginMutation(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) return false;
  const fetchSite = request.headers.get("sec-fetch-site");
  return !fetchSite || fetchSite === "same-origin" || fetchSite === "none";
}

export const Route = createFileRoute("/api/ai-assistant")({
  server: { handlers: {
    POST: async ({ request }) => {
      if (!isSameOriginMutation(request)) return json({ error: "Cross-origin request rejected." }, 403);
      try {
        const session = await auth.api.getSession({ headers: request.headers });
        if (!session?.user?.id) return json({ error: "Sign in before using the AI assistant." }, 401);
        const body = await bodyObject(request);
        if (!body) return json({ error: "Expected a small JSON object." }, 400);
        if (!isAiProviderId(body.provider)) return json({ error: "Choose a connected AI provider." }, 400);
        if (typeof body.prompt !== "string" || typeof body.code !== "string" && body.code !== undefined) {
          return json({ error: "A prompt and optional current script are required." }, 400);
        }
        const result = await generateWithAiProvider({
          userId: session.user.id,
          provider: body.provider,
          prompt: body.prompt,
          code: typeof body.code === "string" ? body.code : "",
        });
        return json(result);
      } catch (error) {
        return json({ error: error instanceof Error ? error.message : "The AI request failed." }, 502);
      }
    },
  } },
});
