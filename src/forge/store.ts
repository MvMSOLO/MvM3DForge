import { create } from "zustand";
import { devtools } from "zustand/middleware";
import type { Project, SceneNode, MaterialSpec, AnimClip } from "@/forge/types.ts";
import { type StarterId } from "@/forge/examples.ts";
import { createStarterProject, applyScriptPatch } from "@/forge/project.ts";
import { executeUserCode } from "@/forge/sdk/execute.ts";

export interface Command {
  id: string;
  description: string;
  timestamp: number;
  undo: () => void;
  redo: () => void;
}

export interface HistoryState {
  past: Command[];
  future: Command[];
  canUndo: boolean;
  canRedo: boolean;
  executeCommand: (command: Omit<Command, "id" | "timestamp">) => void;
  undo: () => void;
  redo: () => void;
  clearHistory: () => void;
}

export interface StudioState {
  // Project state
  project: Project | null;
  code: string;
  selectedObjectId: string | null;
  activeClipId: string | null;
  isPlaying: boolean;
  busy: boolean;
  running: boolean;
  message: string;
  logs: string[];
  viewMode: "material" | "solid" | "wireframe";
  activeTab: "code" | "objects" | "materials" | "console" | "ai" | "mcp" | "timeline" | "integrations";

  // Navigation / Camera mode
  cameraMode: "perspective" | "orthographic";
  transformMode: "translate" | "rotate" | "scale";
  transformSpace: "local" | "world";
  gridVisible: boolean;

  // Actions
  setProject: (project: Project) => void;
  setCode: (code: string) => void;
  setSelectedObjectId: (id: string | null) => void;
  setActiveClipId: (id: string | null) => void;
  setIsPlaying: (playing: boolean) => void;
  setBusy: (busy: boolean) => void;
  setRunning: (running: boolean) => void;
  setMessage: (msg: string) => void;
  addLog: (log: string) => void;
  setLogs: (logs: string[]) => void;
  clearLogs: () => void;
  setViewMode: (mode: "material" | "solid" | "wireframe") => void;
  setActiveTab: (tab: StudioState["activeTab"]) => void;
  setCameraMode: (mode: "perspective" | "orthographic") => void;
  setTransformMode: (mode: "translate" | "rotate" | "scale") => void;
  setTransformSpace: (space: "local" | "world") => void;
  setGridVisible: (visible: boolean) => void;

  // Scene Mutation Actions
  updateNodeTransform: (id: string, position?: [number, number, number], rotation?: [number, number, number], scale?: [number, number, number]) => void;
  updateNodeProperties: (id: string, patch: Partial<SceneNode>) => void;
  addNode: (node: SceneNode) => void;
  removeNode: (id: string) => void;

  // Code Execution
  runCode: () => Promise<void>;
  loadStarter: (starterId: StarterId) => Promise<void>;
}

export const useStudioStore = create<StudioState>()(
  devtools((set, get) => ({
    project: null,
    code: "",
    selectedObjectId: null,
    activeClipId: null,
    isPlaying: false,
    busy: true,
    running: false,
    message: "Initializing Studio...",
    logs: [],
    viewMode: "material",
    activeTab: "code",
    cameraMode: "perspective",
    transformMode: "translate",
    transformSpace: "world",
    gridVisible: true,

    setProject: (project) => set({ project }),
    setCode: (code) => set({ code }),
    setSelectedObjectId: (selectedObjectId) => set({ selectedObjectId }),
    setActiveClipId: (activeClipId) => set({ activeClipId }),
    setIsPlaying: (isPlaying) => set({ isPlaying }),
    setBusy: (busy) => set({ busy }),
    setRunning: (running) => set({ running }),
    setMessage: (message) => set({ message }),
    addLog: (log) => set((state) => ({ logs: [...state.logs, log] })),
    setLogs: (logs) => set({ logs }),
    clearLogs: () => set({ logs: [] }),
    setViewMode: (viewMode) => set({ viewMode }),
    setActiveTab: (activeTab) => set({ activeTab }),
    setCameraMode: (cameraMode) => set({ cameraMode }),
    setTransformMode: (transformMode) => set({ transformMode }),
    setTransformSpace: (transformSpace) => set({ transformSpace }),
    setGridVisible: (gridVisible) => set({ gridVisible }),

    updateNodeTransform: (id, position, rotation, scale) => {
      const { project } = get();
      if (!project) return;
      const updatedObjects = project.objects.map((node) => {
        if (node.id !== id) return node;
        return {
          ...node,
          position: position ?? node.position,
          rotation: rotation ?? node.rotation,
          scale: scale ?? node.scale,
        };
      });
      set({ project: { ...project, objects: updatedObjects, updatedAt: Date.now() } });
    },

    updateNodeProperties: (id, patch) => {
      const { project } = get();
      if (!project) return;
      const updatedObjects = project.objects.map((node) => {
        if (node.id !== id) return node;
        return { ...node, ...patch };
      });
      set({ project: { ...project, objects: updatedObjects, updatedAt: Date.now() } });
    },

    addNode: (node) => {
      const { project } = get();
      if (!project) return;
      set({
        project: {
          ...project,
          objects: [...project.objects, node],
          updatedAt: Date.now(),
        },
        selectedObjectId: node.id,
      });
    },

    removeNode: (id) => {
      const { project } = get();
      if (!project) return;
      set({
        project: {
          ...project,
          objects: project.objects.filter((node) => node.id !== id),
          updatedAt: Date.now(),
        },
        selectedObjectId: get().selectedObjectId === id ? null : get().selectedObjectId,
      });
    },

    runCode: async () => {
      const { project, code, running } = get();
      if (!project || running) return;
      set({ running: true, message: "Executing script in restricted sandbox..." });

      try {
        const result = await executeUserCode(code);
        const formattedLogs = result.logs.map((entry) =>
          entry.level === "error"
            ? `[ERROR] ${entry.message}`
            : entry.level === "warn"
            ? `[WARN] ${entry.message}`
            : entry.message
        );

        if (!result.ok) {
          set({
            logs: [...formattedLogs, `[${result.error.code}] ${result.error.message}`],
            message: result.error.message,
            activeTab: "console",
          });
          return;
        }

        const noSceneOutput = result.patch.sceneMutation === "none" && result.patch.objects.length === 0;
        const nextProject = applyScriptPatch(project, result.patch);

        const currentClipExists = get().activeClipId && nextProject.clips.some((clip) => clip.id === get().activeClipId);
        const nextClipId = currentClipExists
          ? get().activeClipId
          : nextProject.autoplayClipId ?? nextProject.clips[0]?.id ?? null;

        if (noSceneOutput) {
          const note = project.objects.some((item) => item.type === "mesh")
            ? "No new scene objects were created. Scene preserved."
            : "No scene objects created by script.";
          set({
            project: nextProject,
            logs: [...formattedLogs, `[WARN] ${note}`],
            message: "Execution complete · No geometry created",
            activeTab: "console",
          });
          return;
        }

        set({
          project: nextProject,
          logs: formattedLogs,
          activeClipId: nextClipId,
          isPlaying: Boolean(nextClipId),
          message: `Run complete · ${nextProject.objects.filter((item) => item.type === "mesh").length} meshes`,
        });
      } catch (error) {
        const detail = error instanceof Error ? error.message : "Script execution failed.";
        set({
          logs: [`[ERROR] ${detail}`],
          message: detail,
          activeTab: "console",
        });
      } finally {
        set({ running: false });
      }
    },

    loadStarter: async (starterId) => {
      set({ busy: true, message: "Loading starter..." });
      try {
        const result = await createStarterProject(starterId);
        const logs = result.logs.map((e) =>
          e.level === "error" ? `[ERROR] ${e.message}` : e.level === "warn" ? `[WARN] ${e.message}` : e.message
        );
        const clipId = result.project.autoplayClipId ?? result.project.clips[0]?.id ?? null;
        set({
          project: result.project,
          code: result.project.code,
          logs,
          activeClipId: clipId,
          isPlaying: Boolean(clipId),
          selectedObjectId: null,
          message: `${result.project.name} loaded`,
        });
      } catch (error) {
        const detail = error instanceof Error ? error.message : "Starter load failed.";
        set({ logs: [`[ERROR] ${detail}`], message: detail, activeTab: "console" });
      } finally {
        set({ busy: false });
      }
    },
  }))
);

export const useHistoryStore = create<HistoryState>((set, get) => ({
  past: [],
  future: [],
  canUndo: false,
  canRedo: false,

  executeCommand: (cmdInit) => {
    const cmd: Command = {
      ...cmdInit,
      id: typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : String(Math.random()),
      timestamp: Date.now(),
    };
    cmd.redo();
    set((state) => {
      const past = [...state.past, cmd];
      return {
        past,
        future: [],
        canUndo: past.length > 0,
        canRedo: false,
      };
    });
  },

  undo: () => {
    const { past, future } = get();
    if (past.length === 0) return;
    const cmd = past[past.length - 1];
    cmd.undo();
    const newPast = past.slice(0, -1);
    const newFuture = [cmd, ...future];
    set({
      past: newPast,
      future: newFuture,
      canUndo: newPast.length > 0,
      canRedo: newFuture.length > 0,
    });
  },

  redo: () => {
    const { past, future } = get();
    if (future.length === 0) return;
    const cmd = future[0];
    cmd.redo();
    const newPast = [...past, cmd];
    const newFuture = future.slice(1);
    set({
      past: newPast,
      future: newFuture,
      canUndo: newPast.length > 0,
      canRedo: newFuture.length > 0,
    });
  },

  clearHistory: () => set({ past: [], future: [], canUndo: false, canRedo: false }),
}));
