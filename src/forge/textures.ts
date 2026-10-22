import { LIMITS } from "./limits.ts";
import type { TextureAsset } from "./types.ts";

export function textureSize(value: number): number {
  if (!Number.isFinite(value)) return 256;
  return Math.max(2, Math.min(LIMITS.maxTextureSize, Math.round(value)));
}

function hexToRgb(hex: string): [number, number, number] {
  const raw = hex.replace("#", "");
  const full = raw.length === 3 ? raw.split("").map((c) => c + c).join("") : raw;
  const n = Number.parseInt(full || "000000", 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function paint(data: Uint8ClampedArray, index: number, rgb: [number, number, number], a = 255) {
  data[index] = rgb[0];
  data[index + 1] = rgb[1];
  data[index + 2] = rgb[2];
  data[index + 3] = a;
}

function hash(n: number): number {
  let x = n | 0;
  x = Math.imul(x ^ (x >>> 16), 2246822507);
  x = Math.imul(x ^ (x >>> 13), 3266489909);
  return ((x ^ (x >>> 16)) >>> 0) / 4294967295;
}

/** Raster pixels, row 0 at the top of the image. */
export function rasterizeTexture(asset: TextureAsset): { data: Uint8ClampedArray; width: number; height: number } | null {
  if (!asset.generator) return null;
  const width = textureSize(asset.width);
  const height = textureSize(asset.height);
  const data = new Uint8ClampedArray(width * height * 4);
  const params = asset.params ?? {};
  const colorA = hexToRgb(String(params.colorA ?? "#0E1620"));
  const colorB = hexToRgb(String(params.colorB ?? "#F0F5F9"));
  const cells = Math.max(1, Number(params.cells ?? 8));
  const vertical = Number(params.vertical ?? 0) === 1;
  const seed = Number(params.seed ?? 1);

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = (y * width + x) * 4;
      let rgb = colorA;
      if (asset.generator === "solid") rgb = colorA;
      else if (asset.generator === "checker") {
        const cx = Math.floor((x / width) * cells);
        const cy = Math.floor((y / height) * cells);
        rgb = (cx + cy) % 2 === 0 ? colorA : colorB;
      } else if (asset.generator === "stripes") {
        const t = vertical ? y / height : x / width;
        const band = Math.floor(t * cells);
        rgb = band % 2 === 0 ? colorA : colorB;
      } else if (asset.generator === "dots") {
        const cellW = width / cells;
        const cellH = height / cells;
        const lx = (x % cellW) - cellW / 2;
        const ly = (y % cellH) - cellH / 2;
        rgb = lx * lx + ly * ly < (Math.min(cellW, cellH) * 0.28) ** 2 ? colorB : colorA;
      } else if (asset.generator === "gradient") {
        const t = vertical ? y / (height - 1 || 1) : x / (width - 1 || 1);
        rgb = [
          Math.round(colorA[0] + (colorB[0] - colorA[0]) * t),
          Math.round(colorA[1] + (colorB[1] - colorA[1]) * t),
          Math.round(colorA[2] + (colorB[2] - colorA[2]) * t),
        ];
      } else if (asset.generator === "noise") {
        const v = hash(seed * 10007 + y * width + x);
        rgb = [
          Math.round(colorA[0] + (colorB[0] - colorA[0]) * v),
          Math.round(colorA[1] + (colorB[1] - colorA[1]) * v),
          Math.round(colorA[2] + (colorB[2] - colorA[2]) * v),
        ];
      }
      paint(data, i, rgb);
    }
  }
  return { data, width, height };
}

export function loadHtmlImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Could not decode the image."));
    image.src = url;
  });
}

export function canvasFromPixels(data: Uint8ClampedArray, width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("2D canvas is unavailable.");
  // Copy into a fresh ArrayBuffer-backed view: the source may be typed over SharedArrayBuffer,
  // which the DOM ImageData constructor does not accept under strict TypeScript typings.
  const imageData = new Uint8ClampedArray(data.length);
  imageData.set(data);
  ctx.putImageData(new ImageData(imageData, width, height), 0, 0);
  return canvas;
}

export function estimateTextureBytes(textures: { width: number; height: number }[]): number {
  return textures.reduce((sum, tex) => sum + tex.width * tex.height * 4, 0);
}
