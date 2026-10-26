# MVM BABYLON — native engine implementation

## What runs when MVM BABYLON is selected

MVM BABYLON is now a **native Babylon.js authoring/runtime path**, not only a renderer for Forge's Three.js-produced scene graph.

- The Studio passes the actual Babylon Engine or WebGPUEngine, Scene, canvas, BABYLON namespace and console to native JavaScript code. Code can create real BABYLON.MeshBuilder geometry, PBRMaterial/StandardMaterial, textures, lights, cameras, animation groups, transforms, imported assets and other public Babylon objects directly.
- After a successful run, the complete native scene is serialized with Babylon's SceneSerializer into the project's nativeBabylonScene field. A bounded Forge node summary exists for inspector and existing validation UI; it is not the rendering or export source of truth for a native Babylon project.
- Reloaded projects are parsed back into a Babylon Scene. The browser canvas uses WebGPU first, with a Babylon WebGL fallback if WebGPU initialization is unavailable.
- The selected engine is also used for MCP script jobs. The connected AI's JavaScript runs against the active Babylon scene rather than being forced through the old mvm.* / Three.js adapter.
- GLB import uses Babylon's registered glTF loader and GLB export uses Babylon's GLTF2Export.GLBAsync. The Three.js runtime/export path remains available for existing legacy projects.
- Engine switching keeps a separate editor buffer for each API. A saved native Babylon scene is preserved while switching to Three.js, then invalidated if a Three.js script actually changes the project.

## Scene data and compatibility boundaries

- Existing Forge JSON projects without an engine field remain legacy Three.js projects. Selecting MVM BABYLON explicitly opts into native BABYLON.* code; old mvm.* scripts are not silently reinterpreted as Babylon code.
- nativeBabylonScene is serialized along with the rest of project JSON. Its current transfer budget is 2,000,000 characters, and the inspector projection is limited to 400 meshes / 140,000 summarized vertices. Very large embedded-texture models may exceed that budget and need a separate binary-asset storage pipeline before paid access.
- The bounded Forge summary is not a perfect round-trip representation of every Babylon feature. It is used for current inspector/validation features; the saved Babylon scene JSON retains the richer native hierarchy and materials.
- The native runner exposes real Babylon APIs, but it still executes user JavaScript in the browser page's JavaScript realm. It is not yet an isolated worker/iframe security boundary with a hard execution timeout. Do not treat it as a secure multi-tenant code sandbox until that isolation is implemented.
- The engine is WebGPU-first, not WebGPU-only. Browsers without a usable WebGPU adapter must use WebGL; the viewport reports the backend that actually initialized.
- The built-in PBR environment references an environment asset hosted by Babylon. An offline HDRI bundle is not included in this change.
- Environment-backed refraction is implemented for glass-like materials, but that does not claim full scene-screen transmission. The engine does not automatically create scanned assets, high-resolution textures, calibrated skin/hair/cloth shaders, volumetrics or ray-traced reflections.
- “100× realism” and “100× faster” are not claimed. Those require a fixed scene, comparable settings and recorded benchmarks.

## Verification and release gate

The CI workflow runs the actual project build, TypeScript check, lint, existing MCP/auth/scene regressions and new Babylon native-runner tests. The native runner tests use Babylon's real NullEngine to confirm BABYLON.MeshBuilder and PBRMaterial scripts produce a serialized native scene and valid Forge summary projection.

Before this is released as a paid engine, still manually verify on real browsers and real assets:

1. Load/save/reload a representative textured GLB and compare its PBR appearance, transforms, imported materials and animations.
2. Export a native Babylon scene to GLB and re-import that GLB in Babylon and an independent viewer.
3. Verify MCP run/apply/capture in an actual browser, including conflict and failed-script flows.
4. Run the same controlled scene on Babylon WebGPU, Babylon WebGL and the retained Three.js path; record frame-time/FPS and memory on both a modest laptop and a modern GPU.
5. Confirm texture disposal and no leaks during repeated import, code run, project switching, save and reload.
6. Design a binary asset persistence path before raising the native scene payload limit; do not bypass the size guard to make large imports appear to work.

## References

- Babylon.js core package: https://www.npmjs.com/package/@babylonjs/core
- Babylon.js specification and feature support: https://www.babylonjs.com/specifications/
- PBR material guide: https://github.com/BabylonJS/Documentation/blob/master/content/features/featuresDeepDive/materials/using/masterPBR.md
- WebGPU setup and asynchronous engine initialization: https://github.com/BabylonJS/Documentation/blob/master/content/setup/support/webGPU.md
- glTF exporter: https://doc.babylonjs.com/features/featuresDeepDive/Exporters/glTFExporter/
