import { defaultMaterial } from "./materials.ts";
import type { MaterialSpec, SceneNode } from "./types.ts";
import { makeNode } from "./nodes.ts";

export type HumanoidParams = {
  name: string;
  height: number;
  shoulderWidth: number;
  hipWidth: number;
  headScale: number;
  armLength: number;
  legLength: number;
};

export const HUMANOID_DEFAULTS: HumanoidParams = {
  name: "Blockout",
  height: 1.78,
  shoulderWidth: 0.46,
  hipWidth: 0.3,
  headScale: 1,
  armLength: 0.62,
  legLength: 0.86,
};

/**
 * Simplified proportion blockout. Not a photoreal human, not a game-ready rig.
 * Feet sit on Y=0. Parts are separate meshes under one group so they can be
 * selected. There is no skin weighting in this release.
 */
export function buildHumanoidNodes(params: HumanoidParams, source: SceneNode["source"]): SceneNode[] {
  const p = params;
  const leg = p.legLength;
  const headR = 0.115 * p.headScale;
  const neckH = 0.055 * p.headScale;
  const torsoH = Math.max(0.28, p.height - leg - neckH - headR * 1.65);
  const hipY = leg;
  const shoulderY = hipY + torsoH * 0.9;
  const headY = hipY + torsoH + neckH * 0.5 + headR;

  const skin = defaultMaterial({
    color: "#C9A48A",
    roughness: 0.62,
    metalness: 0.02,
  });
  const cloth = defaultMaterial({
    color: "#2C4156",
    roughness: 0.72,
    metalness: 0.04,
  });
  const joint = defaultMaterial({
    color: "#8C7668",
    roughness: 0.55,
    metalness: 0.03,
  });
  const sole = defaultMaterial({
    color: "#1A232C",
    roughness: 0.8,
    metalness: 0.05,
  });

  const group = makeNode({
    name: p.name,
    type: "group",
    source,
    position: [0, 0, 0],
  });

  const parts: SceneNode[] = [];
  const add = (
    name: string,
    geometry: SceneNode["geometry"],
    position: SceneNode["position"],
    material: MaterialSpec,
    rotation?: SceneNode["rotation"],
  ) => {
    parts.push(
      makeNode({
        name: `${p.name} ${name}`,
        type: "mesh",
        source,
        parentId: group.id,
        geometry,
        material,
        position,
        rotation: rotation ?? [0, 0, 0],
      }),
    );
  };

  add(
    "Pelvis",
    { kind: "box", width: p.hipWidth, height: 0.16, depth: 0.18, widthSegments: 1, heightSegments: 1, depthSegments: 1 },
    [0, hipY, 0],
    cloth,
  );
  add(
    "Abdomen",
    { kind: "capsule", radius: p.hipWidth * 0.34, length: torsoH * 0.34, capSegments: 3, radialSegments: 10 },
    [0, hipY + torsoH * 0.28, 0],
    cloth,
  );
  add(
    "Chest",
    {
      kind: "box",
      width: p.shoulderWidth * 0.92,
      height: torsoH * 0.42,
      depth: 0.22,
      widthSegments: 1,
      heightSegments: 1,
      depthSegments: 1,
    },
    [0, shoulderY - torsoH * 0.16, 0],
    cloth,
  );
  add(
    "Neck",
    { kind: "cylinder", radiusTop: 0.045 * p.headScale, radiusBottom: 0.05 * p.headScale, height: neckH, radialSegments: 10, openEnded: false },
    [0, hipY + torsoH + neckH * 0.15, 0],
    skin,
  );
  add(
    "Head",
    { kind: "sphere", radius: headR, widthSegments: 24, heightSegments: 16 },
    [0, headY, 0.01],
    skin,
  );

  const armR = 0.048;
  const upperLen = Math.max(0.12, p.armLength * 0.48 - armR * 2);
  const foreLen = Math.max(0.1, p.armLength * 0.42 - armR * 2);
  const sides = [
    { tag: "L", sign: -1 },
    { tag: "R", sign: 1 },
  ] as const;

  for (const side of sides) {
    const sx = side.sign * (p.shoulderWidth / 2);
    const hx = side.sign * (p.hipWidth / 2) * 0.72;
    add(
      `Shoulder.${side.tag}`,
      { kind: "sphere", radius: 0.055, widthSegments: 14, heightSegments: 10 },
      [sx, shoulderY, 0],
      joint,
    );
    add(
      `UpperArm.${side.tag}`,
      { kind: "capsule", radius: armR, length: upperLen, capSegments: 3, radialSegments: 10 },
      [sx, shoulderY - 0.055 - upperLen / 2 - armR, 0],
      skin,
    );
    const elbowY = shoulderY - 0.055 - upperLen - armR * 2;
    add(
      `Elbow.${side.tag}`,
      { kind: "sphere", radius: 0.046, widthSegments: 12, heightSegments: 8 },
      [sx, elbowY, 0],
      joint,
    );
    add(
      `Forearm.${side.tag}`,
      { kind: "capsule", radius: armR * 0.86, length: foreLen, capSegments: 3, radialSegments: 10 },
      [sx, elbowY - foreLen / 2 - armR, 0],
      skin,
    );
    add(
      `Hand.${side.tag}`,
      { kind: "box", width: 0.07, height: 0.1, depth: 0.04, widthSegments: 1, heightSegments: 1, depthSegments: 1 },
      [sx, elbowY - foreLen - armR * 2 - 0.05, 0],
      skin,
    );

    const thighLen = Math.max(0.16, leg * 0.48 - 0.1);
    const shinLen = Math.max(0.14, leg * 0.42 - 0.09);
    add(
      `Hip.${side.tag}`,
      { kind: "sphere", radius: 0.06, widthSegments: 12, heightSegments: 8 },
      [hx, hipY - 0.02, 0],
      joint,
    );
    add(
      `Thigh.${side.tag}`,
      { kind: "capsule", radius: 0.07, length: thighLen, capSegments: 3, radialSegments: 10 },
      [hx, hipY - 0.08 - thighLen / 2, 0],
      cloth,
    );
    const kneeY = hipY - 0.08 - thighLen - 0.06;
    add(
      `Knee.${side.tag}`,
      { kind: "sphere", radius: 0.05, widthSegments: 12, heightSegments: 8 },
      [hx, kneeY, 0.01],
      joint,
    );
    add(
      `Shin.${side.tag}`,
      { kind: "capsule", radius: 0.05, length: shinLen, capSegments: 3, radialSegments: 10 },
      [hx, kneeY - shinLen / 2 - 0.04, 0],
      cloth,
    );
    add(
      `Foot.${side.tag}`,
      { kind: "box", width: 0.09, height: 0.07, depth: 0.22, widthSegments: 1, heightSegments: 1, depthSegments: 1 },
      [hx, 0.045, 0.04],
      sole,
    );
  }

  return [group, ...parts];
}
