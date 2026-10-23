import React, { useRef, useState } from "react";
import type { TextureAsset } from "@/forge/types.ts";
import { useStudioStore } from "@/forge/store";
import { Eye, EyeOff, Lock, Unlock, Trash2, Layers } from "lucide-react";

type TextureSlot =
  | "mapId" | "normalMapId" | "roughnessMapId" | "metalnessMapId" | "aoMapId"
  | "emissiveMapId" | "clearcoatMapId" | "clearcoatRoughnessMapId"
  | "transmissionMapId" | "thicknessMapId" | "sheenColorMapId";

type PhysicalNumericKey =
  | "clearcoat" | "clearcoatRoughness" | "transmission" | "ior"
  | "thickness" | "sheen" | "sheenRoughness";

const physicalFields: { label: string; key: PhysicalNumericKey; min: number; max: number; step: number }[] = [
  { label: "Clearcoat", key: "clearcoat", min: 0, max: 1, step: 0.05 },
  { label: "Clearcoat roughness", key: "clearcoatRoughness", min: 0, max: 1, step: 0.05 },
  { label: "Transmission (glass)", key: "transmission", min: 0, max: 1, step: 0.05 },
  { label: "Index of refraction", key: "ior", min: 1, max: 2.333, step: 0.01 },
  { label: "Thickness", key: "thickness", min: 0, max: 10, step: 0.1 },
  { label: "Sheen", key: "sheen", min: 0, max: 1, step: 0.05 },
  { label: "Sheen roughness", key: "sheenRoughness", min: 0, max: 1, step: 0.05 },
];

const textureSlots: { label: string; key: TextureSlot; data: boolean }[] = [
  { label: "Base color", key: "mapId", data: false },
  { label: "Normal", key: "normalMapId", data: true },
  { label: "Roughness", key: "roughnessMapId", data: true },
  { label: "Metalness", key: "metalnessMapId", data: true },
  { label: "Ambient occlusion", key: "aoMapId", data: true },
  { label: "Emissive", key: "emissiveMapId", data: false },
  { label: "Clearcoat", key: "clearcoatMapId", data: true },
  { label: "Clearcoat roughness", key: "clearcoatRoughnessMapId", data: true },
  { label: "Transmission", key: "transmissionMapId", data: true },
  { label: "Thickness", key: "thicknessMapId", data: true },
  { label: "Sheen color", key: "sheenColorMapId", data: false },
];

export function PropertyInspector() {
  const { project, selectedObjectId, updateNodeTransform, updateNodeProperties, removeNode } = useStudioStore();

  const textureInputRef = useRef<HTMLInputElement>(null);
  const pendingTextureSlot = useRef<TextureSlot>("mapId");
  const [textureStatus, setTextureStatus] = useState("");

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

  const updateTextureSlot = (slot: TextureSlot, textureId: string) => {
    if (!node.material) return;
    updateNodeProperties(node.id, {
      material: { ...node.material, [slot]: textureId || null },
    });
  };

  const pickTexture = (slot: TextureSlot) => {
    pendingTextureSlot.current = slot;
    textureInputRef.current?.click();
  };

  const importTexture = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const input = event.currentTarget;
    const file = input.files?.[0];
    input.value = "";
    if (!file) return;
    if (!["image/png", "image/jpeg", "image/webp"].includes(file.type)) {
      setTextureStatus("Use PNG, JPG or WebP.");
      return;
    }
    if (file.size > 16 * 1024 * 1024) {
      setTextureStatus("Image exceeds 16 MB. Resize it and retry.");
      return;
    }

    try {
      setTextureStatus("Processing texture…");
      const sourceUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => typeof reader.result === "string" ? resolve(reader.result) : reject(new Error("Image read failed."));
        reader.onerror = () => reject(new Error("Could not read image."));
        reader.readAsDataURL(file);
      });
      const image = new Image();
      await new Promise<void>((resolve, reject) => {
        image.onload = () => resolve();
        image.onerror = () => reject(new Error("Image could not be decoded."));
        image.src = sourceUrl;
      });

      const ratio = Math.min(1, 2048 / Math.max(image.naturalWidth, image.naturalHeight));
      let width = Math.max(1, Math.round(image.naturalWidth * ratio));
      let height = Math.max(1, Math.round(image.naturalHeight * ratio));
      const canvas = document.createElement("canvas");
      const render = (w: number, h: number) => {
        canvas.width = w;
        canvas.height = h;
        const context = canvas.getContext("2d");
        if (!context) throw new Error("Canvas texture processing is unavailable.");
        context.drawImage(image, 0, 0, w, h);
      };
      const mime = file.type === "image/jpeg" ? "image/jpeg" : file.type === "image/webp" ? "image/webp" : "image/png";
      render(width, height);
      let dataUrl = canvas.toDataURL(mime, 0.9);
      if (dataUrl.length > 11_500_000) {
        width = Math.max(1, Math.round(width * 0.5));
        height = Math.max(1, Math.round(height * 0.5));
        render(width, height);
        dataUrl = canvas.toDataURL(mime, 0.88);
      }
      if (dataUrl.length > 12_000_000) {
        throw new Error("Processed image is too large; use a smaller texture.");
      }

      const slot = pendingTextureSlot.current;
      const latest = useStudioStore.getState().project;
      if (!latest) throw new Error("No active project.");
      if (latest.textures.length >= 32) {
        throw new Error("Texture budget is 32 per project. Remove an unused texture first.");
      }
      const texture: TextureAsset = {
        id: crypto.randomUUID(),
        name: file.name.slice(0, 100),
        source: "import",
        colorSpace: textureSlots.find((entry) => entry.key === slot)?.data ? "linear" : "srgb",
        width,
        height,
        dataUrl,
      };
      setProject({
        ...latest,
        textures: [...latest.textures, texture],
        updatedAt: Date.now(),
      });
      updateNodeProperties(node.id, {
        material: { ...node.material!, [slot]: texture.id },
      });
      setTextureStatus(`Added ${texture.name} · ${width}×${height}`);
    } catch (error) {
      setTextureStatus(error instanceof Error ? error.message : "Texture import failed.");
    }
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
        <>
          <input ref={textureInputRef} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={(event) => void importTexture(event)} />
          <div className="space-y-3 border-t border-white/10 pt-3">
            <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Physical Material</div>
            {physicalFields.map((field) => {
              const value = node.material?.[field.key] ?? (field.key === "ior" ? 1.5 : 0);
              return (
                <div key={field.key}>
                  <div className="flex justify-between text-[10px] text-slate-400 mb-1">
                    <span>{field.label}</span>
                    <span>{value.toFixed(2)}</span>
                  </div>
                  <input
                    type="range"
                    min={field.min}
                    max={field.max}
                    step={field.step}
                    value={value}
                    onChange={(e) => updateNodeProperties(node.id, {
                      material: { ...node.material!, [field.key]: parseFloat(e.target.value) },
                    })}
                    className="w-full accent-[#83f0ce]"
                  />
                </div>
              );
            })}
            <div className="flex items-center justify-between gap-3">
              <label className="text-[11px] text-slate-400">Sheen color</label>
              <input
                type="color"
                value={node.material.sheenColor ?? "#FFFFFF"}
                onChange={(e) => updateNodeProperties(node.id, {
                  material: { ...node.material!, sheenColor: e.target.value },
                })}
                className="size-6 rounded border-none bg-transparent cursor-pointer"
              />
            </div>
          </div>

          <div className="space-y-3 border-t border-white/10 pt-3">
            <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Texture Maps</div>
            <p className="text-[10px] leading-4 text-slate-500">Import PNG/JPG/WebP maps and assign them to this material. Color maps use sRGB; surface-data maps use linear space.</p>
            {textureSlots.map((slot) => (
              <div key={slot.key} className="space-y-1">
                <div className="flex items-center justify-between gap-2">
                  <label className="text-[10px] text-slate-400">{slot.label}</label>
                  <button
                    type="button"
                    onClick={() => pickTexture(slot.key)}
                    className="rounded border border-white/10 px-2 py-1 text-[10px] text-slate-300 hover:border-[#83f0ce]/50 hover:text-white"
                  >Import</button>
                </div>
                <select
                  value={node.material[slot.key] ?? ""}
                  onChange={(e) => updateTextureSlot(slot.key, e.target.value)}
                  className="w-full rounded border border-white/10 bg-[#101821] px-2 py-1.5 text-[10px] text-slate-200 outline-none focus:border-[#83f0ce]/50"
                >
                  <option value="">None</option>
                  {project.textures.map((texture) => (
                    <option key={texture.id} value={texture.id}>{texture.name} ({texture.width}×{texture.height})</option>
                  ))}
                </select>
              </div>
            ))}
            {textureStatus && <div className="rounded border border-white/10 bg-white/[.03] px-2 py-1.5 text-[10px] leading-4 text-slate-400">{textureStatus}</div>}
          </div>
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
        </>
      )}
    </div>
  );
}
