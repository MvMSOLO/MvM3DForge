import React from "react";
import { useStudioStore } from "@/forge/store";
import { Eye, EyeOff, Lock, Unlock, Trash2, Copy, Layers } from "lucide-react";

export function PropertyInspector() {
  const { project, selectedObjectId, updateNodeTransform, updateNodeProperties, removeNode, setSelectedObjectId } = useStudioStore();

  if (!project) return null;

  const node = project.objects.find((o) => o.id === selectedObjectId);

  if (!node) {
    return (
      <div className="p-4 text-center text-xs text-slate-500">
        <Layers size={28} className="mx-auto mb-2 opacity-30" />
        <p className="font-medium text-slate-400">No object selected</p>
        <p className="mt-1 text-[11px] text-slate-600">Select an object from the viewport or scene list to inspect and edit properties.</p>
      </div>
    );
  }

  const pos = node.position || [0, 0, 0];
  const rot = node.rotation || [0, 0, 0];
  const scale = node.scale || [1, 1, 1];

  const handlePosChange = (axis: 0 | 1 | 2, val: number) => {
    const nextPos: [number, number, number] = [...pos];
    nextPos[axis] = Number(val) || 0;
    updateNodeTransform(node.id, nextPos, rot, scale);
  };

  const handleRotChange = (axis: 0 | 1 | 2, val: number) => {
    const nextRot: [number, number, number] = [...rot];
    nextRot[axis] = Number(val) || 0;
    updateNodeTransform(node.id, pos, nextRot, scale);
  };

  const handleScaleChange = (axis: 0 | 1 | 2, val: number) => {
    const nextScale: [number, number, number] = [...scale];
    nextScale[axis] = Number(val) || 1;
    updateNodeTransform(node.id, pos, rot, nextScale);
  };

  return (
    <div className="space-y-4 p-4 text-xs text-slate-300 overflow-y-auto">
      {/* Identity & Header */}
      <div className="flex items-center justify-between border-b border-white/10 pb-3">
        <div className="min-w-0">
          <input
            type="text"
            value={node.name}
            onChange={(e) => updateNodeProperties(node.id, { name: e.target.value })}
            className="w-full bg-white/5 border border-white/10 rounded px-2 py-1 font-semibold text-white outline-none focus:border-[#83f0ce]"
          />
          <div className="mt-1 text-[10px] text-slate-500 uppercase tracking-wider">
            {node.type} · ID: {node.id.slice(0, 8)}
          </div>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => updateNodeProperties(node.id, { visible: !node.visible })}
            title={node.visible ? "Hide object" : "Show object"}
            className="p-1.5 rounded hover:bg-white/10 text-slate-400 hover:text-white"
          >
            {node.visible ? <Eye size={14} /> : <EyeOff size={14} className="text-amber-400" />}
          </button>
          <button
            onClick={() => updateNodeProperties(node.id, { locked: !node.locked })}
            title={node.locked ? "Unlock editing" : "Lock editing"}
            className="p-1.5 rounded hover:bg-white/10 text-slate-400 hover:text-white"
          >
            {node.locked ? <Lock size={14} className="text-amber-400" /> : <Unlock size={14} />}
          </button>
          <button
            onClick={() => removeNode(node.id)}
            title="Delete object"
            className="p-1.5 rounded hover:bg-rose-500/20 text-slate-400 hover:text-rose-400"
          >
            <Trash2 size={14} />
          </button>
        </div>
      </div>

      {/* Transform Inspector */}
      <div className="space-y-3">
        <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Transform</div>

        {/* Position */}
        <div>
          <div className="text-[10px] text-slate-400 mb-1">Position (m)</div>
          <div className="grid grid-cols-3 gap-1.5">
            {(["X", "Y", "Z"] as const).map((axis, i) => (
              <div key={axis} className="flex items-center rounded border border-white/10 bg-black/20 px-2 py-1">
                <span className="text-[10px] font-bold text-rose-400 mr-1.5">{axis}</span>
                <input
                  type="number"
                  step="0.1"
                  value={pos[i]}
                  onChange={(e) => handlePosChange(i as 0|1|2, parseFloat(e.target.value))}
                  className="w-full bg-transparent font-mono text-[11px] text-white outline-none"
                />
              </div>
            ))}
          </div>
        </div>

        {/* Rotation */}
        <div>
          <div className="text-[10px] text-slate-400 mb-1">Rotation (deg)</div>
          <div className="grid grid-cols-3 gap-1.5">
            {(["X", "Y", "Z"] as const).map((axis, i) => (
              <div key={axis} className="flex items-center rounded border border-white/10 bg-black/20 px-2 py-1">
                <span className="text-[10px] font-bold text-emerald-400 mr-1.5">{axis}</span>
                <input
                  type="number"
                  step="5"
                  value={rot[i]}
                  onChange={(e) => handleRotChange(i as 0|1|2, parseFloat(e.target.value))}
                  className="w-full bg-transparent font-mono text-[11px] text-white outline-none"
                />
              </div>
            ))}
          </div>
        </div>

        {/* Scale */}
        <div>
          <div className="text-[10px] text-slate-400 mb-1">Scale</div>
          <div className="grid grid-cols-3 gap-1.5">
            {(["X", "Y", "Z"] as const).map((axis, i) => (
              <div key={axis} className="flex items-center rounded border border-white/10 bg-black/20 px-2 py-1">
                <span className="text-[10px] font-bold text-sky-400 mr-1.5">{axis}</span>
                <input
                  type="number"
                  step="0.1"
                  value={scale[i]}
                  onChange={(e) => handleScaleChange(i as 0|1|2, parseFloat(e.target.value))}
                  className="w-full bg-transparent font-mono text-[11px] text-white outline-none"
                />
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Geometry Info */}
      {node.geometry && (
        <div className="space-y-2 border-t border-white/10 pt-3">
          <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Geometry</div>
          <div className="rounded border border-white/10 bg-white/5 p-2 space-y-1 font-mono text-[10px] text-slate-400">
            <div>Kind: <span className="text-[#83f0ce]">{node.geometry.kind}</span></div>
            {node.stats && (
              <>
                <div>Vertices: {node.stats.vertices}</div>
                <div>Triangles: {node.stats.triangles}</div>
              </>
            )}
          </div>
        </div>
      )}

      {/* Material Settings */}
      {node.material && (
        <div className="space-y-3 border-t border-white/10 pt-3">
          <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500">PBR Material</div>
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-[11px] text-slate-400">Base Color</span>
              <input
                type="color"
                value={node.material.color || "#ffffff"}
                onChange={(e) =>
                  updateNodeProperties(node.id, {
                    material: { ...node.material!, color: e.target.value },
                  })
                }
                className="size-6 rounded border-none bg-transparent cursor-pointer"
              />
            </div>
            <div>
              <div className="flex justify-between text-[10px] text-slate-400 mb-1">
                <span>Roughness</span>
                <span>{node.material.roughness.toFixed(2)}</span>
              </div>
              <input
                type="range"
                min="0"
                max="1"
                step="0.05"
                value={node.material.roughness}
                onChange={(e) =>
                  updateNodeProperties(node.id, {
                    material: { ...node.material!, roughness: parseFloat(e.target.value) },
                  })
                }
                className="w-full accent-[#83f0ce]"
              />
            </div>
            <div>
              <div className="flex justify-between text-[10px] text-slate-400 mb-1">
                <span>Metalness</span>
                <span>{node.material.metalness.toFixed(2)}</span>
              </div>
              <input
                type="range"
                min="0"
                max="1"
                step="0.05"
                value={node.material.metalness}
                onChange={(e) =>
                  updateNodeProperties(node.id, {
                    material: { ...node.material!, metalness: parseFloat(e.target.value) },
                  })
                }
                className="w-full accent-[#83f0ce]"
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
