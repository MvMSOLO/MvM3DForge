import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { sampleTrack } from "./animation.ts";
import type { AnimTrack } from "./types.ts";

function makeTrack(interpolation: AnimTrack["interpolation"]): AnimTrack {
  return {
    id: "track-1",
    objectId: "object-1",
    property: "position",
    interpolation,
    keyframes: [
      { time: 0, value: [0, 0, 0] },
      { time: 1, value: [10, 0, 0] },
      { time: 2, value: [20, 0, 0] },
    ],
  };
}

describe("animation track sampling", () => {
  it("holds the previous value between step keys", () => {
    assert.deepEqual(sampleTrack(makeTrack("step"), 0.75), [0, 0, 0]);
    assert.deepEqual(sampleTrack(makeTrack("step"), 1), [10, 0, 0]);
    assert.deepEqual(sampleTrack(makeTrack("step"), 1.75), [10, 0, 0]);
  });

  it("interpolates linear tracks continuously", () => {
    assert.deepEqual(sampleTrack(makeTrack("linear"), 0.5), [5, 0, 0]);
  });

  it("smooths the interpolation curve without changing endpoint values", () => {
    const track = makeTrack("smooth");
    assert.deepEqual(sampleTrack(track, 0), [0, 0, 0]);
    assert.deepEqual(sampleTrack(track, 1), [10, 0, 0]);
    assert.deepEqual(sampleTrack(track, 2), [20, 0, 0]);
  });

  it("returns null for an empty track", () => {
    const track = makeTrack("linear");
    track.keyframes = [];
    assert.equal(sampleTrack(track, 0), null);
  });
});
