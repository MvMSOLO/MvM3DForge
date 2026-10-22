import React, { useState, useEffect } from "react";
import { Search, Box, Move, RotateCw, Maximize2, Sparkles, Layers, Terminal, Film, FileCode } from "lucide-react";
import { useStudioStore } from "@/forge/store";

export function CommandPalette({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  const [query, setQuery] = useState("");
  const { runCode, loadStarter, setViewMode, setCameraMode, setTransformMode, setActiveTab } = useStudioStore();

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        if (isOpen) onClose();
        else setQuery("");
      }
      if (e.key === "Escape" && isOpen) {
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const actions = [
    { id: "run-code", label: "Run Code", icon: FileCode, perform: () => void runCode() },
    { id: "mode-translate", label: "Move Tool (Translate)", icon: Move, perform: () => setTransformMode("translate") },
    { id: "mode-rotate", label: "Rotate Tool", icon: RotateCw, perform: () => setTransformMode("rotate") },
    { id: "mode-scale", label: "Scale Tool", icon: Maximize2, perform: () => setTransformMode("scale") },
    { id: "view-material", label: "Material View Mode", icon: Box, perform: () => setViewMode("material") },
    { id: "view-wireframe", label: "Wireframe View Mode", icon: Box, perform: () => setViewMode("wireframe") },
    { id: "cam-perspective", label: "Perspective Camera", icon: Box, perform: () => setCameraMode("perspective") },
    { id: "cam-ortho", label: "Orthographic Camera", icon: Box, perform: () => setCameraMode("orthographic") },
    { id: "tab-code", label: "Open Code Editor", icon: FileCode, perform: () => setActiveTab("code") },
    { id: "tab-console", label: "Open Console", icon: Terminal, perform: () => setActiveTab("console") },
    { id: "tab-objects", label: "Open Scene Hierarchy", icon: Layers, perform: () => setActiveTab("objects") },
    { id: "tab-timeline", label: "Open Animation Timeline", icon: Film, perform: () => setActiveTab("timeline") },
    { id: "starter-primitives", label: "Load Primitives Lab", icon: Sparkles, perform: () => void loadStarter("primitives") },
    { id: "starter-pbr", label: "Load PBR Material Studio", icon: Sparkles, perform: () => void loadStarter("pbr") },
    { id: "starter-animated", label: "Load Animated Scene", icon: Sparkles, perform: () => void loadStarter("animated") },
  ];

  const filtered = actions.filter((action) =>
    action.label.toLowerCase().includes(query.toLowerCase())
  );

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-20 bg-black/70 backdrop-blur-sm p-4">
      <div className="w-full max-w-lg rounded-xl border border-white/15 bg-[#0f1722] shadow-2xl overflow-hidden text-slate-200">
        <div className="flex items-center border-b border-white/10 px-4 py-3 gap-3">
          <Search size={18} className="text-slate-400 shrink-0" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Type a command or search actions... (Cmd+K)"
            autoFocus
            className="w-full bg-transparent text-sm outline-none text-white placeholder-slate-500"
          />
          <kbd className="rounded border border-white/10 bg-white/5 px-2 py-0.5 text-[10px] text-slate-400 font-mono">
            ESC
          </kbd>
        </div>
        <div className="max-h-80 overflow-y-auto p-2 space-y-1">
          {filtered.length > 0 ? (
            filtered.map((action) => {
              const Icon = action.icon;
              return (
                <button
                  key={action.id}
                  onClick={() => {
                    action.perform();
                    onClose();
                  }}
                  className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-xs font-medium text-slate-300 hover:bg-[#83f0ce]/15 hover:text-[#83f0ce] transition-colors text-left"
                >
                  <Icon size={16} className="shrink-0 opacity-80" />
                  <span>{action.label}</span>
                </button>
              );
            })
          ) : (
            <div className="p-4 text-center text-xs text-slate-500">
              No commands found matching "{query}"
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
