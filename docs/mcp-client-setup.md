# MVM3D: Remote MCP, AI providers, and rendering modes

**MCP endpoint:** `https://mvm3d.vercel.app/mcp`  
**Transport:** MCP Streamable HTTP  
**Primary authentication:** OAuth 2.1 authorization code flow with PKCE (S256), dynamic client registration, and optional rotating refresh tokens  
**No pre-created MVM3D API key is required for compatible MCP clients.**

## Connect ChatGPT using only the endpoint URL

When this branch is deployed to the production project:

1. In ChatGPT, add a custom MCP connector and enter `https://mvm3d.vercel.app/mcp`.
2. Select **OAuth** as the authentication method. Do not paste a static MVM3D API key into the OAuth form.
3. Follow the MVM3D sign-in and consent screen and approve only the permissions needed for the connector.
4. Once authorization completes, ChatGPT receives a scoped, short-lived OAuth access token and calls the same `/mcp` endpoint.

The server publishes the OAuth authorization-server metadata at:

- `https://mvm3d.vercel.app/.well-known/oauth-authorization-server`
- `https://mvm3d.vercel.app/.well-known/oauth-protected-resource`
- `https://mvm3d.vercel.app/.well-known/oauth-protected-resource/mcp`

The MCP endpoint returns a `401` `WWW-Authenticate` challenge that identifies the protected-resource metadata. The OAuth implementation supports authorization codes with PKCE S256, Client ID Metadata Documents for ChatGPT, dynamic client registration, and RFC 9207 issuer identification. The authorization-server metadata advertises `authorization_response_iss_parameter_supported: true`; both successful and denied consent callbacks return `iss` matching the exact `issuer` value. Access tokens are audience-bound to `https://mvm3d.vercel.app/mcp`, include user and permission claims, and expire after one hour. Authorization codes are short-lived, single-use, and PKCE-verified.

If ChatGPT reports that it cannot discover OAuth settings, first confirm these metadata URLs return JSON on the deployed production domain. If the endpoint returns `503`, check the persistent database and deployment configuration rather than switching to unauthenticated writes.

## No pre-created API key required

For ChatGPT, Claude, and compatible remote MCP clients, users do not need to open Studio, create an MVM3D API key, or paste a secret into the connector. The client discovers OAuth metadata from the MCP endpoint's 401 challenge, registers a public OAuth client automatically, then opens the MVM3D sign-in and consent flow.

### ChatGPT

1. Add a custom MCP connector and enter https://mvm3d.vercel.app/mcp.
2. Choose OAuth. If asked how the OAuth client should be registered, choose automatic or dynamic client registration.
3. When MVM3D opens in a browser, sign in or create an account, review the requested permission checkboxes, and press Connect MVM3D.
4. Return to ChatGPT and test a read-only tool such as list_projects before asking it to edit scenes.

### Claude

1. Go to Customize → Connectors → Add custom connector and enter https://mvm3d.vercel.app/mcp.
2. Select OAuth, choose Register automatically when prompted, and start sign-in.
3. Sign in to MVM3D, review the scopes, and connect. Disconnect the connector from Claude when access is no longer needed.

### Grok

Use Grok's Custom MCP connector with the same URL and follow the authentication options shown in the current Grok interface. Do not confuse browser-based custom connector authorization with the xAI API/Responses API's remote-MCP configuration: an API caller-supplied authorization value does not itself create a browser login or consent screen. Verify the actual Grok custom connector flow end-to-end before treating it as connected.

The legacy static API-key endpoint remains available only for existing integrations that already have a key. It is not part of the new-user setup, and Studio's 3D stack no longer asks people to create or paste one.

## Permissions

| Scope | Permission |
|---|---|
| `project:read` | List/read owned projects, inspect objects and read scene resources. |
| `scene:write` | Create projects, geometry, materials, lights, animation clips, and edit scene objects. |
| `scene:execute` | Queue scripts for execution in the active Studio sandbox, then read the resulting diagnostics. |
| `assets:export` | Export owned projects as GLB. |

Both authentication mechanisms are scoped to the signed-in user's project ownership. Each tool verifies its required scope.

## Available MCP tools

The server registers 18 tools:

`list_projects`, `get_project`, `create_project`, `rename_project`, `read_scene`, `inspect_object`, `create_primitive`, `update_object`, `delete_object`, `create_light`, `create_material`, `create_animation_clip`, `export_project_glb`, `diagnose_project`, `render_project`, `run_script`, `get_execution_job`, and `get_ai_workflow`.

The `create_primitive` tool supports box, sphere, cylinder, cone, torus, plane, and capsule. The animation tool validates object targets, keyframe value lengths, duration limits, and interpolation modes before persisting a clip.

## MVM REGULAR and MVM ADVANCED

- **MVM REGULAR** uses the existing Three.js WebGL renderer and sandbox scene workflow.
- **MVM ADVANCED** initializes Three.js `WebGPURenderer` when the browser exposes a WebGPU adapter. It verifies the actual WebGPU backend, initializes the r186 renderer-agnostic PMREM pipeline, and only marks the mode ready after the first scene frame succeeds. If initialization or the first frame fails, it logs the reason and returns to MVM REGULAR. Renderer selection is stored locally on the current browser.
- Environment presets plus HDR/EXR environment maps use image-based lighting in both renderer modes. The common PMREM implementation enables the metal/roughness PBR materials to reflect the environment in WebGPU rather than relying only on direct lights.
- **Smoke test:** in Studio, create a project from the `MVM ADVANCED · WebGPU Diagnostic` starter, switch to MVM ADVANCED, then Run. Check metallic reflections, the procedural stripe texture, cyan emissive ring, and timeline animation. Confirm the console says the scene rendered with WebGPU; a scene appearing by itself does not prove backend identity.
- The script environment exposes core Three.js classes through `THREE`; the Studio also has camera controls, GLB import/export, PBR materials, scene hierarchy, and animation playback. WebGPU does not support WebGL-only `ShaderMaterial` / `onBeforeCompile` workflows; use Three.js TSL/node materials for future custom WebGPU shaders. This is a browser-based 3D editor, not a promise of complete Blender/Unreal feature parity.

## Script loaders and imported animation clips

The sandbox exposes the Three.js `GLTFLoader`, `OBJLoader`, `TextureLoader`, `CubeTextureLoader`, `ImageBitmapLoader`, `FileLoader` and related core loader APIs. URL-based loads are restricted to same-origin static paths under `/assets/`, `/models/`, or `/textures/`. `data:` and `blob:` sources are allowed for in-memory data; arbitrary external HTTPS URLs are blocked by design. Import files into MVM3D or add them to the app's public asset folders before loading.

A basic GLB/OBJ workflow:

```javascript
return (async () => {
  const gltf = await new THREE.GLTFLoader().loadAsync("/assets/models/robot.glb");
  scene.add(gltf.scene);

  for (const sourceClip of gltf.animations) {
    const imported = mvm.animation.importThreeClip(sourceClip, gltf.scene);
    console.log("Imported clip", imported.name, imported.trackCount);
  }

  const firstClip = gltf.animations[0];
  if (firstClip) {
    const saved = mvm.scene.list();
    const clip = mvm.animation.importThreeClip(firstClip, gltf.scene);
    mvm.animation.play(clip.id);
  }
})();
```

`mvm.animation.importThreeClip(clip, root)` currently converts rigid-object `position`, `rotation`, `scale`, and `quaternion` tracks whose target object names are unique under the specified root. Rotation values are converted from radians to MVM3D's degree-based rotation convention. Unsupported tracks are skipped with diagnostic warnings: skin deformation, morph targets, material/camera/light tracks and cubic-spline animation are not fully persisted. The base mesh geometry can still be imported, but its skeleton deformation is not retained as a fully rigged character.

For a plain OBJ asset, use `new THREE.OBJLoader().loadAsync("/assets/models/part.obj")` then add the returned object to `scene`. To parse in-memory OBJ text, use `new THREE.OBJLoader().parse(objSourceText)`.

## Separate Prompt2Model workflow

Provider API keys used for prompt-driven scene-script generation live on /Prompt2Model, not in Studio's 3D stack and not in the MCP OAuth connector flow. That page asks a configured language model to draft editable MVM3D JavaScript. Generated code is returned for review and is not executed automatically.

MVM3D OAuth authenticates the AI client's access to the MCP server; it does not authenticate an OpenAI, Anthropic, Gemini, Groq, or xAI provider account on the user's behalf.

## Production requirements and diagnostics

- Configure a persistent Postgres `DATABASE_URL` in the **production Vercel project** and verify migrations can run. MCP OAuth clients/codes, provider connections, API keys, projects, and execution jobs depend on persistent storage.
- The deployment may set `MCP_PUBLIC_URL=https://mvm3d.vercel.app`; otherwise that is the default OAuth issuer/resource base URL.
- `MCP_ALLOWED_ORIGINS` and `MCP_ALLOWED_HOSTS` may extend the exact allow lists for trusted clients; do not set permissive origins just to bypass a failed connection.
- A `401` before authorization is expected and must advertise protected-resource metadata so a compatible client can start OAuth. A `403` normally indicates a host/origin restriction or an insufficient scope. A `503` means storage or an authentication dependency is unavailable.
- Use an owned project ID returned by `list_projects` or `create_project`. Test changes with `read_scene`, then open the same cloud project in Studio and confirm the viewport, animation clip, or exported GLB.

A successful GitHub CI build verifies code generation, type-checking, configured regression tests, and lint. It is not proof that a new version has reached production or that the production database/domain configuration is correct. After deployment, test the exact public URL and OAuth flow before treating the connector as live.
