# MVM BABYLON renderer

## What this change is

MVM BABYLON is a separate Babylon.js renderer backend for the existing Forge project schema. The current feature branch uses `@babylonjs/core` 9.32.x, attempts WebGPU initialization first, and falls back to Babylon's WebGL engine if WebGPU is unavailable or initialization fails.

The viewport backend converts the saved Forge scene into Babylon objects: mesh primitives and custom vertex buffers, transform hierarchy, light types, PBR materials, generated/imported texture assets, the available texture slots, clearcoat, sheen, transmission/refraction settings, scene exposure, camera controls, shadows and authored animation clips. The Studio viewport includes an explicit engine switch so the current Three.js renderer remains available for comparison and rollback.

## Compatibility boundary — important

This is a real second rendering backend, **not yet a complete removal of Three.js from the product**.

- Existing code is still executed by the current Forge SDK and the supported `THREE` compatibility runtime; its output is normalized into the Forge project schema. The Babylon backend renders that validated schema.
- Existing `/mcp` tools still use the current execution pipeline. The Babylon viewport forwards rendered canvas frames through the existing Studio capture hook so remote render/screenshot flows can continue to operate.
- Existing GLB export is still implemented by the existing Three.js exporter. Do not describe it as a Babylon-native exporter.
- Forge currently supports the standard scene/material fields only. It does not automatically produce high-resolution scanned assets, calibrated skin/hair/cloth shaders, advanced volumetrics, ray-traced reflections or physically validated real-world material measurements.

## Current limitations to test

- Babylon's built-in environment asset is fetched from `assets.babylonjs.com` when no custom environment is configured; a fully offline environment bundle is not included in this change.
- Babylon custom environment URLs support `.env` and `.hdr` in this backend. The current Three.js backend additionally knows about EXR; EXR parity is not claimed here.
- Texture channels are adapted to Babylon's PBR conventions. Imported normal, ambient-occlusion, roughness, metallic, emissive, clearcoat, transmission/thickness and sheen maps must be checked with representative assets; an assigned texture does not by itself guarantee identical appearance between renderers.
- Transmission currently uses an environment-backed refraction path and optional refraction-intensity texture; this is not full scene-screen transmission. A physically complete transmission render-graph path remains future work.
- The named environment presets are compatibility hints for exposure/environment strength, not a promise that each one uses a different photographed HDRI.
- WebGPU capability depends on the user's browser, OS, GPU and security context. The UI reports whether the active backend is WebGPU or WebGL; do not report WebGPU when the fallback was selected.

## Release gate before paid access

Do not merge or promote this as production-ready until the following are verified on the actual branch/deployment:

1. `npm ci`, `npm run typecheck`, `npm test`, `npm run lint` and `npm run build` all pass.
2. The same benchmark project renders in Babylon WebGPU, Babylon WebGL fallback and the retained Three.js viewport; compare object hierarchy, transforms, UVs, all supported PBR slots, alpha modes, animation timing and scene scale.
3. Test with at least one real textured GLB, separate base-colour/normal/AO/roughness/metalness maps, a transparent object, a clear-coated metal and a transmissive glass-like object.
4. Confirm the MCP scene-run/apply pipeline, remote render job capture, screenshot delivery, export action, save/reload, and old project files all work without data loss.
5. Measure frame-time/FPS and GPU memory with a fixed representative scene on a lower-end laptop and a modern WebGPU-capable device. Publish measurements rather than a “100×” claim unless a controlled benchmark demonstrates a specific improvement.
6. Confirm resource disposal during repeated project switches and no console errors or network failures for optional textures/environments.

## Reference

- Babylon.js is distributed as ES modules through `@babylonjs/core` (Apache-2.0): https://www.npmjs.com/package/@babylonjs/core
- Engine feature list: https://www.babylonjs.com/specifications/
- PBR material conventions and subsurface textures: https://github.com/BabylonJS/Documentation/blob/master/content/features/featuresDeepDive/materials/using/masterPBR.md
- WebGPU initialization requires asynchronous engine initialization: https://github.com/BabylonJS/Documentation/blob/master/content/setup/support/webGPU.md
