---
name: smartthings-mcp
description: Operate the SmartThings MCP tools for devices, scenes, and rules.
---

# SmartThings MCP Operator

**Purpose**
Operate the SmartThings MCP server confidently: connect, verify access, and use device/scene/rule tools safely.

**When To Use**
- You need to control or inspect SmartThings devices, scenes, or rules.
- You want a reliable, API-backed SmartThings integration from MCP tools.

**Prereqs**
- MCP server is running and reachable at `/mcp` over HTTPS.
- OAuth has been completed at `/oauth/start`.
- `PUBLIC_URL` and `ALLOWED_MCP_HOSTS` are set correctly.

**Endpoints**
- Health: `GET /healthz`
- OAuth start: `GET /oauth/start`
- MCP: `POST /mcp` (requires `Accept: text/event-stream` for SSE)

**OpenClaw Config (Example)**
```
{
  "mcpServers": {
    "smartthings": {
      "url": "https://<your-domain>/mcp"
    }
  }
}
```

**Quick Start**
1. Confirm health: `GET /healthz` returns `{ ok: true }`.
2. Confirm OAuth: visit `https://<your-domain>/oauth/start` once.
3. Call `list_locations` to confirm access.
4. Call `list_devices` to discover device IDs.
5. Use `get_device_status` or `send_device_command`.

**Manual MCP Test (SSE)**
Most clients (OpenClaw, MCP SDKs) handle this automatically. If you test manually, you must send `Accept: text/event-stream`:
```
curl -N \
  -H "Accept: text/event-stream" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}' \
  https://<your-domain>/mcp
```

**Tool Map**
- `list_locations`: verify OAuth and discover location IDs.
- `list_devices`: list devices, optionally by location.
- `get_device_details`: model, capabilities, and metadata for a device.
- `get_device_status`: current state values for a device.
- `send_device_command`: execute commands on a device.
- `list_scenes`: list available scenes.
- `execute_scene`: run a scene by ID.
- `list_rules`: list automation rules.
- `get_rule_details`: inspect a rule definition.
- `update_rule`: update a rule definition.

**Safety Rules**
- Ask before any destructive action: rule updates or device commands.
- Never log or return access tokens.
- Validate IDs and inputs before calling tools.

**Troubleshooting**
- `403 Host not allowed`: add your hostname to `ALLOWED_MCP_HOSTS`.
- `401` from SmartThings API: re-run OAuth at `/oauth/start`.
- Missing devices: verify OAuth scopes and reinstall the SmartApp if needed.
