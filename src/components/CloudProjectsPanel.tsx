import { useEffect, useState } from "react";
import { CloudDownload, CloudUpload, FolderOpen, LoaderCircle, RefreshCw, Trash2 } from "lucide-react";
import type { Project } from "@/forge/types.ts";

type CloudProject = { id: string; name: string; updatedAt: number };
type Props = {
  project: Project | null;
  code: string;
  onOpen: (project: Project) => void;
  onStatus: (message: string) => void;
};

export function CloudProjectsPanel({ project, code, onOpen, onStatus }: Props) {
  const [projects, setProjects] = useState<CloudProject[]>([]);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");

  async function reload() {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/forge-projects", { credentials: "same-origin" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not load cloud projects.");
      setProjects(Array.isArray(data.projects) ? data.projects : []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load cloud projects.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void reload(); }, []);

  async function saveCurrent() {
    if (!project) return;
    setWorking(true);
    setError("");
    try {
      const response = await fetch("/api/forge-projects", {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ project: { ...project, code, updatedAt: Date.now() } }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not save cloud project.");
      onStatus(`Saved “${data.project.name}” to cloud storage.`);
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save cloud project.");
    } finally {
      setWorking(false);
    }
  }

  async function openProject(id: string) {
    setWorking(true);
    setError("");
    try {
      const response = await fetch(`/api/forge-projects?id=${encodeURIComponent(id)}`, { credentials: "same-origin" });
      const data = await response.json();
      if (!response.ok || !data.project) throw new Error(data.error || "Could not open cloud project.");
      onOpen(data.project as Project);
      onStatus(`Opened cloud project “${data.project.name}”.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not open cloud project.");
    } finally {
      setWorking(false);
    }
  }

  async function deleteProject(id: string) {
    if (!window.confirm("Delete this saved cloud project? This cannot be undone.")) return;
    setWorking(true);
    setError("");
    try {
      const response = await fetch(`/api/forge-projects?id=${encodeURIComponent(id)}`, {
        method: "DELETE",
        credentials: "same-origin",
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not delete cloud project.");
      onStatus("Cloud project deleted.");
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not delete cloud project.");
    } finally {
      setWorking(false);
    }
  }

  return (
    <section className="mb-6 rounded-xl border border-white/10 bg-[#0b1219] p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <div className="grid size-9 place-items-center rounded-lg border border-white/10 bg-white/[.04] text-[#83f0ce]">
            <FolderOpen size={17} />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-slate-100">Cloud projects</h3>
            <p className="mt-1 text-[10px] text-slate-500">Persist scenes to Postgres and reopen projects changed through MCP.</p>
          </div>
        </div>
        <div className="flex gap-2">
          <button type="button" onClick={() => void reload()} disabled={loading || working} className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 px-2.5 py-2 text-[10px] text-slate-300 disabled:opacity-50">
            <RefreshCw size={12} className={loading ? "animate-spin" : ""} /> Refresh
          </button>
          <button type="button" onClick={() => void saveCurrent()} disabled={!project || working || loading} className="inline-flex items-center gap-1.5 rounded-lg bg-[#83f0ce] px-3 py-2 text-[10px] font-semibold text-[#071511] disabled:opacity-50">
            {working ? <LoaderCircle size={12} className="animate-spin" /> : <CloudUpload size={12} />} Save current
          </button>
        </div>
      </div>
      {error && <p role="alert" className="mt-3 rounded-lg border border-red-400/20 bg-red-400/[.06] p-3 text-[11px] text-red-200">{error}</p>}
      <div className="mt-3 space-y-2">
        {loading ? (
          <div className="flex items-center gap-2 py-4 text-[11px] text-slate-500"><LoaderCircle size={13} className="animate-spin" /> Loading saved projects…</div>
        ) : projects.length === 0 ? (
          <div className="rounded-lg border border-dashed border-white/10 p-4 text-center text-[11px] text-slate-500">No cloud projects saved yet. Click “Save current”, or create a project through an authenticated MCP client.</div>
        ) : projects.map((item) => (
          <div key={item.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-white/[.08] bg-white/[.02] p-3">
            <div className="min-w-0 flex-1">
              <div className="truncate text-[11px] font-semibold text-slate-200">{item.name}</div>
              <div className="mt-1 break-all text-[9px] text-slate-600">{item.id}</div>
              <div className="mt-1 text-[10px] text-slate-500">Updated {new Date(item.updatedAt).toLocaleString()}</div>
            </div>
            <div className="flex gap-2">
              <button type="button" onClick={() => void openProject(item.id)} disabled={working} className="inline-flex items-center gap-1.5 rounded-lg border border-[#83f0ce]/20 px-2.5 py-2 text-[10px] text-[#83f0ce] disabled:opacity-50">
                <CloudDownload size={12} /> Open
              </button>
              <button type="button" onClick={() => void deleteProject(item.id)} disabled={working} title="Delete cloud project" className="inline-flex items-center gap-1.5 rounded-lg border border-red-400/20 px-2.5 py-2 text-[10px] text-red-200 disabled:opacity-50">
                <Trash2 size={12} /> Delete
              </button>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
