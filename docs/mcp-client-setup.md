# MVM3D: Remote MCP, AI providers, and rendering modes

**MCP endpoint:** `https://mvm3d.vercel.app/mcp`  
**Transport:** MCP Streamable HTTP  
**Primary authentication:** OAuth 2.1 authorization code flow with PKCE (S256)  
**Compatibility authentication:** user-scoped MVM3D API key as a Bearer token

## Connect ChatGPT using only the endpoint URL

After this branch is deployed to the production project:

1. In ChatGPT, add a custom MCP connector and enter `https://mvm3d.vercel.app/mcp`.
2. Select **OAuth** as the authentication method. Do not paste a static MVM3D API key into the OAuth form.
3. Follow the MVM3D sign-in and consent screen and approve only the permissions needed for the connector.
4. Once authorization completes, ChatGPT receives a scoped, short-lived OAuth access token and calls the same `/mcp` endpoint.

The server publishes the OAuth authorization-server metadata at:

- `https://mvm3d.vercel.app/.well-known/oauth-authorization-server`
- `https://mvm3d.vercel.app/.well-known/oauth-protected-resource`
- `https://mvm3d.vercel.app/.well-known/oauth-protected-resource/mcp`

The MCP endpoint returns a `401` `WWW-Authenticate` challenge that identifies the protected-resource metadata. The OAuth implementation supports authorization codes with PKCE S256, client metadata documents for ChatGPT, and dynamic client registration. Access tokens are audience-bound to `https://mvm3d.vercel.app/mcp`, include user and permission claims, and expire after one hour. Authorization codes are short-lived, single-use, and PKCE-verified.

If ChatGPT reports that it cannot discover OAuth settings, first confirm these metadata URLs return JSON on the deployed production domain. If the endpoint returns `503`, check the persistent database and deployment configuration rather than switching to unauthenticated writes.

## Compatibility: create an API key for other MCP clients

For clients that require a manually configured Bearer header:

1. Sign in at [MVM3D Studio](https://mvm3d.vercel.app/studio) and open **Integrations → Remote MCP API keys**.
2. Enter a recognizable name, select the minimum required scopes, and set an expiry.
3. Create the key and copy the secret immediately. It is displayed only once; storage keeps a digest, not the original secret.
4. Revoke it when it is no longer needed.

Example for clients that support server headers and their own secret interpolation:

```json
{
  "mcpServers": {
    "mvm3d": {
      "url": "https://mvm3d.vercel.app/mcp",
      "headers": {
        "Authorization": "Bearer ${MVM_MCP_KEY}"
      }
    }
  }
}
```

Do not commit real API keys to Git or put them into prompts, screenshots, issue trackers, or shared config files.

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
- **MVM ADVANCED** initializes Three.js `WebGPURenderer` when the browser exposes a WebGPU adapter. If WebGPU is not available, the Studio reports the issue and returns to MVM REGULAR. Renderer selection is stored locally on the current browser.
- The script environment exposes core Three.js classes through `THREE`; the Studio also has a viewport, camera controls, GLB import/export, PBR materials, scene hierarchy, and animation playback. This is a browser-based 3D editor, not a promise of complete Blender/Unreal feature parity.

## Configure AI providers and select a model

In **Studio → Integrations → MVM AI Workbench**, connect your own provider API key. The application tests the key by querying the provider's model endpoint and shows the available chat models. Select a model and the choice is saved per user. Supported providers:

- OpenAI
- Anthropic
- Google Gemini
- Groq
- OpenRouter
- DeepSeek
- Mistral AI
- xAI
- Together AI

Provider keys are encrypted server-side and never included in the provider-list response. Generated code is returned for review; it is **not executed automatically**. Apply the generated script to the editor and run it only after checking it.

## Production requirements and diagnostics

- Configure a persistent Postgres `DATABASE_URL` in the **production Vercel project** and verify migrations can run. MCP OAuth clients/codes, provider connections, API keys, projects, and execution jobs depend on persistent storage.
- The deployment may set `MCP_PUBLIC_URL=https://mvm3d.vercel.app`; otherwise that is the default OAuth issuer/resource base URL.
- `MCP_ALLOWED_ORIGINS` and `MCP_ALLOWED_HOSTS` may extend the exact allow lists for trusted clients; do not set permissive origins just to bypass a failed connection.
- A `401` indicates missing/expired/invalid authentication and should advertise protected-resource metadata. A `403` normally indicates a host/origin restriction or an insufficient scope. A `503` means storage or an authentication dependency is unavailable.
- Use an owned project ID returned by `list_projects` or `create_project`. Test changes with `read_scene`, then open the same cloud project in Studio and confirm the viewport, animation clip, or exported GLB.

A successful GitHub CI build verifies code generation, type-checking, configured regression tests, and lint. It is not proof that a new version has reached production or that the production database/domain configuration is correct. After deployment, test the exact public URL and OAuth flow before treating the connector as live.
