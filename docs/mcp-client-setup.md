# MvM3DForge Remote MCP Server Integration Guide

**Production Endpoint:** `https://mvm3dforge.vercel.app/mcp`
**OAuth 2.1 Resource Metadata:** `https://mvm3dforge.vercel.app/.well-known/oauth-protected-resource`
**Transport:** Streamable HTTP / JSON-RPC 2.0
**Protocol Versions:** `2024-11-05`

---

## 1. Overview

MvM3DForge exposes a remote Model Context Protocol (MCP) server allowing external AI assistants (such as Claude Desktop, Cursor, or custom MCP clients) to inspect and edit 3D projects directly in the MvM3DForge creation platform.

---

## 2. Authentication & Authorization

### Bearer Token Authentication
Every request to `https://mvm3dforge.vercel.app/mcp` requires authentication via a Bearer token or API Key:

```http
POST /mcp HTTP/1.1
Host: mvm3dforge.vercel.app
Authorization: Bearer <YOUR_MVM3DFORGE_TOKEN>
Content-Type: application/json
```

Alternatively, pass `X-API-Key: <YOUR_MVM3DFORGE_TOKEN>` header.

### Permission Scopes
The MCP server enforces granular authorization scopes on all operations:
- `project:read`: Read authorized project graph and scene objects.
- `scene:write`: Mutate scene hierarchy, create primitives, update transforms, assign materials, or delete objects.
- `assets:export`: Generate binary glTF (GLB) exports.

### OAuth 2.1 Protected Resource Metadata
External clients that support standard OAuth 2.1 discovery can fetch metadata at:
`GET https://mvm3dforge.vercel.app/.well-known/oauth-protected-resource`

---

## 3. Supported MCP Tools

The server provides 12 typed, validated 3D tools:

| Tool Name | Scope Required | Description |
|---|---|---|
| `list_projects` | `project:read` | List all authorized 3D projects for the authenticated session. |
| `get_project` | `project:read` | Retrieve complete project data including code and scene settings. |
| `create_project` | `scene:write` | Create a new project or initialize from a starter template (`blank`, `primitives`, `pbr`, `product`, `animated`). |
| `rename_project` | `scene:write` | Rename an existing project. |
| `read_scene` | `project:read` | Inspect full scene graph hierarchy, mesh objects, lights, and animation clips. |
| `inspect_object` | `project:read` | Query detailed properties, transform values, and material settings of a specific object by ID or name. |
| `create_primitive` | `scene:write` | Insert a primitive mesh (`box`, `sphere`, `cylinder`, `cone`, `torus`, `plane`) with custom transform and PBR material. |
| `update_object` | `scene:write` | Modify position, rotation, scale, visibility, or PBR color/roughness/metalness of an object. |
| `delete_object` | `scene:write` | Delete an object from the project. |
| `create_light` | `scene:write` | Add an ambient, directional, point, or spot light source. |
| `create_material` | `scene:write` | Assign PBR material settings (`color`, `roughness`, `metalness`, `emissive`) to an object. |
| `export_project_glb` | `assets:export` | Generate and validate binary glTF (GLB 2.0) file representation. |

---

## 4. Client Setup Examples

### Claude Desktop / Cursor (`mcpServers` JSON config)

```json
{
  "mvm3dforge": {
    "url": "https://mvm3dforge.vercel.app/mcp",
    "headers": {
      "Authorization": "Bearer <YOUR_MVM3DFORGE_TOKEN>"
    }
  }
}
```

### Protocol Verification via `curl`

To verify endpoint initialization:

```bash
curl -X POST https://mvm3dforge.vercel.app/mcp \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer test_token" \
  -d '{
    "jsonrpc": "2.0",
    "id": 1,
    "method": "initialize",
    "params": { "protocolVersion": "2024-11-05" }
  }'
```

To list tools:

```bash
curl -X POST https://mvm3dforge.vercel.app/mcp \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer test_token" \
  -d '{
    "jsonrpc": "2.0",
    "id": 2,
    "method": "tools/list"
  }'
```

---

## 5. Security & Isolation

- **Tenant Isolation:** All operations validate that the authenticated user owns or has explicit access to the target project. Cross-user modification attempts are rejected with `403 Forbidden`.
- **Input Validation:** All tool arguments are strictly validated using Zod schemas. Invalid payloads return standard JSON-RPC `-32602` error codes.
