import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { ArrowLeft, Copy, Download, Send, Sparkles } from "lucide-react";
import { AIProviderPanel } from "@/components/AIProviderPanel";

export const Route = createFileRoute("/Prompt2Model")({ component: Prompt2ModelPage });

function Prompt2ModelPage() {
  const [code, setCode] = useState("");
  const [status, setStatus] = useState("Connect a language-model provider, describe the scene, and review the generated script.");

  async function copyScript() {
    if (!code.trim()) return;
    try {
      await navigator.clipboard.writeText(code);
      setStatus("Scene script copied.");
    } catch {
      setStatus("Clipboard access was blocked. Select and copy the script manually.");
    }
  }

  function downloadScript() {
    if (!code.trim()) return;
    const blob = new Blob([code], { type: "text/javascript;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "mvm3d-prompt-scene.mvm.js";
    anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    setStatus("Scene script downloaded. Review it before running it in Studio.");
  }

  function sendToStudio() {
    if (!code.trim()) return;
    try {
      window.localStorage.setItem("mvm3d.prompt2model.pending-code", code);
      window.location.assign("/studio");
    } catch {
      setStatus("Could not hand off the script to Studio. Use Copy script instead.");
    }
  }

  return (
    <main className="min-h-screen bg-[#070c11] px-4 py-6 text-[#eaf2f8] sm:px-6 lg:px-8">
      <div className="mx-auto max-w-7xl">
        <header className="mb-7 flex flex-wrap items-center justify-between gap-4 border-b border-white/[.09] pb-5">
          <div>
            <a href="/studio" className="mb-3 inline-flex items-center gap-2 text-xs text-slate-400 hover:text-[#83f0ce]">
              <ArrowLeft size={14} /> Back to Studio
            </a>
            <div className="flex items-center gap-3">
              <span className="grid size-11 place-items-center rounded-xl border border-[#83f0ce]/25 bg-[#83f0ce]/[.08] text-[#83f0ce]">
                <Sparkles size={21} />
              </span>
              <div>
                <p className="text-[10px] font-bold uppercase tracking-[.2em] text-[#83f0ce]">Separate AI workflow</p>
                <h1 className="mt-1 text-2xl font-semibold tracking-tight sm:text-3xl">Prompt2Model</h1>
              </div>
            </div>
          </div>
          <div className="rounded-full border border-white/10 px-3 py-2 text-[10px] text-slate-400">
            Prompt → editable scene script → Studio
          </div>
        </header>

        <div className="mb-6 max-w-3xl text-sm leading-6 text-slate-400">
          Describe the 3D scene you want. The configured language model drafts JavaScript for MVM3D's real scene runtime.
          This is a code-first scene workflow, not a direct AI mesh-file generator; generated scripts are never executed automatically.
          Provider API keys on this page are separate from the OAuth connection used by ChatGPT, Claude, or a compatible Grok connector to access the MCP server.
        </div>

        <div className="grid min-w-0 gap-5 xl:grid-cols-[minmax(0,1.05fr)_minmax(0,.95fr)]">
          <div className="min-w-0">
            <AIProviderPanel
              code={code}
              onApplyCode={(nextCode) => {
                setCode(nextCode);
                setStatus("Generated scene script saved below. Review it before sending it to Studio.");
              }}
              onStatus={setStatus}
            />
          </div>
          <section className="min-w-0 overflow-hidden rounded-2xl border border-white/[.1] bg-[#0b1219]">
            <header className="flex flex-wrap items-center justify-between gap-3 border-b border-white/[.08] px-4 py-3">
              <div>
                <h2 className="text-sm font-semibold">Scene script</h2>
                <p className="mt-1 text-[10px] text-slate-500">Editable JavaScript · review before running</p>
              </div>
              <div className="flex flex-wrap gap-2">
                <button type="button" onClick={() => void copyScript()} disabled={!code.trim()} className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 px-3 py-2 text-[11px] font-semibold text-slate-200 hover:bg-white/[.05] disabled:opacity-40">
                  <Copy size={13} /> Copy
                </button>
                <button type="button" onClick={downloadScript} disabled={!code.trim()} className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 px-3 py-2 text-[11px] font-semibold text-slate-200 hover:bg-white/[.05] disabled:opacity-40">
                  <Download size={13} /> Download
                </button>
                <button type="button" onClick={sendToStudio} disabled={!code.trim()} className="inline-flex items-center gap-1.5 rounded-lg bg-[#83f0ce] px-3 py-2 text-[11px] font-bold text-[#071511] hover:bg-[#a1f7dc] disabled:opacity-40">
                  <Send size={13} /> Send to Studio
                </button>
              </div>
            </header>
            <textarea value={code} onChange={(event) => setCode(event.target.value)} spellCheck={false} aria-label="Editable Prompt2Model scene script" placeholder="// Generated scene JavaScript will appear here after you apply it from AI Workbench." className="min-h-[420px] w-full resize-y border-0 bg-[#070c11] p-4 font-mono text-xs leading-6 text-[#d5e4ed] outline-none placeholder:text-slate-700 sm:min-h-[560px]" />
            <footer className="border-t border-white/[.08] px-4 py-3 text-[11px] text-slate-500">{status}</footer>
          </section>
        </div>
      </div>
    </main>
  );
}
