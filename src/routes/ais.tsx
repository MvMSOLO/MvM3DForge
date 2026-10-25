import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import {
  Activity,
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  Bot,
  Boxes,
  Check,
  Clipboard,
  Cloud,
  Code2,
  Eye,
  Image as ImageIcon,
  Layers3,
  LockKeyhole,
  Network,
  Play,
  ScanEye,
  ShieldCheck,
  Sparkles,
  Workflow,
} from "lucide-react";

export const Route = createFileRoute("/ais")({ component: AISPage });

const MCP_ENDPOINT = "https://mvm3d.vercel.app/mcp";

const capabilities = [
  { name: "get_project / read_scene", detail: "Read the saved project, scene graph, materials, transforms, animation clips and source code.", icon: Boxes },
  { name: "get_reference_image", detail: "Send the saved image to a vision-capable client as real MCP image content, not a text-only placeholder.", icon: ImageIcon },
  { name: "create_3d_from_image", detail: "Queue model-authored JavaScript for editable geometry in the actual Studio browser sandbox.", icon: Code2 },
  { name: "get_execution_job", detail: "Return script logs, validation issues and a real viewport screenshot as MCP image content.", icon: Eye },
  { name: "diagnose_project / export_project_glb", detail: "Check budgets and scene errors, then export a real binary GLB when the result is ready.", icon: ShieldCheck },
];

const stages = [
  { number: "01", title: "AI client", detail: "Grok / ChatGPT / another compatible MCP client", icon: Bot, color: "text-[#b9a7ff]", edge: "border-[#9d8cf8]/30" },
  { number: "02", title: "OAuth + scopes", detail: "Login, authorization and scoped access", icon: LockKeyhole, color: "text-[#83f0ce]", edge: "border-[#83f0ce]/30" },
  { number: "03", title: "MCP /mcp", detail: "Tool discovery, project resources and commands", icon: Network, color: "text-[#a9c9ff]", edge: "border-[#568cff]/30" },
  { number: "04", title: "Cloud project", detail: "Owned project, code, scene and image references", icon: Cloud, color: "text-[#f6cb85]", edge: "border-[#f6cb85]/30" },
  { number: "05", title: "Studio worker", detail: "Code runs in the real, open 3D viewport", icon: Workflow, color: "text-[#83f0ce]", edge: "border-[#83f0ce]/30" },
  { number: "06", title: "Visual feedback", detail: "Screenshot + logs return to the AI for iteration", icon: ScanEye, color: "text-[#a9c9ff]", edge: "border-[#568cff]/30" },
];

function AISPage() {
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState("");

  async function copyEndpoint() {
    setCopyError("");
    try {
      await navigator.clipboard.writeText(MCP_ENDPOINT);
      setCopied(true);
    } catch {
      setCopyError("Copy permission was blocked. Select the endpoint text and copy it manually.");
      setCopied(false);
    }
  }

  return (
    <main className="min-h-screen overflow-hidden bg-[#080d12] text-[#e8f0f6]">
      <div className="pointer-events-none fixed inset-0" aria-hidden="true">
        <div className="absolute -top-48 left-[15%] h-[34rem] w-[34rem] rounded-full bg-[#83f0ce]/[.07] blur-[130px]" />
        <div className="absolute right-[-8rem] top-[32%] h-[30rem] w-[30rem] rounded-full bg-[#568cff]/[.08] blur-[135px]" />
        <div className="absolute inset-0 opacity-[.08]" style={{ backgroundImage: "linear-gradient(rgba(160,190,210,.2) 1px, transparent 1px), linear-gradient(90deg, rgba(160,190,210,.2) 1px, transparent 1px)", backgroundSize: "42px 42px", maskImage: "linear-gradient(to bottom, black, transparent 78%)" }} />
      </div>

      <div className="relative mx-auto max-w-7xl px-4 pb-16 sm:px-7">
        <header className="flex flex-wrap items-center justify-between gap-4 border-b border-white/[.09] py-5">
          <a href="/studio" className="inline-flex items-center gap-2 rounded-lg border border-white/10 px-3 py-2 text-xs text-slate-300 transition hover:border-[#83f0ce]/40 hover:text-[#83f0ce]">
            <ArrowLeft size={14} /> Back to Studio
          </a>
          <a href="/" className="text-[11px] font-bold tracking-[.18em] text-slate-400 no-underline">
            MVM <span className="text-[#83f0ce]">3D</span> FORGE
          </a>
          <div className="inline-flex items-center gap-2 rounded-full border border-[#83f0ce]/25 bg-[#83f0ce]/[.06] px-3 py-1.5 text-[10px] uppercase tracking-[.16em] text-[#83f0ce]">
            <Activity size={12} /> AIS · AI Systems
          </div>
        </header>

        <section className="grid gap-10 py-12 lg:grid-cols-[1fr_.72fr] lg:items-end lg:py-16">
          <div>
            <div className="mb-5 inline-flex items-center gap-2 rounded-full border border-[#83f0ce]/20 bg-[#83f0ce]/[.06] px-3 py-1.5 text-[10px] uppercase tracking-[.18em] text-[#83f0ce]">
              <Sparkles size={12} /> Connected AI workbench
            </div>
            <h1 className="max-w-3xl text-4xl font-semibold leading-[1.02] tracking-[-.045em] sm:text-6xl">
              From image to <span className="text-[#83f0ce]">editable 3D</span> — with visual feedback.
            </h1>
            <p className="mt-6 max-w-2xl text-sm leading-7 text-slate-400 sm:text-base">
              AIS is the transparent bridge between your connected AI and a real MVM 3D project. The AI inspects scene data or a saved reference image, writes code, runs a preview in Studio, then receives the viewport image and errors so it can iterate.
            </p>
          </div>

          <div className="rounded-2xl border border-white/[.11] bg-[#0c141c]/85 p-5 shadow-2xl shadow-black/20">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-[10px] uppercase tracking-[.18em] text-slate-500">Remote MCP endpoint</div>
                <div className="mt-1 text-sm font-semibold text-white">MVM 3D AI Bridge</div>
              </div>
              <span className="rounded-full border border-[#83f0ce]/20 bg-[#83f0ce]/[.06] px-2.5 py-1 text-[9px] font-semibold uppercase tracking-widest text-[#83f0ce]">OAuth</span>
            </div>
            <div className="mt-4 break-all rounded-xl border border-white/10 bg-black/30 px-3 py-3 font-mono text-[11px] leading-5 text-[#b9f5e4]">{MCP_ENDPOINT}</div>
            <button onClick={() => void copyEndpoint()} className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-lg bg-[#83f0ce] px-4 py-3 text-xs font-bold text-[#071511] transition hover:bg-[#a1f7dc]">
              {copied ? <Check size={14} /> : <Clipboard size={14} />}
              {copied ? "Endpoint copied" : "Copy MCP endpoint"}
            </button>
            {copyError && <p role="alert" className="mt-2 text-[10px] leading-5 text-amber-200">{copyError}</p>}
            <p className="mt-3 text-[10px] leading-5 text-slate-500">Connect this URL from your AI client's custom MCP connector, complete OAuth, then ask it to work on a saved cloud project.</p>
          </div>
        </section>

        <section className="rounded-2xl border border-white/[.09] bg-[#0b1219]/85 p-4 sm:p-6">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <div className="text-[10px] font-semibold uppercase tracking-[.2em] text-[#83f0ce]">System map</div>
              <h2 className="mt-2 text-xl font-semibold tracking-tight">The full request-to-render loop</h2>
            </div>
            <div className="text-[10px] text-slate-500">Actual components · no fake model status</div>
          </div>

          <div className="mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {stages.map((stage, index) => {
              const Icon = stage.icon;
              return (
                <div key={stage.number} className={`relative rounded-xl border ${stage.edge} bg-white/[.025] p-4`}>
                  <div className="flex items-center justify-between gap-3">
                    <span className={`grid size-10 place-items-center rounded-xl border border-white/10 bg-black/20 ${stage.color}`}><Icon size={19} /></span>
                    <span className="font-mono text-[10px] tracking-widest text-slate-600">{stage.number}</span>
                  </div>
                  <h3 className="mt-4 text-sm font-semibold text-slate-100">{stage.title}</h3>
                  <p className="mt-2 text-[11px] leading-5 text-slate-400">{stage.detail}</p>
                  {index < stages.length - 1 && <div className="mt-4 flex items-center gap-2 text-[9px] uppercase tracking-[.16em] text-slate-600"><ArrowRight size={12} /> Passes data forward</div>}
                </div>
              );
            })}
          </div>
        </section>

        <section className="mt-5 grid gap-5 lg:grid-cols-[.9fr_1.1fr]">
          <div className="rounded-2xl border border-white/[.09] bg-[#0b1219]/85 p-5 sm:p-6">
            <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[.2em] text-[#a9c9ff]"><ImageIcon size={14} /> Image → 3D workflow</div>
            <h2 className="mt-3 text-xl font-semibold">Let the AI see the reference and the result</h2>
            <div className="mt-5 space-y-4">
              {[
                ["01", "Import Image in Studio", "Add a PNG, JPEG or WebP image as a visible reference plane. For MCP access, the reference is also synced to the owned cloud project."],
                ["02", "Call get_reference_image", "The AI receives actual image content through MCP and can reason about silhouette, proportions, colors and parts."],
                ["03", "Create editable geometry", "The connected AI authors JavaScript and calls create_3d_from_image in preview mode. This uses the real Forge SDK and Three.js scene."],
                ["04", "Inspect + iterate", "The AI polls get_execution_job. On completion, the tool returns the viewport screenshot and logs as MCP content. The AI can fix issues and render again."],
              ].map(([number, title, detail]) => (
                <div key={number} className="flex gap-3">
                  <span className="grid size-7 shrink-0 place-items-center rounded-lg border border-white/10 font-mono text-[10px] text-[#83f0ce]">{number}</span>
                  <div><h3 className="text-xs font-semibold text-slate-200">{title}</h3><p className="mt-1 text-[11px] leading-5 text-slate-400">{detail}</p></div>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-2xl border border-white/[.09] bg-[#0b1219]/85 p-5 sm:p-6">
            <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[.2em] text-[#83f0ce]"><Layers3 size={14} /> Exposed MCP tools</div>
            <h2 className="mt-3 text-xl font-semibold">What the connected model can actually call</h2>
            <div className="mt-5 space-y-2.5">
              {capabilities.map((item) => {
                const Icon = item.icon;
                return <div key={item.name} className="flex gap-3 rounded-xl border border-white/[.07] bg-white/[.02] p-3">
                  <Icon size={16} className="mt-0.5 shrink-0 text-[#83f0ce]" />
                  <div><div className="font-mono text-[10px] font-semibold text-slate-200">{item.name}</div><p className="mt-1 text-[10px] leading-5 text-slate-400">{item.detail}</p></div>
                </div>;
              })}
            </div>
          </div>
        </section>

        <section className="mt-5 rounded-2xl border border-amber-300/20 bg-amber-200/[.035] p-5">
          <div className="flex items-center gap-2 text-xs font-semibold text-amber-100"><Activity size={15} /> Important: the execution loop has a real browser dependency</div>
          <p className="mt-2 max-w-5xl text-[11px] leading-6 text-slate-400">
            To run scripts or capture the real viewport, open the target <strong className="text-slate-200">saved cloud project</strong> in Studio and keep that tab open while the connected AI works. Local starter projects are not remotely addressable until saved to Cloud projects. The MCP server does not pretend to run a hidden AI model: vision and code reasoning come from the AI client you connected; MVM3D stores the scene, executes code in Studio, validates results and returns the actual preview image.
          </p>
          <div className="mt-4 flex flex-wrap gap-3">
            <a href="/studio" className="inline-flex items-center gap-2 rounded-lg bg-[#83f0ce] px-4 py-2.5 text-xs font-bold text-[#071511] no-underline transition hover:bg-[#a1f7dc]"><Play size={13} /> Open Studio</a>
            <a href="/studio" className="inline-flex items-center gap-2 rounded-lg border border-white/10 px-4 py-2.5 text-xs font-semibold text-slate-300 no-underline transition hover:border-white/25"><ArrowDown size={13} /> Studio · open Workspace → 3D stack</a>
          </div>
        </section>

        <footer className="mt-8 flex flex-wrap items-center justify-between gap-3 border-t border-white/[.08] pt-5 text-[10px] text-slate-600">
          <span>MVM 3D Forge · AIS / AI Systems</span>
          <span>OAuth · Streamable HTTP MCP · browser-side execution · image feedback</span>
        </footer>
      </div>
    </main>
  );
}
