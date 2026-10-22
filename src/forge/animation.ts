import type { AnimTrack } from "./types.ts";

export function sampleTrack(track: AnimTrack, time: number): number[] | null {
  const keys = [...track.keyframes].sort((a, b) => a.time - b.time);
  if (!keys.length) return null;
  if (time <= keys[0].time) return keys[0].value.slice();
  const last = keys[keys.length - 1];
  if (time >= last.time) return last.value.slice();
  let index = 0;
  while (index < keys.length - 1 && keys[index + 1].time < time) index += 1;
  const a = keys[index];
  const b = keys[index + 1];
  const span = b.time - a.time || 1;
  let u = (time - a.time) / span;
  if (track.interpolation === "smooth") u = u * u * (3 - 2 * u);
  const length = Math.min(a.value.length, b.value.length);
  const out: number[] = [];
  for (let i = 0; i < length; i += 1) out.push(a.value[i] + (b.value[i] - a.value[i]) * u);
  return out;
}

export function clipDuration(tracks: { keyframes: { time: number }[] }[], fallback: number): number {
  let max = fallback;
  for (const track of tracks) {
    for (const key of track.keyframes) max = Math.max(max, key.time);
  }
  return max;
}
