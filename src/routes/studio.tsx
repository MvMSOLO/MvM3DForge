import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { GLTFExporter } from "three/addons/exporters/GLTFExporter.js";
import { importGlbFile } from "@/forge/import-glb.ts";
import {
  ArrowLeft,
  Activity,
  Box,
  Check,
  CircleAlert,
  Copy,
  Download,
  FileUp,
  Layers3,
  Pause,
  Play,
  RotateCcw,
  Save,
  Sparkles,
  Terminal,
  Command as CmdIcon,
  Undo2,
  Redo2,
} from "lucide-react";
import { migrateProject, packageProject } from "@/forge/project.ts";
import { starters } from "@/forge/examples.ts";
import { animationClips, assembleScene } from "@/forge/scene-three.ts";
import { useStudioStore, useHistoryStore } from "@/forge/store";
import { PropertyInspector } from "@/components/PropertyInspector";
import { CommandPalette } from "@/components/CommandPalette";
import { McpApiKeysPanel } from "@/components/McpApiKeysPanel";
import { CloudProjectsPanel } from "@/components/CloudProjectsPanel";
import type { Project } from "@/forge/types.ts";

export const Route = createFileRoute("/studio")({ component: Studio });

const AI_CONTEXT_PROMPT = `You are helping me build a real 3D scene in MvM 3D Forge (MVM 3D FORGE), a browser-based TypeScript/React + Three.js scene authoring studio.

HOW TO WRITE CODE:
- The code editor executes JavaScript, not TypeScript. Do not use type annotations, import statements, Node APIs, arbitrary network requests, or external package installs inside the script.
- The runtime provides mvm (the Forge SDK), THREE (the installed Three.js namespace), scene (a real THREE.Scene), and console methods that appear in the Studio Console.
- Preferred native SDK workflow: create objects with mvm.geometry.*, assign mvm.material.pbr(...), set position/rotation/scale, then call mvm.scene.add(...).
- Material declarations alone do NOT create visible geometry. Include the geometry, material assignment, transforms, and scene.add/mvm.scene.add calls in the same complete script.
- Animation: create clips with mvm.animation.clip({ name, duration, loop }), tracks with mvm.animation.track(clip, { object, property, interpolation, keys }), then call mvm.animation.play(clipNameOrId).
- Console: use console.log/info/debug/warn/error or mvm.console.log/warn/error. Runtime and renderer failures are also surfaced in the Studio Console.
- Export: the Studio can export a GLB. Check warnings and unsupported conversion details before promising perfect round-trip fidelity.`;

const integrationGroups = [
  {
    title: "Scene & Geometry",
    items: [
      ["Three.js runtime", "LIVE", "Runs scripts with THREE and a real scene."],
      ["Geometry / Mesh / Scene", "LIVE", "Primitive and custom mesh nodes with scene hierarchy."],
      ["Vertices / Faces / Normals / UV mapping", "LIVE", "Custom buffers support positions, indices, normals and UVs."],
      ["Edges / Polygon", "PARTIAL", "Represent with indexed custom geometry; no dedicated edge editor yet."],
      ["Vector3 / Matrix4 / Quaternion", "LIVE", "Three.js math types are available in scripts."],
      ["Spline / Bezier / Extrude / Lathe", "PARTIAL", "Can be authored with raw Three.js; editable conversion depends on resulting geometry."],
      ["NURBS / Boolean operations", "ROADMAP", "No dedicated robust modeling tool yet."],
      ["Low-poly / High-poly", "PARTIAL", "Possible with segment and custom-geometry choices; budget limits apply."],
      ["Retopology / Decimator", "ROADMAP", "No automatic retopology or mesh-reduction pipeline."],
      ["Voxel / Point cloud", "ROADMAP", "No dedicated voxel or point-cloud editor yet."],
    ],
  },
  {
    title: "Materials & Rendering",
    items: [
      ["PBR / Roughness / Metalness", "LIVE", "Editable PBR material values."],
      ["Texture / Normal / Roughness / Metalness maps", "PARTIAL", "Procedural textures are supported; external map fidelity is limited by conversion."],
      ["Shading / Wireframe / Normals", "PARTIAL", "Viewport modes and custom normals; advanced debug overlays are limited."],
      ["Camera / Perspective / Orthographic", "PARTIAL", "Orbit viewport uses perspective; project camera schema supports both types."],
      ["Lights / Shadows / Ambient occlusion", "PARTIAL", "Multiple light types and shadows; no dedicated AO bake pipeline."],
      ["Renderer / WebGL", "LIVE", "Three.js WebGL renderer drives the viewport."],
      ["WebGPU / GLSL / Shader editor", "ROADMAP", "Not yet a first-class editor or guaranteed runtime path."],
      ["Bloom / Post-processing / Fog", "ROADMAP", "No full post-processing stack in the Studio viewport yet."],
      ["Instancing / LOD / Frustum culling", "ROADMAP", "No dedicated scene optimization manager yet."],
      ["Baking / Environment maps", "ROADMAP", "No integrated texture or lighting bake workflow yet."],
    ],
  },
  {
    title: "Animation & Simulation",
    items: [
      ["Keyframes / Animation clips", "LIVE", "Position, rotation, scale and quaternion tracks."],
      ["Bones / Rigging / Skinning", "PARTIAL", "Animation data model exists; full skinned mesh round-trip is not guaranteed."],
      ["Animation playback", "LIVE", "Viewport mixer playback with play/pause and loop support."],
      ["Particle system", "PARTIAL", "Can be prototyped with meshes; no dedicated particle editor."],
      ["Physics / Collision detection", "ROADMAP", "No integrated physics simulation engine yet."],
      ["Raycasting / Picking", "PARTIAL", "Viewport object selection exists; no public raycasting tool API yet."],
      ["Frustum culling", "ROADMAP", "Left to Three.js defaults; no Forge-level controls."],
      ["GLB export", "LIVE", "Binary glTF export with validation; unsupported data may be downgraded."],
    ],
  },
];

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
  const glbFileRef = useRef<HTMLInputElement>(null);

  const {
    project,
    code,
    selectedObjectId,
    activeClipId,
    isPlaying,
    busy,
    running,
    message,
    logs,
    viewMode,
    activeTab,
    isCommandPaletteOpen,
    setProject,
    setCode,
    setSelectedObjectId,
    setActiveClipId,
    setIsPlaying,
    setBusy,
    setMessage,
    addLog,
    setLogs,
    setViewMode,
    setActiveTab,
    setIsCommandPaletteOpen,
    runCode,
    loadStarter,
  } = useStudioStore();

  const { undo, redo, canUndo, canRedo } = useHistoryStore();

  const [copied, setCopied] = useState(false);
  const mixerRef = useRef<THREE.AnimationMixer | null>(null);
  const actionsRef = useRef<Map<string, THREE.AnimationAction>>(new Map());
  const syncedClipRef = useRef<string | null>(null);
  const syncPlaybackRef = useRef<() => void>(() => {});

  useEffect(() => {
    void loadStarter("primitives");
  }, []);

  // Global Keyboard Shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setIsCommandPaletteOpen(!isCommandPaletteOpen);
      }
      if ((e.metaKey || e.ctrlKey) && e.key === "z" && !e.shiftKey) {
        if (canUndo) {
          e.preventDefault();
          undo();
        }
      }
      if (((e.metaKey || e.ctrlKey) && e.key === "y") || ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === "z")) {
        if (canRedo) {
          e.preventDefault();
          redo();
        }
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isCommandPaletteOpen, canUndo, canRedo, undo, redo, setIsCommandPaletteOpen]);

  useEffect(() => {
    const onError = (event: ErrorEvent) => {
      const detail = event.message || "Uncaught browser runtime error.";
      // Chromium can emit this benign layout warning when a ResizeObserver
      // updates measurements during the same frame. It is not a scene failure
      // and must not steal focus from an API response or flood the console.
      if (/^ResizeObserver loop (completed with undelivered notifications|limit exceeded)\.?$/i.test(detail.trim())) {
        return;
      }
      addLog(`[ERROR] Runtime: ${detail}`);
      setMessage(detail);
      setActiveTab("console");
    };
    const onRejection = (event: PromiseRejectionEvent) => {
      const detail =
        event.reason instanceof Error
          ? event.reason.message
          : String(event.reason ?? "Unhandled promise rejection.");
      addLog(`[ERROR] Async runtime: ${detail}`);
      setMessage(detail);
      setActiveTab("console");
    };
    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onRejection);
    return () => {
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onRejection);
    };
  }, []);

  useEffect(() => {
    syncPlaybackRef.current = () => {
      if (!activeClipId) {
        for (const action of actionsRef.current.values()) action.stop();
        syncedClipRef.current = null;
        return;
      }
      for (const [id, action] of actionsRef.current) {
        if (id !== activeClipId) action.stop();
      }
      const action = actionsRef.current.get(activeClipId);
      if (!action) return;
      if (syncedClipRef.current !== activeClipId) {
        action.reset();
        action.play();
        syncedClipRef.current = activeClipId;
      } else if (isPlaying) {
        action.play();
      }
      action.paused = !isPlaying;
    };
    syncPlaybackRef.current();
  }, [activeClipId, isPlaying, project?.id, project?.clips.length]);

  async function copyText(text: string, success: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setMessage(success);
      window.setTimeout(() => setCopied(false), 1400);
    } catch {
      addLog("[ERROR] Clipboard access was blocked by the browser. Select and copy the text manually.");
      setMessage("Clipboard access blocked");
      setActiveTab("console");
    }
  }

  async function copyLogs() {
    await copyText(logs.length ? logs.join("\n") : "No console output yet.", "Console copied to clipboard");
  }

  async function copyAIContext() {
    await copyText(AI_CONTEXT_PROMPT, "Forge AI context copied — paste it into your AI assistant");
  }

  function openCloudProject(cloudProject: Project) {
    useHistoryStore.getState().clearHistory();
    setProject(cloudProject);
    setCode(cloudProject.code || "");
    setSelectedObjectId(null);
    setActiveClipId(cloudProject.autoplayClipId ?? cloudProject.clips[0]?.id ?? null);
    setIsPlaying(false);
    setMessage(`Cloud project “${cloudProject.name}” loaded`);
    setLogs([]);
  }

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
    let mixer: THREE.AnimationMixer | undefined;
    let clock: THREE.Clock | undefined;

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
      mixer = new THREE.AnimationMixer(renderScene);
      actionsRef.current.clear();
      syncedClipRef.current = null;
      for (const clip of animationClips(project, built.byId)) {
        const sourceClip = project.clips.find((item) => item.name === clip.name);
        const action = mixer.clipAction(clip);
        action.setLoop(
          sourceClip?.loop === false ? THREE.LoopOnce : THREE.LoopRepeat,
          sourceClip?.loop === false ? 1 : Infinity
        );
        action.clampWhenFinished = true;
        actionsRef.current.set(sourceClip?.id ?? clip.name, action);
      }
      mixerRef.current = mixer;
      syncPlaybackRef.current();
      clock = new THREE.Clock();
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
        if (mixer && clock) mixer.update(clock.getDelta());
        renderer.render(renderScene, camera);
        frame = requestAnimationFrame(tick);
      };
      tick();
    })().catch((error: unknown) => {
      if (!disposed) {
        const detail = error instanceof Error ? error.message : "Could not render this scene.";
        addLog(`[ERROR] Renderer: ${detail}`);
        setMessage(detail);
        setActiveTab("console");
      }
    });

    return () => {
      disposed = true;
      cancelAnimationFrame(frame);
      resizeObserver?.disconnect();
      controls?.dispose();
      renderer?.dispose();
      renderer?.domElement.remove();
      if (mixerRef.current === mixer) mixerRef.current = null;
      actionsRef.current.clear();
      renderScene?.traverse((object) => {
        if (object instanceof THREE.Mesh) {
          object.geometry.dispose();
          const materials = Array.isArray(object.material) ? object.material : [object.material];
          materials.forEach((material) => material.dispose());
        }
      });
    };
  }, [project, viewMode]);

  function saveProject() {
    if (!project) return;
    downloadBlob(
      new Blob([packageProject({ ...project, code, updatedAt: Date.now() })], { type: "application/json" }),
      `${project.name.replace(/[^a-z0-9-_]+/gi, "-").toLowerCase() || "mvm-project"}.mvm.json`
    );
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
      const output = await new Promise<ArrayBuffer>((resolve, reject) => {
        exporter.parse(
          built.scene,
          (result) => {
            if (result instanceof ArrayBuffer) resolve(result);
            else reject(new Error("Exporter did not return ArrayBuffer."));
          },
          (err) => reject(err),
          { binary: true, embedImages: true, animations: animationClips(project, built.byId) }
        );
      });

      downloadBlob(
        new Blob([output], { type: "model/gltf-binary" }),
        `${project.name.replace(/[^a-z0-9-_]+/gi, "-").toLowerCase() || "mvm-scene"}.glb`
      );
      setMessage(`GLB exported · ${(output.byteLength / 1024).toFixed(1)} KB · glTF 2.0 header verified`);
      built.scene.traverse((object) => {
        if (object instanceof THREE.Mesh) {
          object.geometry.dispose();
          const materials = Array.isArray(object.material) ? object.material : [object.material];
          materials.forEach((material) => material.dispose());
        }
      });
    } catch (error) {
      const detail = error instanceof Error ? error.message : "GLB export failed.";
      addLog(`[ERROR] GLB export: ${detail}`);
      setActiveTab("console");
      setMessage(detail);
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
      setActiveClipId(next.autoplayClipId ?? next.clips[0]?.id ?? null);
      setIsPlaying(Boolean(next.autoplayClipId ?? next.clips[0]?.id));
      setMessage(`Opened project · ${next.name}`);
    } catch (error) {
      const detail = error instanceof Error ? error.message : "Could not open this project JSON.";
      addLog(`[ERROR] Project open: ${detail}`);
      setActiveTab("console");
      setMessage(detail);
    }
  }

  async function importGlb(file?: File) {
    if (!file || !project) return;
    setBusy(true);
    setMessage("Importing GLB · reading meshes, PBR values and embedded maps…");
    try {
      const before = { ...project, code, updatedAt: Date.now() };
      const result = await importGlbFile(file, before);
      useHistoryStore.getState().executeCommand({
        description: "Import GLB · " + file.name,
        undo: () => setProject(before),
        redo: () => setProject(result.project),
      });
      setActiveClipId(result.project.autoplayClipId ?? result.project.clips[0]?.id ?? null);
      setIsPlaying(Boolean(result.project.autoplayClipId ?? result.project.clips[0]?.id));
      const report = [
        "[GLB] Imported " + file.name,
        "[GLB] Meshes: " + result.meshesAdded + " · textures: " + result.texturesAdded + " · animations: " + result.animationsAdded,
        ...result.warnings.map((warning) => "[WARN] " + warning),
      ];
      setLogs(report);
      if (result.warnings.length) setActiveTab("console");
      setMessage("GLB imported · " + result.meshesAdded + " meshes · " + result.texturesAdded + " textures");
    } catch (error) {
      const detail = error instanceof Error ? error.message : "GLB import failed.";
      addLog("[ERROR] GLB import: " + detail);
      setActiveTab("console");
      setMessage(detail);
    } finally {
      setBusy(false);
    }
  }

  const meshes = project?.objects.filter((node) => node.type === "mesh") ?? [];

  return (
    <main className="forge-shell flex min-h-screen flex-col bg-[#080d12] text-[#e8f0f6] lg:h-dvh lg:min-h-0 lg:overflow-hidden">
      <CommandPalette isOpen={isCommandPaletteOpen} onClose={() => setIsCommandPaletteOpen(false)} />

      <header className="forge-topbar flex min-h-[64px] flex-wrap items-center justify-between gap-3 border-b border-white/10 bg-[#0d141c]/90 px-4 py-3 sm:px-6">
        <div className="flex items-center gap-3">
          <a
            href="/"
            aria-label="Back home"
            className="grid size-9 place-items-center rounded-lg border border-white/10 text-slate-300 transition hover:border-[#83f0ce]/40 hover:text-[#83f0ce]"
          >
            <ArrowLeft size={17} />
          </a>
          <span className="grid size-9 place-items-center rounded-lg border border-[#83f0ce]/30 bg-[#83f0ce]/10 text-[#83f0ce]">
            <Box size={19} />
          </span>
          <div>
            <div className="text-xs font-bold tracking-[.16em]">
              MVM <span className="text-[#83f0ce]">3D</span> FORGE
            </div>
            <div className="mt-1 text-[10px] uppercase tracking-[.16em] text-slate-500">
              Studio / Professional 3D Platform
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Undo / Redo */}
          <button
            onClick={undo}
            disabled={!canUndo}
            title="Undo (Ctrl+Z)"
            className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 px-2.5 py-2 text-xs text-slate-300 hover:border-white/25 disabled:opacity-30 cursor-pointer"
          >
            <Undo2 size={14} /> Undo
          </button>
          <button
            onClick={redo}
            disabled={!canRedo}
            title="Redo (Ctrl+Y)"
            className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 px-2.5 py-2 text-xs text-slate-300 hover:border-white/25 disabled:opacity-30 cursor-pointer"
          >
            <Redo2 size={14} /> Redo
          </button>

          {/* Command Palette Trigger */}
          <button
            onClick={() => setIsCommandPaletteOpen(true)}
            className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 px-2.5 py-2 text-xs text-slate-300 hover:border-white/25 cursor-pointer"
          >
            <CmdIcon size={14} /> <span className="hidden sm:inline">Commands</span> (Cmd+K)
          </button>

          <button
            onClick={() => glbFileRef.current?.click()}
            disabled={!project || busy}
            className="inline-flex items-center gap-2 rounded-lg border border-[#83f0ce]/25 px-3 py-2 text-xs text-[#83f0ce] hover:border-[#83f0ce]/60 disabled:opacity-40 cursor-pointer"
            title="Import a binary GLB model with supported embedded textures and materials"
          >
            <Box size={14} /> Import GLB
          </button>
          <input
            ref={glbFileRef}
            type="file"
            accept=".glb,model/gltf-binary"
            className="hidden"
            onChange={(event) => {
              void importGlb(event.target.files?.[0]);
              event.currentTarget.value = "";
            }}
          />
          <button
            onClick={() => fileRef.current?.click()}
            className="inline-flex items-center gap-2 rounded-lg border border-white/10 px-3 py-2 text-xs text-slate-300 hover:border-white/25 cursor-pointer"
          >
            <FileUp size={14} /> Open
          </button>
          <input
            ref={fileRef}
            type="file"
            accept=".json,.mvm.json,application/json"
            className="hidden"
            onChange={(event) => {
              void openProject(event.target.files?.[0]);
              event.currentTarget.value = "";
            }}
          />
          <button
            onClick={() => void copyAIContext()}
            className="forge-action inline-flex items-center gap-2 rounded-lg border border-[#83f0ce]/25 px-3 py-2 text-xs text-[#83f0ce] hover:border-[#83f0ce]/60 cursor-pointer"
          >
            {copied ? <Check size={14} /> : <Sparkles size={14} />}{" "}
            {copied ? "Copied" : "AI context"}
          </button>
          <button
            onClick={saveProject}
            disabled={!project}
            className="forge-action inline-flex items-center gap-2 rounded-lg border border-white/10 px-3 py-2 text-xs text-slate-300 hover:border-white/25 disabled:opacity-40 cursor-pointer"
          >
            <Save size={14} /> Save project
          </button>
          <button
            onClick={() => void exportGlb()}
            disabled={!project || busy}
            className="inline-flex items-center gap-2 rounded-lg bg-[#83f0ce] px-3 py-2 text-xs font-semibold text-[#071511] hover:bg-[#a1f7dc] disabled:opacity-50 cursor-pointer"
          >
            <Download size={14} /> Export GLB
          </button>
        </div>
      </header>

      <div className="forge-workspace grid min-h-0 flex-1 grid-cols-1 lg:grid-rows-[minmax(0,1fr)] lg:grid-cols-[220px_minmax(0,1fr)_minmax(320px,38%)] lg:overflow-hidden">
        <aside className="min-h-0 border-b border-white/10 bg-[#0c1219] p-4 lg:overflow-auto lg:border-b-0 lg:border-r">
          <div className="mb-3 flex items-center justify-between">
            <span className="text-[10px] font-semibold uppercase tracking-[.18em] text-slate-500">
              Starters
            </span>
            <Sparkles size={14} className="text-[#83f0ce]" />
          </div>
          <div className="grid grid-cols-2 gap-2 lg:grid-cols-1">
            {starters
              .filter((item) => ["blank", "primitives", "pbr", "product", "animated"].includes(item.id))
              .map((item) => (
                <button
                  key={item.id}
                  onClick={() => void loadStarter(item.id)}
                  className="rounded-lg border border-white/[.09] bg-white/[.025] p-3 text-left transition hover:border-[#83f0ce]/40 hover:bg-[#83f0ce]/[.05] cursor-pointer"
                >
                  <div className="text-xs font-semibold">{item.title}</div>
                  <div className="mt-1 text-[10px] leading-4 text-slate-500">{item.summary}</div>
                </button>
              ))}
          </div>

          <div className="mt-6 text-[10px] font-semibold uppercase tracking-[.18em] text-slate-500">
            Scene objects <span className="ml-1 text-[#83f0ce]">{project?.objects.length ?? 0}</span>
          </div>
          <div className="mt-3 space-y-1">
            {project?.objects.map((node) => (
              <button
                key={node.id}
                onClick={() => setSelectedObjectId(node.id)}
                className={`w-full rounded-md px-2.5 py-2 text-left text-xs cursor-pointer ${
                  selectedObjectId === node.id
                    ? "bg-[#83f0ce]/10 text-[#83f0ce]"
                    : "text-slate-400 hover:bg-white/[.04]"
                }`}
              >
                <span className="mr-2 text-slate-600">{node.type === "mesh" ? "◇" : "◌"}</span>
                {node.name}
              </button>
            ))}
          </div>
        </aside>

        <section className="forge-viewport-panel flex min-h-[52vh] flex-col border-b border-white/10 lg:min-h-0 lg:overflow-hidden lg:border-b-0 lg:border-r">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/10 bg-[#0d141c] px-4 py-3">
            <div>
              <div className="text-xs font-semibold">3D Viewport</div>
              <div className="mt-1 text-[10px] text-slate-500">
                Drag to orbit · pinch/scroll to zoom · right-drag to pan
              </div>
            </div>
            <div className="flex rounded-lg border border-white/10 p-1">
              {(["material", "solid", "wireframe"] as const).map((mode) => (
                <button
                  key={mode}
                  onClick={() => setViewMode(mode)}
                  className={`rounded-md px-2 py-1.5 text-[10px] capitalize cursor-pointer ${
                    viewMode === mode
                      ? "bg-[#83f0ce]/15 text-[#83f0ce]"
                      : "text-slate-500 hover:text-slate-200"
                  }`}
                >
                  {mode}
                </button>
              ))}
            </div>
          </div>

          <div className="relative min-h-[42vh] flex-1 bg-[#10161e] lg:min-h-0" ref={viewportRef}>
            {!project && (
              <div className="absolute inset-0 grid place-items-center text-sm text-slate-500">
                {busy ? "Starting renderer…" : "Load a starter scene to begin."}
              </div>
            )}
            <div className="pointer-events-none absolute bottom-3 left-3 rounded-md border border-white/10 bg-[#080d12]/75 px-3 py-2 text-[10px] text-slate-400">
              <span className="text-[#83f0ce]">●</span> {meshes.length} mesh objects · Y-up · metres
            </div>
          </div>

          {project && project.clips.length > 0 && (
            <div className="forge-timeline flex flex-wrap items-center gap-2 border-t border-white/[.08] bg-[#0b1219] px-3 py-2.5">
              <button
                aria-label={isPlaying ? "Pause animation" : "Play animation"}
                onClick={() => setIsPlaying(!isPlaying)}
                className="grid size-8 shrink-0 place-items-center rounded-lg bg-[#83f0ce] text-[#071511] transition hover:scale-105 cursor-pointer"
              >
                {isPlaying ? <Pause size={14} /> : <Play size={14} />}
              </button>
              <button
                aria-label="Restart animation"
                onClick={() => {
                  setIsPlaying(false);
                  window.requestAnimationFrame(() => setIsPlaying(true));
                }}
                className="grid size-8 shrink-0 place-items-center rounded-lg border border-white/10 text-slate-300 transition hover:border-[#83f0ce]/40 hover:text-[#83f0ce] cursor-pointer"
              >
                <RotateCcw size={13} />
              </button>
              <div className="min-w-0 flex-1">
                <div className="mb-1 text-[9px] uppercase tracking-[.14em] text-slate-600">
                  Animation timeline
                </div>
                <div className="flex flex-wrap gap-1">
                  {project.clips.map((clip) => (
                    <button
                      key={clip.id}
                      onClick={() => {
                        setActiveClipId(clip.id);
                        setIsPlaying(true);
                      }}
                      className={`rounded-md border px-2 py-1 text-[10px] transition cursor-pointer ${
                        activeClipId === clip.id
                          ? "border-[#83f0ce]/35 bg-[#83f0ce]/10 text-[#83f0ce]"
                          : "border-white/[.08] text-slate-500 hover:text-slate-200"
                      }`}
                    >
                      {clip.name}
                    </button>
                  ))}
                </div>
              </div>
              <span className="shrink-0 text-[9px] text-slate-600">
                {isPlaying ? "PLAYING" : "PAUSED"}
              </span>
            </div>
          )}

          <div className="flex items-center justify-between gap-3 border-t border-white/10 bg-[#0d141c] px-4 py-2.5">
            <div className="flex min-w-0 items-center gap-2 text-[10px] text-slate-500">
              <span className="size-1.5 shrink-0 rounded-full bg-[#83f0ce]" />
              <span className="truncate">{message}</span>
            </div>
            <span className="shrink-0 text-[10px] text-slate-600">
              {project?.apiVersion ?? "SDK"}
            </span>
          </div>
        </section>

        <section className="forge-workbench flex min-h-[520px] min-w-0 flex-col bg-[#0b1118] lg:min-h-0 lg:overflow-hidden">
          <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
            <div className="text-xs font-semibold">Workspace</div>
            <div className="flex gap-1">
              {(["code", "inspector", "objects", "console", "integrations"] as const).map((name) => (
                <button
                  key={name}
                  onClick={() => setActiveTab(name as any)}
                  className={`forge-tab rounded-md px-2.5 py-1.5 text-[10px] capitalize cursor-pointer ${
                    activeTab === (name as any)
                      ? "bg-white/10 text-white font-semibold"
                      : "text-slate-500 hover:text-slate-300"
                  }`}
                >
                  {name === "integrations" ? "3D stack" : name}
                </button>
              ))}
            </div>
          </div>

          {activeTab === "code" && (
            <div className="forge-code-panel flex min-h-[460px] min-w-0 flex-1 flex-col overflow-hidden lg:min-h-0">
              <div className="flex items-center justify-between px-4 py-3">
                <div>
                  <div className="text-xs font-semibold">main.mvm.js</div>
                  <div className="mt-1 text-[10px] text-slate-500">
                    Restricted SDK · no arbitrary network access
                  </div>
                </div>
                <button
                  onClick={() => void runCode()}
                  disabled={!project || running || busy}
                  className="inline-flex items-center gap-2 rounded-lg bg-[#83f0ce] px-3 py-2 text-xs font-semibold text-[#071511] disabled:opacity-50 cursor-pointer"
                >
                  <Play size={13} /> {running ? "Running…" : "Run code"}
                </button>
              </div>
              <textarea
                value={code}
                onChange={(event) => setCode(event.target.value)}
                spellCheck={false}
                aria-label="MVM SDK JavaScript editor"
                className="min-h-0 w-full flex-1 resize-none overflow-auto overscroll-contain border-y border-white/[.08] bg-[#080d12] p-4 font-mono text-[12px] leading-6 text-[#d4e0e8] outline-none focus:border-[#83f0ce]/30"
                placeholder="// Write MVM SDK code here…"
              />
              <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-[10px] leading-5 text-slate-500">
                <span>JavaScript · mvm SDK + Three.js bridge · mobile-aware budgets</span>
                <button
                  onClick={() => void copyAIContext()}
                  className="inline-flex items-center gap-1.5 text-[#83f0ce] hover:text-white cursor-pointer"
                >
                  <Copy size={12} /> Copy AI context
                </button>
              </div>
            </div>
          )}

          {activeTab === "inspector" && <PropertyInspector />}

          {activeTab === "objects" && (
            <div className="flex-1 space-y-2 overflow-auto p-4">
              {project?.objects.map((node) => (
                <button
                  key={node.id}
                  onClick={() => {
                    setSelectedObjectId(node.id);
                    setActiveTab("inspector");
                  }}
                  className={`block w-full rounded-lg border p-3 text-left cursor-pointer ${
                    selectedObjectId === node.id
                      ? "border-[#83f0ce]/40 bg-[#83f0ce]/[.06]"
                      : "border-white/[.08] bg-white/[.02]"
                  }`}
                >
                  <div className="text-xs font-semibold">{node.name}</div>
                  <div className="mt-1 text-[10px] text-slate-500">
                    {node.type} · {node.source} · {node.visible ? "visible" : "hidden"}
                  </div>
                  {node.position && (
                    <div className="mt-2 font-mono text-[10px] text-slate-500">
                      pos [{node.position.map((n) => n.toFixed(2)).join(", ")}]
                    </div>
                  )}
                </button>
              ))}
            </div>
          )}

          {activeTab === "console" && (
            <div className="forge-console flex-1 overflow-auto p-4 font-mono text-[11px] leading-5">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2 border-b border-white/[.08] pb-3">
                <div className="flex items-center gap-2 text-xs font-semibold">
                  <Terminal size={14} className="text-[#83f0ce]" /> Runtime Console{" "}
                  <span className="text-[10px] font-normal text-slate-500">{logs.length} entries</span>
                </div>
                <button
                  onClick={() => void copyLogs()}
                  className="inline-flex items-center gap-1.5 rounded-md border border-white/10 px-2.5 py-1.5 text-[10px] text-slate-300 hover:border-[#83f0ce]/40 hover:text-[#83f0ce] cursor-pointer"
                >
                  <Copy size={12} /> Copy all
                </button>
              </div>
              {logs.length ? (
                logs.map((line, index) => {
                  const isError =
                    /^\[(ERROR|MVM_E_|Studio|Renderer|Export|Worker)/i.test(line) ||
                    /uncaught|failed|exception/i.test(line);
                  const isWarn = /^\[WARN\]/i.test(line);
                  return (
                    <div
                      key={index}
                      className={`forge-log-row border-b border-white/[.05] py-2 ${
                        isError ? "forge-log-error" : isWarn ? "forge-log-warn" : "text-slate-400"
                      }`}
                    >
                      <span className="mr-2 opacity-80">
                        {isError ? <CircleAlert size={12} className="inline" /> : isWarn ? "!" : "›"}
                      </span>
                      {line}
                      <button
                        aria-label="Copy this log line"
                        title="Copy log line"
                        onClick={() => void copyText(line, "Log line copied")}
                        className="ml-2 inline-flex align-middle text-slate-600 hover:text-[#83f0ce] cursor-pointer"
                      >
                        <Copy size={11} />
                      </button>
                    </div>
                  );
                })
              ) : (
                <div className="rounded-xl border border-dashed border-white/10 p-6 text-center">
                  <Terminal size={22} className="mx-auto mb-2 text-slate-600" />
                  <div className="text-slate-400">Console tayyor</div>
                  <div className="mt-1 text-[10px] text-slate-600">
                    Run code yoki renderer xatosi bo‘lsa, natija shu yerda chiqadi.
                  </div>
                </div>
              )}
              <div className="mt-4 flex items-center gap-2 text-[10px] text-slate-600">
                <Check size={12} /> Latest run + runtime diagnostics
              </div>
            </div>
          )}

          {activeTab === "integrations" && (
            <div className="forge-integrations flex-1 overflow-auto p-4">
              <McpApiKeysPanel />
              <CloudProjectsPanel
                project={project}
                code={code}
                onOpen={openCloudProject}
                onStatus={setMessage}
              />
              <div className="mb-4 rounded-xl border border-[#83f0ce]/20 bg-[#83f0ce]/[.045] p-4">
                <div className="flex items-center gap-2 text-sm font-semibold">
                  <Layers3 size={16} className="text-[#83f0ce]" /> Forge capability map
                </div>
                <p className="mt-2 text-[11px] leading-5 text-slate-400">
                  Real support status — LIVE = implemented, PARTIAL = available with limits, ROADMAP = roadmap item.
                </p>
                <button
                  onClick={() => void copyAIContext()}
                  className="mt-3 inline-flex items-center gap-2 rounded-lg bg-[#83f0ce] px-3 py-2 text-[11px] font-semibold text-[#071511] cursor-pointer"
                >
                  <Copy size={13} /> Copy full context for AI
                </button>
              </div>
              {integrationGroups.map((group) => (
                <div key={group.title} className="mb-5">
                  <div className="mb-2 flex items-center gap-2 text-[10px] font-bold uppercase tracking-[.16em] text-slate-500">
                    <Activity size={13} /> {group.title}
                  </div>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {group.items.map(([name, status, detail]) => (
                      <div
                        key={name}
                        className="forge-integration-card rounded-lg border border-white/[.08] bg-white/[.025] p-3"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="text-[11px] font-semibold text-slate-200">{name}</div>
                          <span
                            className={`forge-status shrink-0 ${
                              status === "LIVE"
                                ? "forge-status-live"
                                : status === "PARTIAL"
                                ? "forge-status-partial"
                                : "forge-status-roadmap"
                            }`}
                          >
                            {status}
                          </span>
                        </div>
                        <p className="mt-2 text-[10px] leading-4 text-slate-500">{detail}</p>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>

      <footer className="forge-footer flex flex-wrap items-center justify-between gap-2 border-t border-white/10 bg-[#080d12] px-4 py-3 text-[10px] text-slate-600">
        <span>MvMSOLO · MVM 3D Forge · Professional 3D Platform</span>
        <span>Project save = JSON · Asset export = binary glTF 2.0</span>
      </footer>
    </main>
  );
}
