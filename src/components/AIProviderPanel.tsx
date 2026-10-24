import { useEffect, useMemo, useState } from "react";
import { Check, CircleAlert, KeyRound, LoaderCircle, RefreshCw, Sparkles, Trash2 } from "lucide-react";

type ProviderId = "openai" | "anthropic" | "google" | "groq" | "openrouter" | "deepseek" | "mistral" | "xai" | "together";
type ProviderModel = { id: string; name: string };
type ProviderRow = {
  id: ProviderId;
  name: string;
  connected: boolean;
  preferredModel: string;
  updatedAt: number | null;
};
type Generation = { provider: ProviderId; model: string; text: string; code: string | null };

const PROVIDER_OPTIONS: Array<{ id: ProviderId; name: string; hint: string }> = [
  { id: "openai", name: "OpenAI", hint: "GPT models" },
  { id: "anthropic", name: "Anthropic", hint: "Claude models" },
  { id: "google", name: "Google Gemini", hint: "Gemini models" },
  { id: "groq", name: "Groq", hint: "Fast hosted inference" },
  { id: "openrouter", name: "OpenRouter", hint: "Multi-provider catalog" },
  { id: "deepseek", name: "DeepSeek", hint: "DeepSeek chat models" },
  { id: "mistral", name: "Mistral AI", hint: "Mistral models" },
  { id: "xai", name: "xAI", hint: "Grok models" },
  { id: "together", name: "Together AI", hint: "Open model catalog" },
];

async function readJson(response: Response): Promise<Record<string, unknown>> {
  const body = await response.json().catch(() => ({}));
  if (!body || typeof body !== "object" || Array.isArray(body)) return {};
  return body as Record<string, unknown>;
}

export function AIProviderPanel({
  code,
  onApplyCode,
  onStatus,
}: {
  code: string;
  onApplyCode: (code: string) => void;
  onStatus: (message: string) => void;
}) {
  const [provider, setProvider] = useState<ProviderId>("openai");
  const [providers, setProviders] = useState<ProviderRow[]>([]);
  const [apiKey, setApiKey] = useState("");
  const [models, setModels] = useState<ProviderModel[]>([]);
  const [selectedModel, setSelectedModel] = useState("");
  const [prompt, setPrompt] = useState("");
  const [result, setResult] = useState<Generation | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingModels, setLoadingModels] = useState(false);
  const [saving, setSaving] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const selectedProvider = PROVIDER_OPTIONS.find((item) => item.id === provider) ?? PROVIDER_OPTIONS[0];
  const connection = providers.find((item) => item.id === provider);
  const connected = Boolean(connection?.connected);
  const canGenerate = connected && Boolean(selectedModel) && Boolean(prompt.trim()) && !generating && !loadingModels;

  async function refreshProviders() {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/ai-providers", { credentials: "same-origin", cache: "no-store" });
      const body = await readJson(response);
      if (!response.ok) throw new Error(typeof body.error === "string" ? body.error : "Could not load AI provider settings.");
      const rows = Array.isArray(body.providers) ? body.providers as ProviderRow[] : [];
      setProviders(rows);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load AI provider settings.");
    } finally {
      setLoading(false);
    }
  }

  async function refreshModels(providerId: ProviderId, preferred?: string) {
    setLoadingModels(true);
    setError("");
    try {
      const response = await fetch(`/api/ai-providers?action=models&provider=${encodeURIComponent(providerId)}`, {
        credentials: "same-origin",
        cache: "no-store",
      });
      const body = await readJson(response);
      if (!response.ok) throw new Error(typeof body.error === "string" ? body.error : "Could not load provider models.");
      const rows = Array.isArray(body.models) ? body.models as ProviderModel[] : [];
      setModels(rows);
      const next = preferred && rows.some((model) => model.id === preferred) ? preferred : rows[0]?.id ?? "";
      setSelectedModel(next);
      if (!rows.length) setNotice("The provider did not return any chat models.");
      else setNotice(`Loaded ${rows.length} available models.`);
      return rows;
    } catch (cause) {
      setModels([]);
      setError(cause instanceof Error ? cause.message : "Could not load provider models.");
      return [];
    } finally {
      setLoadingModels(false);
    }
  }

  useEffect(() => {
    void refreshProviders();
  }, []);

  useEffect(() => {
    if (!connection?.connected) {
      setModels([]);
      setSelectedModel("");
      return;
    }
    setSelectedModel(connection.preferredModel || "");
    void refreshModels(provider, connection.preferredModel || undefined);
  }, [provider, connection?.connected, connection?.preferredModel]);

  async function connectProvider() {
    if (!apiKey.trim()) {
      setError("Enter the API key from the selected provider.");
      return;
    }
    setSaving(true);
    setError("");
    setNotice("");
    setResult(null);
    try {
      const response = await fetch("/api/ai-providers", {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ provider, apiKey, preferredModel: selectedModel || undefined }),
      });
      const body = await readJson(response);
      if (!response.ok) throw new Error(typeof body.error === "string" ? body.error : "Provider connection failed.");
      const rawConnection = body.connection as (Omit<ProviderRow, "id"> & { id?: ProviderId; provider?: ProviderId }) | undefined;
      const modelRows = Array.isArray(body.models) ? body.models as ProviderModel[] : [];
      const connectionId = rawConnection?.id ?? rawConnection?.provider;
      if (!rawConnection || connectionId !== provider) throw new Error("Provider response was incomplete. Retry the connection.");
      const connectedRow: ProviderRow = { ...rawConnection, id: connectionId };
      setProviders((previous) => [...previous.filter((item) => item.id !== provider), connectedRow]);
      setModels(modelRows);
      setSelectedModel(connectedRow.preferredModel || modelRows[0]?.id || "");
      setApiKey("");
      setNotice(`${selectedProvider.name} connected. The API key is encrypted and is not shown again.`);
      onStatus(`${selectedProvider.name} connected`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Provider connection failed.");
    } finally {
      setSaving(false);
    }
  }

  async function saveModel(model: string) {
    setSelectedModel(model);
    setError("");
    setNotice("");
    if (!connected || !model) return;
    try {
      const response = await fetch("/api/ai-providers", {
        method: "PATCH",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ provider, model }),
      });
      const body = await readJson(response);
      if (!response.ok) throw new Error(typeof body.error === "string" ? body.error : "Could not save selected model.");
      const rawConnection = body.connection as (Omit<ProviderRow, "id"> & { id?: ProviderId; provider?: ProviderId }) | undefined;
      const connectionId = rawConnection?.id ?? rawConnection?.provider;
      if (!rawConnection || connectionId !== provider) throw new Error("The saved model response was incomplete. Retry selecting the model.");
      const row: ProviderRow = { ...rawConnection, id: connectionId };
      setProviders((previous) => previous.map((item) => item.id === provider ? row : item));
      setNotice(`Selected model: ${model}`);
      onStatus(`${selectedProvider.name} model selected`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save selected model.");
    }
  }

  async function disconnectProvider() {
    if (!connected) return;
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch(`/api/ai-providers?provider=${encodeURIComponent(provider)}`, {
        method: "DELETE",
        credentials: "same-origin",
      });
      const body = await readJson(response);
      if (!response.ok) throw new Error(typeof body.error === "string" ? body.error : "Could not disconnect provider.");
      setProviders((previous) => previous.filter((item) => item.id !== provider));
      setModels([]);
      setSelectedModel("");
      setResult(null);
      setNotice(`${selectedProvider.name} disconnected.`);
      onStatus(`${selectedProvider.name} disconnected`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not disconnect provider.");
    } finally {
      setSaving(false);
    }
  }

  async function generateCode() {
    if (!canGenerate) return;
    setGenerating(true);
    setError("");
    setNotice("");
    setResult(null);
    try {
      const response = await fetch("/api/ai-assistant", {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ provider, prompt, code: code.slice(0, 18_000) }),
      });
      const body = await readJson(response);
      if (!response.ok) throw new Error(typeof body.error === "string" ? body.error : "AI generation failed.");
      if (typeof body.text !== "string" || typeof body.model !== "string") throw new Error("The provider response was incomplete.");
      const generated: Generation = {
        provider,
        model: body.model,
        text: body.text,
        code: typeof body.code === "string" ? body.code : null,
      };
      setResult(generated);
      setNotice(generated.code ? "Generated script is ready to review. It has not been executed." : "Response received. No JavaScript code block was detected; ask for a complete script.");
      onStatus(`AI response received from ${selectedProvider.name}`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "AI generation failed.");
    } finally {
      setGenerating(false);
    }
  }

  const outputText = useMemo(() => result?.text ?? "", [result]);
  const generatedLines = result?.code?.split("\n").length ?? 0;

  return (
    <section className="mb-4 rounded-2xl border border-[#83f0ce]/20 bg-[#080d12]/70 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-sm font-semibold text-slate-100">
            <Sparkles size={16} className="text-[#83f0ce]" /> MVM AI WORKBENCH
          </div>
          <p className="mt-1 max-w-2xl text-[11px] leading-5 text-slate-400">
            Connect your own provider key, fetch live models, and generate sandbox-ready scene code.
            Keys stay server-side and generated scripts never run automatically.
          </p>
        </div>
        <div className="rounded-full border border-white/10 px-2.5 py-1 text-[10px] text-slate-400">
          {loading ? "Loading…" : `${providers.filter((item) => item.connected).length}/9 connected`}
        </div>
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-2">
        <label className="block text-[11px] font-medium text-slate-300">
          AI provider
          <select
            value={provider}
            onChange={(event) => {
              setProvider(event.target.value as ProviderId);
              setApiKey("");
              setError("");
              setNotice("");
              setResult(null);
            }}
            className="mt-1.5 w-full rounded-xl border border-white/10 bg-[#101820] px-3 py-2.5 text-sm text-slate-100 outline-none focus:border-[#83f0ce]/60"
          >
            {PROVIDER_OPTIONS.map((item) => (
              <option key={item.id} value={item.id}>{item.name} — {item.hint}</option>
            ))}
          </select>
        </label>
        <div className="flex flex-col justify-end gap-2">
          <label className="block text-[11px] font-medium text-slate-300">
            {connected ? "Connection status" : "Provider API key"}
            {connected ? (
              <div className="mt-1.5 flex items-center gap-2 rounded-xl border border-[#83f0ce]/25 bg-[#83f0ce]/[.06] px-3 py-2.5 text-sm text-[#83f0ce]">
                <Check size={14} /> Connected · key hidden
              </div>
            ) : (
              <div className="mt-1.5 flex items-center gap-2 rounded-xl border border-white/10 bg-[#101820] px-3 focus-within:border-[#83f0ce]/60">
                <KeyRound size={14} className="shrink-0 text-slate-500" />
                <input
                  type="password"
                  value={apiKey}
                  onChange={(event) => setApiKey(event.target.value)}
                  autoComplete="off"
                  spellCheck={false}
                  placeholder="Paste API key"
                  className="min-w-0 flex-1 bg-transparent py-2.5 text-sm text-slate-100 outline-none placeholder:text-slate-600"
                />
              </div>
            )}
          </label>
          <div className="flex flex-wrap gap-2">
            {!connected ? (
              <button type="button" onClick={() => void connectProvider()} disabled={saving || loading || !apiKey.trim()} className="inline-flex items-center justify-center gap-2 rounded-lg bg-[#83f0ce] px-3 py-2 text-[11px] font-semibold text-[#071511] disabled:cursor-not-allowed disabled:opacity-50">
                {saving ? <LoaderCircle size={13} className="animate-spin" /> : <KeyRound size={13} />} Test & Connect
              </button>
            ) : (
              <>
                <button type="button" onClick={() => void refreshModels(provider, selectedModel)} disabled={loadingModels || saving} className="inline-flex items-center gap-2 rounded-lg border border-white/10 px-3 py-2 text-[11px] text-slate-200 hover:border-[#83f0ce]/40 disabled:opacity-50">
                  {loadingModels ? <LoaderCircle size={13} className="animate-spin" /> : <RefreshCw size={13} />} Refresh models
                </button>
                <button type="button" onClick={() => void disconnectProvider()} disabled={saving} className="inline-flex items-center gap-2 rounded-lg border border-rose-400/20 px-3 py-2 text-[11px] text-rose-300 hover:bg-rose-400/[.06] disabled:opacity-50">
                  {saving ? <LoaderCircle size={13} className="animate-spin" /> : <Trash2 size={13} />} Disconnect
                </button>
              </>
            )}
          </div>
        </div>
      </div>

      {connected && (
        <label className="mt-3 block text-[11px] font-medium text-slate-300">
          Model selection
          <select
            value={selectedModel}
            disabled={loadingModels || saving || models.length === 0}
            onChange={(event) => void saveModel(event.target.value)}
            className="mt-1.5 w-full rounded-xl border border-white/10 bg-[#101820] px-3 py-2.5 text-sm text-slate-100 outline-none focus:border-[#83f0ce]/60 disabled:opacity-50"
          >
            {models.length === 0 && <option value="">Load available models</option>}
            {models.map((model) => <option key={model.id} value={model.id}>{model.name} · {model.id}</option>)}
          </select>
          {selectedModel && <span className="mt-1 block break-all font-mono text-[10px] text-slate-500">{selectedModel}</span>}
        </label>
      )}

      <div className="mt-4 border-t border-white/[.07] pt-4">
        <label className="block text-[11px] font-medium text-slate-300">
          What should the scene script do?
          <textarea
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            rows={4}
            maxLength={12000}
            placeholder="Example: Build a realistic sci-fi drone with layered hull panels, metallic PBR materials, navigation lights, and a looping propeller animation. Keep it editable in MVM3D."
            className="mt-1.5 w-full resize-y rounded-xl border border-white/10 bg-[#101820] px-3 py-2.5 text-sm leading-6 text-slate-100 outline-none placeholder:text-slate-600 focus:border-[#83f0ce]/60"
          />
        </label>
        <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
          <span className="text-[10px] text-slate-500">Current script context: {Math.min(code.length, 18000).toLocaleString()} / 18,000 chars</span>
          <button type="button" onClick={() => void generateCode()} disabled={!canGenerate} className="inline-flex items-center gap-2 rounded-lg bg-[#83f0ce] px-4 py-2.5 text-xs font-bold text-[#071511] transition hover:bg-[#a7f8dd] disabled:cursor-not-allowed disabled:opacity-40">
            {generating ? <LoaderCircle size={14} className="animate-spin" /> : <Sparkles size={14} />} {generating ? "Generating…" : "Generate script"}
          </button>
        </div>
      </div>

      {error && (
        <div role="alert" className="mt-3 flex items-start gap-2 rounded-xl border border-rose-400/25 bg-rose-400/[.06] px-3 py-2.5 text-xs leading-5 text-rose-200">
          <CircleAlert size={15} className="mt-0.5 shrink-0" /> {error}
        </div>
      )}
      {notice && !error && (
        <div role="status" className="mt-3 rounded-xl border border-[#83f0ce]/20 bg-[#83f0ce]/[.05] px-3 py-2.5 text-[11px] leading-5 text-[#a9e6d6]">
          {notice}
        </div>
      )}
      {result && (
        <div className="mt-4 overflow-hidden rounded-xl border border-white/10">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/10 bg-white/[.025] px-3 py-2.5">
            <div className="min-w-0">
              <div className="text-xs font-semibold text-slate-100">{selectedProvider.name} · {result.model}</div>
              <div className="mt-0.5 text-[10px] text-slate-500">
                {result.code ? `${generatedLines} lines of JavaScript detected` : "No code block detected"}
              </div>
            </div>
            {result.code && (
              <button type="button" onClick={() => { onApplyCode(result.code!); onStatus("AI script copied to the code editor. Review it before running."); }} className="rounded-lg bg-[#83f0ce] px-3 py-2 text-[11px] font-bold text-[#071511] hover:bg-[#a7f8dd]">
                Apply to editor
              </button>
            )}
          </div>
          <pre className="max-h-[420px] overflow-auto whitespace-pre-wrap break-words p-3 font-mono text-[11px] leading-5 text-slate-300">{outputText}</pre>
        </div>
      )}
    </section>
  );
}
