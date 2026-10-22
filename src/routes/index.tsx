import { createFileRoute } from "@tanstack/react-router";
import { Box, Braces, Layers3, ArrowUpRight, CircleDot } from "lucide-react";

export const Route = createFileRoute("/")({ component: Home });

const capabilities = [
  {
    icon: Box,
    index: "01",
    title: "Procedural geometry",
    detail: "Build editable mesh primitives and custom geometry from code.",
  },
  {
    icon: Layers3,
    index: "02",
    title: "Materials & scene",
    detail: "Organize objects, material properties, transforms and scene data.",
  },
  {
    icon: Braces,
    index: "03",
    title: "Code-first workflow",
    detail: "Keep the project reproducible, inspectable and versionable.",
  },
];

function Home() {
  return (
    <main className="min-h-screen overflow-hidden bg-[#0b1016] text-[#edf3f8]">
      <div className="pointer-events-none fixed inset-0" aria-hidden="true">
        <div className="absolute -top-48 left-[18%] h-[34rem] w-[34rem] rounded-full bg-[#43d9b3]/[0.08] blur-[120px]" />
        <div className="absolute right-[-10rem] top-[28%] h-[30rem] w-[30rem] rounded-full bg-[#568cff]/[0.08] blur-[130px]" />
        <div className="absolute inset-0 opacity-[0.12]" style={{ backgroundImage: "linear-gradient(rgba(160,190,210,.14) 1px, transparent 1px), linear-gradient(90deg, rgba(160,190,210,.14) 1px, transparent 1px)", backgroundSize: "48px 48px", maskImage: "linear-gradient(to bottom, black, transparent 82%)" }} />
      </div>

      <div className="relative mx-auto flex min-h-screen max-w-7xl flex-col px-5 sm:px-8">
        <header className="flex h-[76px] items-center justify-between border-b border-white/[0.09]">
          <a href="/" className="flex items-center gap-3 no-underline" aria-label="MVM 3D Forge home">
            <span className="grid size-10 place-items-center rounded-xl border border-[#83f0ce]/30 bg-[#83f0ce]/[0.08] text-[#83f0ce]">
              <Box size={21} strokeWidth={1.8} />
            </span>
            <span className="leading-tight">
              <span className="block text-sm font-bold tracking-[0.13em]">MVM <span className="text-[#83f0ce]">3D</span> FORGE</span>
              <span className="mt-1 block text-[10px] uppercase tracking-[0.2em] text-[#71808f]">Code-first 3D studio</span>
            </span>
          </a>
          <div className="flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.035] px-3 py-1.5 text-[11px] text-[#a9b7c5]">
            <CircleDot size={12} className="text-[#83f0ce]" />
            <span>Developer preview</span>
          </div>
        </header>

        <section className="grid flex-1 items-center gap-12 py-16 lg:grid-cols-[1.05fr_.95fr] lg:py-20">
          <div className="max-w-2xl">
            <div className="mb-7 inline-flex items-center gap-2 rounded-full border border-[#83f0ce]/20 bg-[#83f0ce]/[0.06] px-3 py-1.5 text-[11px] font-medium uppercase tracking-[0.16em] text-[#83f0ce]">
              <span className="size-1.5 rounded-full bg-[#83f0ce]" />
              Built for creators who code
            </div>
            <h1 className="text-5xl font-semibold leading-[0.98] tracking-[-0.055em] sm:text-6xl lg:text-[4.7rem]">
              Your ideas.
              <br />
              <span className="text-[#83f0ce]">In three dimensions.</span>
            </h1>
            <p className="mt-7 max-w-xl text-base leading-7 text-[#9eacb9] sm:text-lg">
              MVM 3D Forge is being built around a simple principle: 3D assets should be
              creatable through readable code, editable as real scene data, and exportable
              to portable formats.
            </p>
            <div className="mt-9 flex flex-wrap items-center gap-3">
              <div className="inline-flex items-center gap-2 rounded-xl bg-[#83f0ce] px-5 py-3 text-sm font-semibold text-[#071511]">
                Studio foundation <ArrowUpRight size={16} />
              </div>
              <span className="text-xs text-[#71808f]">No AI required for the core workflow</span>
            </div>
            <div className="mt-12 flex items-center gap-6 border-t border-white/[0.09] pt-6 text-xs text-[#71808f]">
              <span>01 / Code</span>
              <span className="text-[#34434f]">—</span>
              <span>02 / Create</span>
              <span className="text-[#34434f]">—</span>
              <span>03 / Export</span>
            </div>
          </div>

          <div className="relative">
            <div className="absolute -inset-5 rounded-[2rem] bg-[#83f0ce]/[0.035] blur-2xl" />
            <div className="relative overflow-hidden rounded-2xl border border-white/[0.12] bg-[#111923]/90 shadow-2xl shadow-black/30">
              <div className="flex items-center justify-between border-b border-white/[0.08] px-5 py-4">
                <div>
                  <div className="text-xs font-semibold tracking-wide">CORE WORKFLOW</div>
                  <div className="mt-1 text-[10px] text-[#71808f]">Conceptual example · SDK API may evolve</div>
                </div>
                <div className="flex gap-1.5" aria-hidden="true">
                  <span className="size-2 rounded-full bg-[#ff6f6f]/80" />
                  <span className="size-2 rounded-full bg-[#f6c66b]/80" />
                  <span className="size-2 rounded-full bg-[#83f0ce]/80" />
                </div>
              </div>
              <pre className="overflow-x-auto p-5 text-[12px] leading-6 text-[#c4d0db] sm:p-6 sm:text-[13px]"><code><span className="text-[#9d9aff]">const</span> body = geometry.createBox({"{\n"}  width: <span className="text-[#f3c77b]">1.2</span>,{ "\n"}  height: <span className="text-[#f3c77b]">1.8</span>,{ "\n"}  depth: <span className="text-[#f3c77b]">0.8</span>{ "\n"}{"});"}{"\n\n"}body.setMaterial(material.createPBR({"{\n"}  color: <span className="text-[#8ee5bd]">"#83f0ce"</span>,{ "\n"}  roughness: <span className="text-[#f3c77b]">0.42</span>,{ "\n"}  metalness: <span className="text-[#f3c77b]">0.12</span>{ "\n"}{"}));"}{"\n\n"}scene.add(body);</code></pre>
              <div className="flex items-center justify-between border-t border-white/[0.08] bg-black/10 px-5 py-3">
                <span className="text-[10px] text-[#71808f]">Illustrative SDK snippet — not an executable demo</span>
                <span className="text-[10px] font-medium text-[#83f0ce]">MVM / SDK</span>
              </div>
            </div>
            <div className="absolute -bottom-5 -left-3 rounded-xl border border-white/10 bg-[#151f29] px-4 py-3 shadow-xl sm:-left-7">
              <div className="text-[10px] uppercase tracking-[0.15em] text-[#71808f]">Target format</div>
              <div className="mt-1 text-sm font-semibold">glTF 2.0 · .glb</div>
            </div>
          </div>
        </section>

        <section className="grid gap-3 border-t border-white/[0.09] py-8 md:grid-cols-3">
          {capabilities.map((item) => {
            const Icon = item.icon;
            return (
              <article key={item.index} className="rounded-xl border border-white/[0.08] bg-white/[0.025] p-5 transition-colors hover:border-[#83f0ce]/25 hover:bg-white/[0.04]">
                <div className="flex items-center justify-between">
                  <span className="grid size-10 place-items-center rounded-lg border border-white/[0.09] bg-white/[0.035] text-[#83f0ce]">
                    <Icon size={19} strokeWidth={1.7} />
                  </span>
                  <span className="font-mono text-[10px] tracking-[0.15em] text-[#5e6e7c]">{item.index}</span>
                </div>
                <h2 className="mt-5 text-sm font-semibold">{item.title}</h2>
                <p className="mt-2 text-xs leading-5 text-[#8796a4]">{item.detail}</p>
              </article>
            );
          })}
        </section>

        <footer className="flex flex-col gap-2 border-t border-white/[0.09] py-5 text-[10px] text-[#62717e] sm:flex-row sm:items-center sm:justify-between">
          <span>© {new Date().getFullYear()} MvMSOLO · MVM 3D Forge</span>
          <span>Foundation build · Capabilities must be verified before production claims</span>
        </footer>
      </div>
    </main>
  );
}
