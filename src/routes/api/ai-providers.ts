import { createFileRoute } from "@tanstack/react-router";
import { auth } from "@/lib/auth/server";
import {
  AI_PROVIDERS,
  connectAiProvider,
  disconnectAiProvider,
  isAiProviderId,
  listAiProviderConnections,
  listUserAiModels,
  updateAiProviderModel,
} from "@/lib/ai/providers.server";

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
  if (Number(request.headers.get("content-length") || 0) > 16_000) return null;
  const raw = await request.text();
  if (raw.length > 16_000) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

export const Route = createFileRoute("/api/ai-providers")({
  server: { handlers: {
    GET: async ({ request }) => {
      try {
        const userId = await signedInUserId(request);
        if (!userId) return json({ error: "Sign in to configure AI providers." }, 401);
        const connections = await listAiProviderConnections(userId);
        const configured = new Map(connections.map((row) => [row.provider, row]));
        const providers = AI_PROVIDERS.map((provider) => ({
          id: provider.id,
          name: provider.name,
          connected: configured.has(provider.id),
          preferredModel: configured.get(provider.id)?.preferredModel ?? "",
          updatedAt: configured.get(provider.id)?.updatedAt ?? null,
        }));
        const query = new URL(request.url).searchParams;
        if (query.get("action") === "models") {
          const provider = query.get("provider");
          if (!isAiProviderId(provider)) return json({ error: "Choose a supported provider." }, 400);
          return json({ provider, models: await listUserAiModels(userId, provider) });
        }
        return json({ providers });
      } catch (error) {
        return json({ error: error instanceof Error ? error.message : "Could not load AI provider settings." }, 503);
      }
    },
    POST: async ({ request }) => {
      if (!isSameOriginMutation(request)) return json({ error: "Cross-origin request rejected." }, 403);
      try {
        const userId = await signedInUserId(request);
        if (!userId) return json({ error: "Sign in before connecting an AI provider." }, 401);
        const body = await bodyObject(request);
        if (!body) return json({ error: "Expected a small JSON object." }, 400);
        if (!isAiProviderId(body.provider)) return json({ error: "Choose a supported AI provider." }, 400);
        if (typeof body.apiKey !== "string" || typeof body.preferredModel !== "string" && body.preferredModel !== undefined) {
          return json({ error: "Provider API key and optional model are required." }, 400);
        }
        const connected = await connectAiProvider({
          userId,
          provider: body.provider,
          apiKey: body.apiKey,
          preferredModel: typeof body.preferredModel === "string" ? body.preferredModel : undefined,
        });
        return json(connected, 201);
      } catch (error) {
        return json({ error: error instanceof Error ? error.message : "Could not connect this AI provider." }, 400);
      }
    },
    PATCH: async ({ request }) => {
      if (!isSameOriginMutation(request)) return json({ error: "Cross-origin request rejected." }, 403);
      try {
        const userId = await signedInUserId(request);
        if (!userId) return json({ error: "Sign in before changing the selected model." }, 401);
        const body = await bodyObject(request);
        if (!body) return json({ error: "Expected a small JSON object." }, 400);
        if (!isAiProviderId(body.provider) || typeof body.model !== "string") {
          return json({ error: "Choose a provider and a model." }, 400);
        }
        return json({ connection: await updateAiProviderModel(userId, body.provider, body.model) });
      } catch (error) {
        return json({ error: error instanceof Error ? error.message : "Could not select this model." }, 400);
      }
    },
    DELETE: async ({ request }) => {
      if (!isSameOriginMutation(request)) return json({ error: "Cross-origin request rejected." }, 403);
      try {
        const userId = await signedInUserId(request);
        if (!userId) return json({ error: "Sign in before disconnecting an AI provider." }, 401);
        const provider = new URL(request.url).searchParams.get("provider");
        if (!isAiProviderId(provider)) return json({ error: "Choose a supported provider." }, 400);
        const disconnected = await disconnectAiProvider(userId, provider);
        return disconnected ? json({ ok: true }) : json({ error: "This provider is not connected." }, 404);
      } catch (error) {
        return json({ error: error instanceof Error ? error.message : "Could not disconnect this provider." }, 503);
      }
    },
  } },
});
