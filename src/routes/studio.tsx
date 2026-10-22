import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { GLTFExporter } from "three/addons/exporters/GLTFExporter.js";
import { ArrowLeft, Box, Check, Download, FileUp, Play, Save, Sparkles } from "lucide-react";
import { applyScriptPatch, createStarterProject, migrateProject, packageProject } from "@/forge/project.ts";
import { starters, type StarterId } from "@/forge/examples.ts";
import { assembleScene } from "@/forge/scene-three.ts";
import { executeUserCode } from "@/forge/sdk/execute.ts";
import type { Project } from "@/forge/types.ts";

export const Route = createFileRoute("/studio")({ component: Studio });

function downloadBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  URL.revokeObjectURL(url);
}

function Studio() {
  const viewportRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [project, setProject] = useState<Project | null>(null);
  const [code, setCode] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [busy, setBusy] = useState(true);
  const [running, setRunning] = useState(false);
  const [message, setMessage] = useState("Preparing your first scene…");
  const [logs, setLogs] = useState<string[]>([]);
  const [tab, setTab] = useState<"code" | "objects" | "console">("code");
  const [viewMode, setViewMode] = useState<"material" | "solid" | "wireframe">("material");

  useEffect(() => {
    let live = true;
    void createStarterProject("primitives").then(({ project: initial, logs: initialLogs }) => {
      if (!live) return;
      setProject(initial);
      setCode(initial.code);
      setLogs(initialLogs.map((entry) => entry.message));
      setMessage("Ready · Primitive Lab loaded");
      setBusy(false);
    }).catch((error: unknown) => {
      if (!live) return;
      setMessage(error instanceof Error ? error.message : "Studio failed to initialize.");
      setBusy(false);
    });
    return () => { live = false; };
  }, []);

  useEffect(() => {
    const host = viewportRef.current;
    if (!host || !project) return;
    let disposed = false;
    let frame = 0;
    let controls: OrbitControls | undefined;
    let renderer: THREE.WebGLRenderer | undefined;
    let renderScene: THREE.Scene | undefined;
    let camera: THREE.PerspectiveCamera | undefined;
    let resizeObserver: ResizeObserver | undefined;

    void (async () => {
      const built = await assembleScene(project, { mode: viewMode, shadows: true, onlyVisible: false });
      if (disposed) {
        built.scene.traverse((object) => {
          if (object instanceof THREE.Mesh) {
            object.geometry.dispose();
            const materials = Array.isArray(object.material) ? object.material : [object.material];
            materials.forEach((material) => material.dispose());
          }
        });
        return;
      }
      renderScene = built.scene;
      renderScene.background = new THREE.Color(project.scene.background || "#10161e");
      renderScene.add(new THREE.GridHelper(20, 40, "#34505a", "#202e38"));
      const axes = new THREE.AxesHelper(1.5);
      axes.position.y = 0.012;
      renderScene.add(axes);
      camera = new THREE.PerspectiveCamera(42, 1, 0.05, 400);
      camera.position.set(...project.scene.camera.position);
      controls = new OrbitControls(camera, host);
      controls.target.set(...project.scene.camera.target);
      controls.enableDamping = true;
      controls.dampingFactor = 0.07;
      controls.minDistance = 1.5;
      controls.maxDistance = 35;
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: "high-performance" });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = project.scene.exposure || 1;
      renderer.shadowMap.enabled = true;
      renderer.shadowMap.type = THREE.PCFSoftShadowMap;
      renderer.domElement.style.width = "100%";
      renderer.domElement.style.height = "100%";
      renderer.domElement.style.display = "block";
      host.replaceChildren(renderer.domElement);
      const resize = () => {
        if (!renderer || !camera) return;
        const width = Math.max(1, host.clientWidth);
        const height = Math.max(1, host.clientHeight);
        renderer.setSize(width, height, false);
        camera.aspect = width / height;
        camera.updateProjectionMatrix();
      };
      resizeObserver = new ResizeObserver(resize);
      resizeObserver.observe(host);
      resize();
      const tick = () => {
        if (disposed || !renderer || !renderScene || !camera || !controls) return;
        controls.update();
        renderer.render(renderScene, camera);
        frame = requestAnimationFrame(tick);
      };
      tick();
    })().catch((error: unknown) => {
      if (!disposed) setMessage(error instanceof Error ? error.message : "Could not render this scene.");
    });

    return () => {
      disposed = true;
      cancelAnimationFrame(frame);
      resizeObserver?.disconnect();
      controls?.dispose();
      renderer?.dispose();
      renderer?.domElement.remove();
      renderScene?.traverse((object) => {
        if (object instanceof THREE.Mesh) {
          object.geometry.dispose();
          const materials = Array.isArray(object.material) ? object.material : [object.material];
          materials.forEach((material) => material.dispose());
        }
      });
    };
  }, [project, viewMode]);

  async function runCode() {
    if (!project || running) return;
    setRunning(true);
    setLogs([]);
    setMessage("Running code in the restricted MVM SDK…");
    try {
      const result = await executeUserCode(code);
      const nextLogs = result.logs.map((entry) => entry.message);
      if (!result.ok) {
        setLogs([...nextLogs, `[${result.error.code}] ${result.error.message}`]);
        setMessage(result.error.message);
        setTab("console");
        return;
      }
      setLogs(nextLogs);
      const next = applyScriptPatch(project, result.patch);
      setProject(next);
      setSelected(null);
      setMessage(`Run complete · ${next.objects.filter((item) => item.type === "mesh").length} meshes in scene`);
    } catch (error) {
      const detail = error instanceof Error ? error.message : "Code run failed.";
      setLogs([`[Studio] ${detail}`]);
      setTab("console");
      setMessage(detail);
    } finally {
      setRunning(false);
    }
  }

  async function loadStarter(id: StarterId) {
    setBusy(true);
    setMessage("Loading starter scene…");
    try {
      const result = await createStarterProject(id);
      setProject(result.project);
      setCode(result.project.code);
      setLogs(result.logs.map((entry) => entry.message));
      setSelected(null);
      setMessage(`${result.project.name} loaded`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not load starter.");
    } finally {
      setBusy(false);
    }
  }

  function saveProject() {
    if (!project) return;
    downloadBlob(new Blob([packageProject({ ...project, code, updatedAt: Date.now() })], { type: "application/json" }), `${project.name.replace(/[^a-z0-9-_]+/gi, "-").toLowerCase() || "mvm-project"}.mvm.json`);
    setMessage("Project JSON downloaded.");
  }

  async function exportGlb() {
    if (!project) return;
    setBusy(true);
    setMessage("Building and validating binary glTF…");
    try {
      const built = await assembleScene(project, { mode: "material", shadows: false, onlyVisible: false });
      if (!project.objects.some((node) => node.type === "mesh" && node.visible)) {
        setMessage("No visible mesh to export. Run a mesh example first.");
        return;
      }
      const exporter = new GLTFExporter();
      const output = await exporter.parseAsync(built.scene, { binary: true, onlyVisible: false, embedImages: true, maxTextureSize: 2048 });
      if (!(output instanceof ArrayBuffer)) throw new Error("Exporter did not return a binary GLB.");
      const view = new DataView(output);
      if (String.fromCharCode(view.getUint8(0), view.getUint8(1), view.getUint8(2), view.getUint8(3)) !== "glTF" || view.getUint32(4, true) !== 2) {
        throw new Error("The exported file failed the glTF 2.0 header check.");
      }
      downloadBlob(new Blob([output], { type: "model/gltf-binary" }), `${project.name.replace(/[^a-z0-9-_]+/gi, "-").toLowerCase() || "mvm-scene"}.glb`);
      setMessage(`GLB exported · ${(output.byteLength / 1024).toFixed(1)} KB · glTF 2.0 header verified`);
      built.scene.traverse((object) => {
        if (object instanceof THREE.Mesh) {
          object.geometry.dispose();
          const materials = Array.isArray(object.material) ? object.material : [object.material];
          materials.forEach((material) => material.dispose());
        }
      });
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "GLB export failed.");
    } finally {
      setBusy(false);
    }
  }

  async function openProject(file?: File) {
    if (!file) return;
    try {
      const raw = JSON.parse(await file.text()) as unknown;
      const next = migrateProject(raw);
      setProject(next);
      setCode(next.code);
      setLogs([]);
      setMessage(`Opened project · ${next.name}`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not open this project JSON.");
    }
  }

  const meshes = project?.objects.filter((node) => node.type === "mesh") ?? [];
  return (
    <main className="flex min-h-screen flex-col bg-[#080d12] text-[#e8f0f6]">
      <header className="flex min-h-[64px] flex-wrap items-center justify-between gap-3 border-b border-white/10 bg-[#0d141c] px-4 py-3 sm:px-6">
        <div className="flex items-center gap-3">
          <a href="/" aria-label="Back home" className="grid size-9 place-items-center rounded-lg border border-white/10 text-slate-300 transition hover:border-[#83f0ce]/40 hover:text-[#83f0ce]"><ArrowLeft size={17} /></a>
          <span className="grid size-9 place-items-center rounded-lg border border-[#83f0ce]/30 bg-[#83f0ce]/10 text-[#83f0ce]"><Box size={19} /></span>
          <div><div className="text-xs font-bold tracking-[.16em]">MVM <span className="text-[#83f0ce]">3D</span> FORGE</div><div className="mt-1 text-[10px] uppercase tracking-[.16em] text-slate-500">Studio / Developer preview</div></div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button onClick={() => fileRef.current?.click()} className="inline-flex items-center gap-2 rounded-lg border border-white/10 px-3 py-2 text-xs text-slate-300 hover:border-white/25"><FileUp size={14} /> Open</button>
          <input ref={fileRef} type="file" accept=".json,.mvm.json,application/json" className="hidden" onChange={(event) => { void openProject(event.target.files?.[0]); event.currentTarget.value = ""; }} />
          <button onClick={saveProject} disabled={!project} className="inline-flex items-center gap-2 rounded-lg border border-white/10 px-3 py-2 text-xs text-slate-300 hover:border-white/25 disabled:opacity-40"><Save size={14} /> Save project</button>
          <button onClick={() => void exportGlb()} disabled={!project || busy} className="inline-flex items-center gap-2 rounded-lg bg-[#83f0ce] px-3 py-2 text-xs font-semibold text-[#071511] hover:bg-[#a1f7dc] disabled:opacity-50"><Download size={14} /> Export GLB</button>
        </div>
      </header>

      <div className="grid flex-1 grid-cols-1 lg:grid-cols-[220px_minmax(0,1fr)_minmax(320px,38%)]">
        <aside className="border-b border-white/10 bg-[#0c1219] p-4 lg:border-b-0 lg:border-r">
          <div className="mb-3 flex items-center justify-between"><span className="text-[10px] font-semibold uppercase tracking-[.18em] text-slate-500">Start from</span><Sparkles size={14} className="text-[#83f0ce]" /></div>
          <div className="grid grid-cols-2 gap-2 lg:grid-cols-1">
            {starters.filter((item) => ["blank", "primitives", "pbr", "product", "animated"].includes(item.id)).map((item) => (
              <button key={item.id} onClick={() => void loadStarter(item.id)} className="rounded-lg border border-white/[.09] bg-white/[.025] p-3 text-left transition hover:border-[#83f0ce]/40 hover:bg-[#83f0ce]/[.05]">
                <div className="text-xs font-semibold">{item.title}</div><div className="mt-1 text-[10px] leading-4 text-slate-500">{item.summary}</div>
              </button>
            ))}
          </div>
          <div className="mt-6 text-[10px] font-semibold uppercase tracking-[.18em] text-slate-500">Scene objects <span className="ml-1 text-[#83f0ce]">{project?.objects.length ?? 0}</span></div>
          <div className="mt-3 space-y-1">
            {project?.objects.map((node) => <button key={node.id} onClick={() => setSelected(node.id)} className={`w-full rounded-md px-2.5 py-2 text-left text-xs ${selected === node.id ? "bg-[#83f0ce]/10 text-[#83f0ce]" : "text-slate-400 hover:bg-white/[.04]"}`}><span className="mr-2 text-slate-600">{node.type === "mesh" ? "◇" : "◌"}</span>{node.name}</button>)}
          </div>
        </aside>

        <section className="flex min-h-[52vh] flex-col border-b border-white/10 lg:min-h-0 lg:border-b-0 lg:border-r">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/10 bg-[#0d141c] px-4 py-3">
            <div><div className="text-xs font-semibold">3D Viewport</div><div className="mt-1 text-[10px] text-slate-500">Drag to orbit · pinch/scroll to zoom · right-drag to pan</div></div>
            <div className="flex rounded-lg border border-white/10 p-1">{(["material", "solid", "wireframe"] as const).map((mode) => <button key={mode} onClick={() => setViewMode(mode)} className={`rounded-md px-2 py-1.5 text-[10px] capitalize ${viewMode === mode ? "bg-[#83f0ce]/15 text-[#83f0ce]" : "text-slate-500 hover:text-slate-200"}`}>{mode}</button>)}</div>
          </div>
          <div className="relative min-h-[42vh] flex-1 bg-[#10161e]" ref={viewportRef}>
            {!project && <div className="absolute inset-0 grid place-items-center text-sm text-slate-500">{busy ? "Starting renderer…" : "Load a starter scene to begin."}</div>}
            <div className="pointer-events-none absolute bottom-3 left-3 rounded-md border border-white/10 bg-[#080d12]/75 px-3 py-2 text-[10px] text-slate-400"><span className="text-[#83f0ce]">●</span> {meshes.length} mesh objects · Y-up · metres</div>
          </div>
          <div className="flex items-center justify-between gap-3 border-t border-white/10 bg-[#0d141c] px-4 py-2.5"><div className="flex min-w-0 items-center gap-2 text-[10px] text-slate-500"><span className="size-1.5 shrink-0 rounded-full bg-[#83f0ce]" /> <span className="truncate">{message}</span></div><span className="shrink-0 text-[10px] text-slate-600">{project?.apiVersion ?? "SDK"} </span></div>
        </section>

        <section className="flex min-h-[520px] flex-col bg-[#0b1118] lg:min-h-0">
          <div className="flex items-center justify-between border-b border-white/10 px-4 py-3"><div className="text-xs font-semibold">Workspace</div><div className="flex gap-1">{(["code", "objects", "console"] as const).map((name) => <button key={name} onClick={() => setTab(name)} className={`rounded-md px-2.5 py-1.5 text-[10px] capitalize ${tab === name ? "bg-white/10 text-white" : "text-slate-500 hover:text-slate-300"}`}>{name}</button>)}</div></div>
          {tab === "code" && <><div className="flex items-center justify-between px-4 py-3"><div><div className="text-xs font-semibold">main.mvm.js</div><div className="mt-1 text-[10px] text-slate-500">Restricted SDK · no arbitrary network access</div></div><button onClick={() => void runCode()} disabled={!project || running || busy} className="inline-flex items-center gap-2 rounded-lg bg-[#83f0ce] px-3 py-2 text-xs font-semibold text-[#071511] disabled:opacity-50"><Play size={13} /> {running ? "Running…" : "Run code"}</button></div><textarea value={code} onChange={(event) => setCode(event.target.value)} spellCheck={false} aria-label="MVM SDK JavaScript editor" className="min-h-[350px] flex-1 resize-y border-y border-white/[.08] bg-[#080d12] p-4 font-mono text-[12px] leading-6 text-[#d4e0e8] outline-none focus:border-[#83f0ce]/30" placeholder="// Write MVM SDK code here…" /><div className="px-4 py-3 text-[10px] leading-5 text-slate-600">Tip: choose a starter, edit the code, then press Run code. Script-created objects are rebuilt on each run; editor lights remain.</div></>}
          {tab === "objects" && <div className="flex-1 space-y-2 overflow-auto p-4">{project?.objects.map((node) => <button key={node.id} onClick={() => setSelected(node.id)} className={`block w-full rounded-lg border p-3 text-left ${selected === node.id ? "border-[#83f0ce]/40 bg-[#83f0ce]/[.06]" : "border-white/[.08] bg-white/[.02]"}`}><div className="text-xs font-semibold">{node.name}</div><div className="mt-1 text-[10px] text-slate-500">{node.type} · {node.source} · {node.visible ? "visible" : "hidden"}</div>{node.position && <div className="mt-2 font-mono text-[10px] text-slate-500">pos [{node.position.map((n) => n.toFixed(2)).join(", ")}]</div>}</button>)}</div>}
          {tab === "console" && <div className="flex-1 overflow-auto p-4 font-mono text-[11px] leading-5">{logs.length ? logs.map((line, index) => <div key={index} className="border-b border-white/[.05] py-2 text-slate-400"><span className="mr-2 text-[#83f0ce]">›</span>{line}</div>) : <div className="text-slate-600">No logs yet. Run the current script to see SDK output.</div>}<div className="mt-4 flex items-center gap-2 text-[10px] text-slate-600"><Check size={12} /> Logs from the most recent run</div></div>}
        </section>
      </div>
      <footer className="flex flex-wrap items-center justify-between gap-2 border-t border-white/10 bg-[#080d12] px-4 py-3 text-[10px] text-slate-600"><span>MvMSOLO · MVM 3D Forge · Developer preview</span><span>Project save = JSON · Asset export = binary glTF 2.0</span></footer>
    </main>
  );
}
