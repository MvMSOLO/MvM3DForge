import { useCallback, useEffect, useState } from "react";
import { authEnabled } from "@/lib/auth/client";
import { useCurrentUserState } from "@/lib/auth/use-current-user";
import { Check, Copy, KeyRound, LoaderCircle, Plus, RefreshCw, ShieldCheck, Trash2 } from "lucide-react";

type Scope = "project:read" | "scene:write" | "assets:export";
type ApiKeyRecord = {
  id: string;
  name: string;
  prefix: string;
  scopes: Scope[];
  createdAt: number;
  lastUsedAt: number | null;
  expiresAt: number | null;
  revokedAt: number | null;
};

const AVAILABLE_SCOPES: { id: Scope; title: string; detail: string }[] = [
  { id: "project:read", title: "Read projects", detail: "List projects, inspect objects and read scenes." },
  { id: "scene:write", title: "Edit scenes", detail: "Create, rename, transform and delete scene objects." },
  { id: "assets:export", title: "Export assets", detail: "Generate binary GLB exports." },
];

function when(value: number | null): string {
  return value == null ? "Never" : new Date(value).toLocaleString();
}

export function McpApiKeysPanel() {
  const { user, isPending } = useCurrentUserState();
  const [keys, setKeys] = useState<ApiKeyRecord[]>([]);
  const [name, setName] = useState("My AI client");
  const [scopes, setScopes] = useState<Scope[]>(AVAILABLE_SCOPES.map((scope) => scope.id));
  const [expiresInDays, setExpiresInDays] = useState("90");
  const [newKey, setNewKey] = useState("");
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);

  const reload = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/mcp-keys", { credentials: "same-origin" });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || `Could not load API keys (HTTP ${response.status}).`);
      setKeys(Array.isArray(data.keys) ? data.keys : []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load API keys.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!authEnabled) {
      setLoading(false);
      setError("");
      return;
    }
    if (isPending) return;
    if (!user) {
      setKeys([]);
      setLoading(false);
      setError("");
      return;
    }
    void reload();
  }, [authEnabled, isPending, user?.id, reload]);

  async function createKey() {
    setCreating(true);
    setError("");
    setMessage("");
    setNewKey("");
    try {
      const response = await fetch("/api/mcp-keys", {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name,
          scopes,
          expiresInDays: expiresInDays === "never" ? null : Number(expiresInDays),
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || `Could not create API key (HTTP ${response.status}).`);
      setNewKey(data.key);
      setMessage("Key created. Copy it now; the full secret will not be shown again.");
      setName("My AI client");
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not create API key.");
    } finally {
      setCreating(false);
    }
  }

  async function copyKey() {
    try {
      await navigator.clipboard.writeText(newKey);
      setCopied(true);
      setMessage("API key copied. Save it in your MCP client configuration.");
    } catch {
      setError("Clipboard access was blocked. Select and copy the key manually.");
    }
  }

  async function revokeKey(id: string) {
    if (!window.confirm("Revoke this API key? Any client using it will immediately lose access.")) return;
    setError("");
    try {
      const response = await fetch(`/api/mcp-keys?id=${encodeURIComponent(id)}`, {
        method: "DELETE",
        credentials: "same-origin",
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || `Could not revoke API key (HTTP ${response.status}).`);
      setMessage("API key revoked.");
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not revoke API key.");
    }
  }

  if (authEnabled && isPending) {
    return (
      <section className="mb-6 rounded-xl border border-white/[0.09] bg-[#0b1219] p-5">
        <div className="flex items-center gap-3 text-sm text-slate-300">
          <LoaderCircle size={16} className="animate-spin text-[#83f0ce]" />
          Checking your sign-in status…
        </div>
      </section>
    );
  }

  if (!authEnabled) {
    return (
      <section className="mb-6 rounded-xl border border-amber-300/20 bg-[#0b1219] p-5">
        <h3 className="text-sm font-semibold text-slate-100">Sign-in is not enabled</h3>
        <p className="mt-2 text-xs leading-5 text-slate-400">
          Real authentication must be enabled before personal API keys can be created. Reload after deployment configuration is updated.
        </p>
      </section>
    );
  }

  if (!user) {
    return (
      <section className="mb-6 rounded-xl border border-[#83f0ce]/20 bg-[#0b1219] p-5">
        <div className="flex items-center gap-3">
          <div className="grid size-10 shrink-0 place-items-center rounded-xl border border-[#83f0ce]/20 bg-[#83f0ce]/[.08] text-[#83f0ce]">
            <KeyRound size={18} />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-slate-100">Sign in to create an API key</h3>
            <p className="mt-1 text-xs leading-5 text-slate-400">API keys belong to your account, so sign in before creating or managing them.</p>
          </div>
        </div>
        <a href="/login?next=%2Fstudio" className="mt-4 inline-flex items-center justify-center gap-2 rounded-lg bg-[#83f0ce] px-4 py-2.5 text-xs font-bold text-[#071511] transition hover:bg-[#a1f7dc]">
          Sign in / Create account
        </a>
      </section>
    );
  }

  return (
    <section className="mb-6 rounded-xl border border-[#83f0ce]/20 bg-[#0b1219] p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <div className="grid size-9 place-items-center rounded-lg border border-[#83f0ce]/20 bg-[#83f0ce]/[.08] text-[#83f0ce]">
            <KeyRound size={17} />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-slate-100">Remote MCP API keys</h3>
            <p className="mt-1 text-[10px] text-slate-500">Create a private credential for an external MCP client. OAuth is not used.</p>
          </div>
        </div>
        <a href="https://mvm3dforge.vercel.app/mcp" target="_blank" rel="noreferrer" className="text-[10px] text-[#83f0ce] hover:underline">
          MCP endpoint ↗
        </a>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-[1fr_160px]">
        <label className="block text-[10px] font-medium text-slate-400">
          Key name
          <input value={name} maxLength={80} onChange={(e) => setName(e.target.value)} className="mt-1 w-full rounded-lg border border-white/10 bg-[#080d12] px-3 py-2 text-xs text-slate-100 outline-none focus:border-[#83f0ce]/50" placeholder="Claude Desktop, Cursor..." />
        </label>
        <label className="block text-[10px] font-medium text-slate-400">
          Expires
          <select value={expiresInDays} onChange={(e) => setExpiresInDays(e.target.value)} className="mt-1 w-full rounded-lg border border-white/10 bg-[#080d12] px-3 py-2 text-xs text-slate-100 outline-none focus:border-[#83f0ce]/50">
            <option value="30">30 days</option>
            <option value="90">90 days</option>
            <option value="180">180 days</option>
            <option value="365">365 days</option>
            <option value="never">No expiry</option>
          </select>
        </label>
      </div>

      <div className="mt-3 grid gap-2 sm:grid-cols-3">
        {AVAILABLE_SCOPES.map((scope) => (
          <label key={scope.id} className="flex cursor-pointer gap-2 rounded-lg border border-white/[.08] bg-white/[.02] p-3">
            <input type="checkbox" checked={scopes.includes(scope.id)} onChange={(e) => setScopes((current) => e.target.checked ? [...current, scope.id] : current.filter((item) => item !== scope.id))} className="mt-0.5 accent-[#83f0ce]" />
            <span>
              <span className="block text-[11px] font-semibold text-slate-200">{scope.title}</span>
              <span className="mt-1 block text-[10px] leading-4 text-slate-500">{scope.detail}</span>
            </span>
          </label>
        ))}
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button type="button" onClick={() => void createKey()} disabled={creating || loading || name.trim().length < 2 || scopes.length === 0} className="inline-flex items-center gap-2 rounded-lg bg-[#83f0ce] px-3 py-2 text-[11px] font-semibold text-[#071511] disabled:cursor-not-allowed disabled:opacity-50">
          {creating ? <LoaderCircle size={13} className="animate-spin" /> : <Plus size={13} />} Create API key
        </button>
        <button type="button" onClick={() => void reload()} disabled={loading} className="inline-flex items-center gap-2 rounded-lg border border-white/10 px-3 py-2 text-[11px] text-slate-300 hover:border-white/25 disabled:opacity-50">
          <RefreshCw size={13} className={loading ? "animate-spin" : ""} /> Refresh
        </button>
        <span className="text-[10px] text-slate-500">Use the key as <code>Authorization: Bearer mvmf_live_…</code>.</span>
      </div>

      {newKey && (
        <div className="mt-4 rounded-lg border border-amber-300/25 bg-amber-300/[.05] p-3">
          <div className="flex items-center gap-2 text-[11px] font-semibold text-amber-200"><ShieldCheck size={14} /> Copy your new secret now</div>
          <div className="mt-2 flex flex-col gap-2 sm:flex-row">
            <code className="min-w-0 flex-1 break-all rounded-md border border-white/10 bg-[#080d12] p-2 text-[11px] text-slate-200">{newKey}</code>
            <button onClick={() => void copyKey()} className="inline-flex shrink-0 items-center justify-center gap-2 rounded-lg border border-white/15 px-3 py-2 text-[11px] text-slate-200 hover:border-[#83f0ce]/40">
              {copied ? <Check size={13} /> : <Copy size={13} />} {copied ? "Copied" : "Copy key"}
            </button>
          </div>
          <p className="mt-2 text-[10px] text-amber-100/70">The database stores only a one-way hash; after you leave this panel, the secret cannot be retrieved.</p>
        </div>
      )}

      {message && <p className="mt-3 text-[10px] text-[#83f0ce]">{message}</p>}
      {error && <p role="alert" className="mt-3 rounded-lg border border-red-400/20 bg-red-400/[.06] p-3 text-[11px] text-red-200">{error}</p>}

      <div className="mt-4 border-t border-white/[.08] pt-3">
        <div className="mb-2 flex items-center justify-between gap-2">
          <h4 className="text-[11px] font-semibold text-slate-300">Existing keys</h4>
          <span className="text-[10px] text-slate-500">{keys.filter((key) => !key.revokedAt && (key.expiresAt == null || key.expiresAt > Date.now())).length} active</span>
        </div>
        {loading ? (
          <div className="flex items-center gap-2 py-4 text-[11px] text-slate-500"><LoaderCircle size={14} className="animate-spin" /> Loading keys…</div>
        ) : keys.length === 0 ? (
          <p className="rounded-lg border border-dashed border-white/10 p-4 text-center text-[11px] text-slate-500">No API keys yet. Create one for your MCP client.</p>
        ) : (
          <div className="space-y-2">
            {keys.map((key) => {
              const inactive = Boolean(key.revokedAt || (key.expiresAt != null && key.expiresAt <= Date.now()));
              return (
                <div key={key.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-white/[.08] bg-white/[.02] p-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-[11px] font-semibold text-slate-200">{key.name}</span>
                      <span className={`rounded px-1.5 py-0.5 text-[9px] ${inactive ? "bg-white/5 text-slate-500" : "bg-[#83f0ce]/10 text-[#83f0ce]"}`}>{inactive ? "INACTIVE" : "ACTIVE"}</span>
                    </div>
                    <code className="mt-1 block text-[10px] text-slate-500">{key.prefix}••••••••</code>
                    <p className="mt-1 text-[10px] text-slate-500">Created {when(key.createdAt)} · Last used {when(key.lastUsedAt)} · Expires {when(key.expiresAt)}</p>
                    <p className="mt-1 text-[10px] text-slate-600">{key.scopes.join(" · ")}</p>
                  </div>
                  {!key.revokedAt && (
                    <button onClick={() => void revokeKey(key.id)} title="Revoke key" className="inline-flex items-center gap-1.5 rounded-lg border border-red-400/20 px-2.5 py-2 text-[10px] text-red-200 hover:bg-red-400/[.06]">
                      <Trash2 size={12} /> Revoke
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}
