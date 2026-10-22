import React, { useState } from "react";
import { Sparkles, Server, Shield, Check, AlertCircle, Copy, Play } from "lucide-react";
import { useStudioStore } from "@/forge/store";
import { DEFAULT_AI_PROVIDERS, buildMCPSceneResource, validateMCPToolExecution, type MCPConnectionConfig } from "@/forge/ai-mcp";

export function AIPanel() {
  const { project, runCode, setCode, addLog, setActiveTab } = useStudioStore();
  const [prompt, setPrompt] = useState("");
  const [selectedProvider, setSelectedProvider] = useState(DEFAULT_AI_PROVIDERS[0].id);
  const [apiKey, setApiKey] = useState("");
  const [mcpConnections, setMcpConnections] = useState<MCPConnectionConfig[]>([
    {
      id: "mvm-local-mcp",
      name: "MvM Local Bridge Server",
      transport: "http",
      url: "http://localhost:3001/mcp",
      status: "connected",
      permissions: { readScene: true, mutateScene: true, executeScript: false },
    },
  ]);

  const handleGenerateCode = () => {
    if (!prompt.trim()) return;
    const generatedScript = `// Generated for prompt: "${prompt}"\nconst mat = mvm.material.pbr({ color: "#83f0ce", roughness: 0.2, metalness: 0.8 });\nconst cube = mvm.geometry.box(1.5, 1.5, 1.5);\ncube.material = mat;\ncube.position.set(0, 0.75, 0);\nmvm.scene.add(cube);\nmvm.console.log("AI generated 3D cube placed in scene.");`;
    setCode(generatedScript);
    addLog(`[AI Workspace] Generated code for prompt: "${prompt}"`);
    setActiveTab("code");
  };

  const activeProvider = DEFAULT_AI_PROVIDERS.find((p) => p.id === selectedProvider);

  return (
    <div className="p-4 space-y-6 text-xs text-slate-300 overflow-y-auto max-h-[80vh]">
      {/* Provider Selector */}
      <div className="space-y-3 rounded-xl border border-white/10 bg-white/5 p-4">
        <div className="flex items-center gap-2 text-sm font-semibold text-white">
          <Sparkles size={16} className="text-[#83f0ce]" />
          AI Provider Architecture
        </div>
        <div>
          <label className="block text-[10px] text-slate-400 mb-1">Select Provider</label>
          <select
            value={selectedProvider}
            onChange={(e) => setSelectedProvider(e.target.value)}
            className="w-full bg-[#080d12] border border-white/10 rounded px-2.5 py-1.5 text-xs text-white outline-none focus:border-[#83f0ce]"
          >
            {DEFAULT_AI_PROVIDERS.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} ({p.model})
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-[10px] text-slate-400 mb-1">API Secret Key (Stored locally in session memory)</label>
          <input
            type="password"
            placeholder="sk-..."
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            className="w-full bg-[#080d12] border border-white/10 rounded px-2.5 py-1.5 text-xs text-white outline-none focus:border-[#83f0ce]"
          />
        </div>
      </div>

      {/* AI Prompt Creation Workspace */}
      <div className="space-y-3 rounded-xl border border-white/10 bg-white/5 p-4">
        <div className="text-xs font-semibold text-white">3D Generation Prompt</div>
        <textarea
          rows={3}
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="e.g., Create a sci-fi metallic pedestal with glowing blue PBR material..."
          className="w-full bg-[#080d12] border border-white/10 rounded p-2.5 text-xs text-white outline-none focus:border-[#83f0ce] resize-none"
        />
        <button
          onClick={handleGenerateCode}
          className="w-full flex items-center justify-center gap-2 rounded-lg bg-[#83f0ce] px-3 py-2 text-xs font-semibold text-[#071511] hover:bg-[#a1f7dc] transition"
        >
          <Sparkles size={14} /> Generate & Edit 3D Script
        </button>
      </div>

      {/* MCP Connection Manager */}
      <div className="space-y-3 rounded-xl border border-white/10 bg-white/5 p-4">
        <div className="flex items-center gap-2 text-xs font-semibold text-white">
          <Server size={15} className="text-[#83f0ce]" />
          Model Context Protocol (MCP) Connections
        </div>
        <p className="text-[11px] text-slate-400">
          Connect external AI agents (Claude Desktop, Cursor, Custom Agents) to MvM 3D Forge via MCP.
        </p>

        {mcpConnections.map((conn) => (
          <div key={conn.id} className="rounded-lg border border-white/10 bg-[#080d12] p-3 space-y-2">
            <div className="flex items-center justify-between">
              <span className="font-semibold text-white">{conn.name}</span>
              <span className="flex items-center gap-1 text-[10px] text-emerald-400 font-medium">
                <Check size={12} /> {conn.status}
              </span>
            </div>
            <div className="text-[10px] font-mono text-slate-500">{conn.url}</div>

            <div className="pt-2 border-t border-white/10 space-y-1">
              <div className="text-[10px] font-bold text-slate-400 uppercase">Permissions</div>
              <div className="grid grid-cols-3 gap-1 text-[10px]">
                <label className="flex items-center gap-1 text-slate-300">
                  <input
                    type="checkbox"
                    checked={conn.permissions.readScene}
                    onChange={(e) =>
                      setMcpConnections((prev) =>
                        prev.map((c) =>
                          c.id === conn.id
                            ? { ...c, permissions: { ...c.permissions, readScene: e.target.checked } }
                            : c
                        )
                      )
                    }
                    className="accent-[#83f0ce]"
                  />
                  Read Scene
                </label>
                <label className="flex items-center gap-1 text-slate-300">
                  <input
                    type="checkbox"
                    checked={conn.permissions.mutateScene}
                    onChange={(e) =>
                      setMcpConnections((prev) =>
                        prev.map((c) =>
                          c.id === conn.id
                            ? { ...c, permissions: { ...c.permissions, mutateScene: e.target.checked } }
                            : c
                        )
                      )
                    }
                    className="accent-[#83f0ce]"
                  />
                  Mutate Scene
                </label>
                <label className="flex items-center gap-1 text-slate-300">
                  <input
                    type="checkbox"
                    checked={conn.permissions.executeScript}
                    onChange={(e) =>
                      setMcpConnections((prev) =>
                        prev.map((c) =>
                          c.id === conn.id
                            ? { ...c, permissions: { ...c.permissions, executeScript: e.target.checked } }
                            : c
                        )
                      )
                    }
                    className="accent-[#83f0ce]"
                  />
                  Execute
                </label>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
