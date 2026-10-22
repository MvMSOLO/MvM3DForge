# MvM 3D Forge Remote MCP (API-key authentication)

**Endpoint:** `https://mvm3dforge.vercel.app/mcp`  
**Transport:** MCP Streamable HTTP (stateless requests)  
**Authentication:** MvM 3D Forge API key in an HTTP Bearer header; OAuth is not used.

## Create an API key

1. Sign in to MvM 3D Forge and open [Studio](https://mvm3dforge.vercel.app/studio).
2. Open the **3D stack / Integrations** tab.
3. In **Remote MCP API keys**, enter a recognizable name, choose only the scopes the client needs, and set an expiry.
4. Select **Create API key**, then copy the full `mvmf_live_…` secret immediately. It is shown only once. The database stores only its SHA-256 digest; it cannot be retrieved later.
5. Revoke the key from the same panel if it is exposed or no longer needed.

Treat this key as a password. Do not commit it to Git, paste it into prompts, screenshots, or public issue reports. Prefer a separate, limited-scope key for each client.

## Available scopes

| Scope | Permission |
|---|---|
| `project:read` | List and read your saved cloud projects and inspect their scene graph. |
| `scene:write` | Create/rename projects and change scene objects, transforms, lights and materials. |
| `assets:export` | Export authorized projects as binary GLB. |

Each tool checks its required scope, and every project read/write is restricted to the authenticated user's owner ID. The project must have a persistent Postgres `DATABASE_URL` configured; the remote endpoint fails closed rather than using an ephemeral serverless database.

## Configure an MCP client

For a client that supports remote Streamable HTTP servers and custom headers, add a configuration similar to this. Replace the environment-variable placeholder using that client's supported secret mechanism; do not paste a real key into a repository-managed config.

```json
{
  "mcpServers": {
    "mvm3dforge": {
      "url": "https://mvm3dforge.vercel.app/mcp",
      "headers": {
        "Authorization": "Bearer ${MVM_MCP_KEY}"
      }
    }
  }
}
```

Some clients do not expand environment variables inside JSON configuration values. In those clients, use their documented secret/credential field or the environment-variable interpolation syntax they explicitly support.

## Smoke-test the endpoint

Set `MVM_MCP_KEY` in your shell to the API key copied from Studio. Never substitute a real key into a source file or share it in logs.

Initialize:

```bash
curl --fail-with-body -sS https://mvm3dforge.vercel.app/mcp \
  -H "Authorization: Bearer ${MVM_MCP_KEY}" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-11-25","capabilities":{},"clientInfo":{"name":"mvm-smoke-test","version":"1.0.0"}}}'
```

List tools (send the protocol version returned by initialize; this example uses the stable 2025-era version):

```bash
curl --fail-with-body -sS https://mvm3dforge.vercel.app/mcp \
  -H "Authorization: Bearer ${MVM_MCP_KEY}" \
  -H "MCP-Protocol-Version: 2025-11-25" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}'
```

A valid result should include the complete tools array. Follow it with `tools/call` using a project ID returned from `list_projects` / `create_project`; do not use an arbitrary project ID. If the endpoint returns `401`, create a new key or verify expiry/revocation. A HTTP `403` indicates a Host/Origin allow-list restriction. A tool-level response containing `Permission denied` indicates the key lacks the required scope (tool errors are returned as MCP results and may still use HTTP 200). A `503` indicates that persistent Postgres is not configured or the key store is unavailable.

## Real persistence workflow

1. Call `create_project` using an API key with `scene:write`.
2. Use the returned `projectId` with `create_primitive`, `update_object`, `create_light`, and `create_material`.
3. Call `read_scene` and confirm the returned scene includes the modifications.
4. Open Studio → **3D stack / Integrations** → **Cloud projects** → **Refresh**, then **Open** that project.
5. Confirm the same objects and values appear in the actual Three.js viewport.
6. Test `export_project_glb` and re-import the returned GLB data into a glTF viewer or Studio importer.

## Deployment configuration

- Configure `DATABASE_URL` in Vercel for the production environment and ensure the database user can create the migration table / apply migrations.
- `MCP_ALLOWED_ORIGINS` may contain comma-separated additional exact HTTPS origins for trusted browser-based clients. Same-origin preview requests are allowed only when the request host itself is trusted.
- `MCP_ALLOWED_HOSTS` may contain comma-separated exact hostnames. Known production aliases and MvM 3D Forge Vercel deployment hostnames are accepted by default.
- Do not set permissive origins to “fix” a client without understanding the trust boundary.

## Implemented tool catalog

The endpoint registers these 12 tools. The required scopes and behavior are validated by the handlers:

`list_projects`, `get_project`, `create_project`, `rename_project`, `read_scene`, `inspect_object`, `create_primitive`, `update_object`, `delete_object`, `create_light`, `create_material`, `export_project_glb`.

The protocol handler uses the official MCP TypeScript SDK's Streamable HTTP transport. A successful Vercel build alone is not an end-to-end certification; run the authenticated workflow above against the exact production deployment after changes are deployed.
