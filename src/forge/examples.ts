export type StarterId =
  | "blank"
  | "primitives"
  | "pbr"
  | "product"
  | "animated"
  | "blockout"
  | "roundtrip";

export type Starter = {
  id: StarterId;
  title: string;
  summary: string;
  expected: string;
  limitation: string;
  code: string;
};

export const starters: Starter[] = [
  {
    id: "blank",
    title: "Empty Studio",
    summary: "Studio rig lights only, plus a short sample you can run.",
    expected: "A cyan block named Forge Body after Run and Apply.",
    limitation: "Editor lights stay in the scene; scripts do not delete them.",
    code: "",
  },
  {
    id: "primitives",
    title: "Primitive Lab",
    summary: "Box, sphere, torus, and cylinder with named materials.",
    expected: "Four shaded meshes sitting on the ground grid.",
    limitation: "Segment counts are preview-quality, not CAD tolerances.",
    code: `const clay = mvm.material.pbr({ color: "#43C8F5", roughness: 0.48, metalness: 0.06 });
const metal = mvm.material.pbr({ color: "#C5D0DB", roughness: 0.28, metalness: 0.86 });
const mint = mvm.material.pbr({ color: "#B6F36A", roughness: 0.42, metalness: 0.12 });
const warm = mvm.material.pbr({ color: "#E0A35A", roughness: 0.4, metalness: 0.18 });

const box = mvm.geometry.box({ width: 1.15, height: 1.15, depth: 1.15 });
box.name = "Calibration Cube";
box.material = clay;
box.position.set(-1.7, 0.575, 0);

const sphere = mvm.geometry.sphere({ radius: 0.62, widthSegments: 48, heightSegments: 28 });
sphere.name = "Chrome Sphere";
sphere.material = metal;
sphere.position.set(0, 0.62, 0);

const torus = mvm.geometry.torus({ radius: 0.52, tube: 0.18, radialSegments: 20, tubularSegments: 48 });
torus.name = "Mint Torus";
torus.material = mint;
torus.position.set(1.75, 0.72, 0);

const cylinder = mvm.geometry.cylinder({ radiusTop: 0.34, radiusBottom: 0.46, height: 1.2, radialSegments: 28 });
cylinder.name = "Warm Cylinder";
cylinder.material = warm;
cylinder.position.set(0.15, 0.6, 1.55);

mvm.scene.add(box, sphere, torus, cylinder);
mvm.console.log("Primitive Lab", { objects: mvm.scene.list().length });
`,
  },
  {
    id: "pbr",
    title: "PBR Material Lab",
    summary: "Roughness columns and metalness rows on identical spheres.",
    expected: "A 5×3 field of spheres. Metals pick up the studio environment.",
    limitation: "Clearcoat, sheen, and transmission are not part of this release.",
    code: `mvm.scene.environment("studio");
mvm.scene.exposure(1.05);

const roughness = [0.12, 0.32, 0.52, 0.72, 0.92];
const metals = [0, 0.45, 1];

metals.forEach((metal, row) => {
  roughness.forEach((rough, col) => {
    const sphere = mvm.geometry.sphere({ radius: 0.3, widthSegments: 40, heightSegments: 24 });
    sphere.name = "R" + rough.toFixed(2) + " M" + metal.toFixed(2);
    sphere.material = mvm.material.pbr({
      color: "#D7DEE6",
      roughness: rough,
      metalness: metal,
    });
    sphere.position.set((col - 2) * 0.78, 0.3 + row * 0.78, 0);
    mvm.scene.add(sphere);
  });
});

const rim = mvm.light.directional({
  name: "Rim",
  color: "#D7ECFF",
  intensity: 1.1,
  position: [-4, 3.5, -3],
  target: [0, 0.8, 0],
  castShadow: false,
});
mvm.scene.add(rim);
mvm.console.log("PBR grid ready", mvm.project.info());
`,
  },
  {
    id: "product",
    title: "Procedural Product",
    summary: "Original handheld forge beacon built from primitives and a checker grip.",
    expected: "A standing device on a deck: body, grip, emitter, lens, rails, antenna.",
    limitation: "This is a design blockout, not a manufactured CAD model.",
    code: `const deckMat = mvm.material.pbr({ color: "#1C2833", roughness: 0.78, metalness: 0.18 });
const shell = mvm.material.pbr({ color: "#8AA0B3", roughness: 0.34, metalness: 0.72 });
const dark = mvm.material.pbr({ color: "#121A22", roughness: 0.46, metalness: 0.4 });
const emitter = mvm.material.pbr({
  color: "#10384A",
  roughness: 0.22,
  metalness: 0.18,
  emissive: "#39D0FF",
  emissiveIntensity: 2.4,
});
const gripTex = mvm.texture.checker({ name: "Grip", size: 128, cells: 6, colorA: "#1A2430", colorB: "#314556", colorSpace: "srgb" });
const grip = mvm.material.pbr({ color: "#9AA8B5", roughness: 0.72, metalness: 0.08, map: gripTex });

const deck = mvm.geometry.box({ width: 2.4, height: 0.08, depth: 1.3 });
deck.name = "Deck";
deck.material = deckMat;
deck.position.set(0, 0.04, 0);

const handle = mvm.geometry.capsule({ radius: 0.11, length: 0.72, radialSegments: 16, capSegments: 4 });
handle.name = "Grip";
handle.material = grip;
handle.position.set(0, 0.52, -0.02);

const body = mvm.geometry.box({ width: 0.42, height: 0.86, depth: 0.28 });
body.name = "Shell";
body.material = shell;
body.position.set(0, 1.18, 0.02);

const bezel = mvm.geometry.cylinder({ radiusTop: 0.2, radiusBottom: 0.24, height: 0.12, radialSegments: 28 });
bezel.name = "Bezel";
bezel.material = dark;
bezel.position.set(0, 1.68, 0.02);

const lens = mvm.geometry.sphere({ radius: 0.16, widthSegments: 32, heightSegments: 20 });
lens.name = "Emitter Lens";
lens.material = emitter;
lens.position.set(0, 1.84, 0.02);

const antenna = mvm.geometry.cylinder({ radiusTop: 0.015, radiusBottom: 0.02, height: 0.55, radialSegments: 10 });
antenna.name = "Antenna";
antenna.material = dark;
antenna.position.set(0.16, 1.72, -0.08);

for (const side of [-1, 1]) {
  const rail = mvm.geometry.box({ width: 0.04, height: 0.7, depth: 0.06 });
  rail.name = side < 0 ? "Rail L" : "Rail R";
  rail.material = dark;
  rail.position.set(side * 0.24, 1.16, 0.02);
  mvm.scene.add(rail);
}

const trigger = mvm.geometry.box({ width: 0.16, height: 0.28, depth: 0.06 });
trigger.name = "Trigger";
trigger.material = mvm.material.pbr({ color: "#B6F36A", roughness: 0.4, metalness: 0.15 });
trigger.position.set(0, 0.78, 0.18);

mvm.scene.add(deck, handle, body, bezel, lens, antenna, trigger);
mvm.project.name("Forge Beacon");
mvm.console.log("Beacon parts", { count: mvm.scene.list().length });
`,
  },
  {
    id: "animated",
    title: "Animated Object",
    summary: "A signal mast whose head sweeps with a smooth rotation clip.",
    expected: "After Apply, press Play on the timeline. The head banks left and right.",
    limitation: "Viewport playback is a preview. The clip exports inside the GLB as quaternion keys.",
    code: `const mast = mvm.geometry.cylinder({ radiusTop: 0.06, radiusBottom: 0.09, height: 1.4, radialSegments: 16 });
mast.name = "Mast";
mast.material = mvm.material.pbr({ color: "#9AA8B5", roughness: 0.4, metalness: 0.55 });
mast.position.set(0, 0.7, 0);

const head = mvm.geometry.box({ width: 0.72, height: 0.16, depth: 0.28 });
head.name = "Signal Head";
head.material = mvm.material.pbr({
  color: "#16384A",
  roughness: 0.32,
  metalness: 0.24,
  emissive: "#43C8F5",
  emissiveIntensity: 1.6,
});
head.position.set(0, 1.52, 0);

const base = mvm.geometry.cylinder({ radiusTop: 0.28, radiusBottom: 0.34, height: 0.12, radialSegments: 24 });
base.name = "Plinth";
base.material = mvm.material.pbr({ color: "#202A33", roughness: 0.7, metalness: 0.2 });
base.position.set(0, 0.06, 0);

mvm.scene.add(base, mast, head);

const clip = mvm.animation.clip({ name: "Sweep", duration: 2, loop: true });
mvm.animation.track(clip, {
  object: head,
  property: "rotation",
  interpolation: "smooth",
  keys: [
    { time: 0, value: [0, 0, -22] },
    { time: 1, value: [0, 0, 22] },
    { time: 2, value: [0, 0, -22] },
  ],
});
mvm.animation.play("Sweep");
mvm.console.log("Sweep clip ready");
`,
  },
  {
    id: "blockout",
    title: "Character Blockout",
    summary: "Adjustable proportion blockout. Not a photoreal person and not a skinned rig.",
    expected: "A standing humanoid made of separate primitive parts under one group.",
    limitation: "No facial topology, hair, cloth sim, skin shader, or weight painting.",
    code: `const hero = mvm.geometry.humanoid({
  name: "Blockout Hero",
  height: 1.78,
  shoulderWidth: 0.46,
  hipWidth: 0.3,
  headScale: 1,
  armLength: 0.62,
  legLength: 0.86,
});
mvm.scene.add(hero);
mvm.console.log("Blockout is a proportion study, not a digital human.", mvm.object.stats(hero.children[0]));
`,
  },
  {
    id: "roundtrip",
    title: "GLB Round-trip",
    summary: "Small scene with a texture, a light, and a motion clip for export checks.",
    expected: "Use Export GLB, then the summary compares a re-import. Or Import the file back.",
    limitation: "Procedural textures become embedded images. Editor rig lights are included if visible.",
    code: `const tex = mvm.texture.stripes({
  name: "Hazard",
  size: 128,
  cells: 6,
  colorA: "#141C24",
  colorB: "#E0A35A",
  vertical: false,
});
const crate = mvm.geometry.box({ width: 0.9, height: 0.9, depth: 0.9 });
crate.name = "Hazard Crate";
crate.material = mvm.material.pbr({
  color: "#F2F4F6",
  roughness: 0.55,
  metalness: 0.08,
  map: tex,
});
crate.position.set(0, 0.45, 0);

const cone = mvm.geometry.cone({ radius: 0.22, height: 0.45, radialSegments: 20 });
cone.name = "Cap";
cone.material = mvm.material.pbr({ color: "#43C8F5", roughness: 0.3, metalness: 0.4 });
cone.position.set(0, 1.12, 0);

mvm.scene.add(crate, cone);

const clip = mvm.animation.clip({ name: "Bob", duration: 1.6, loop: true });
mvm.animation.track(clip, {
  object: cone,
  property: "position",
  interpolation: "smooth",
  keys: [
    { time: 0, value: [0, 1.12, 0] },
    { time: 0.8, value: [0, 1.38, 0] },
    { time: 1.6, value: [0, 1.12, 0] },
  ],
});

const check = mvm.validate.scene();
mvm.console.log("Preflight", check);
mvm.export.requestGlb({ filename: "roundtrip.glb", visibleOnly: true, includeAnimations: true });
`,
  },
];

export function starterById(id: StarterId): Starter {
  const found = starters.find((item) => item.id === id);
  if (!found) throw new Error(`Unknown starter ${id}`);
  return found;
}
