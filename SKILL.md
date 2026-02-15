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
- For OpenClaw MCP calls: use `mcporter` (bundled OpenClaw skill/CLI workflow).

**Endpoints**
- Health: `GET /healthz`
- OAuth start: `GET /oauth/start`
- MCP (SmartThings): `POST /mcp` (requires `Accept: text/event-stream` for SSE)
- MCP (Gateway): `POST /mcp-gateway` (named upstreams, also SSE)

**Quick Start**
1. Resolve endpoint from local config first:
```
npx -y mcporter config get smartthings --json
```
If missing, derive from repo `.env`:
```
BASE_URL="$(grep '^PUBLIC_URL=' .env | cut -d= -f2)"
```
2. Confirm health: `GET /healthz` returns `{ ok: true }`.
3. Confirm OAuth: visit `https://<your-domain>/oauth/start` once.
4. Call `list_locations` to confirm access.
5. Call `list_devices` to discover device IDs.
6. Use `get_device_status` or `send_device_command`.

**OpenClaw + MCP Direct Workflow (Recommended)**
OpenClaw does not use an `mcpServers` section in `~/.openclaw/openclaw.json`. Use `mcporter`:
1. Add SmartThings MCP endpoint:
```
npx -y mcporter config add smartthings https://<your-domain>/mcp --scope home
```
2. Confirm tool list:
```
npx -y mcporter list smartthings --schema
```
3. Call SmartThings tools:
```
npx -y mcporter call --server smartthings --tool list_locations
npx -y mcporter call --server smartthings --tool list_devices
```

**Optional Gateway Mode (Advanced)**
Use `/mcp-gateway` only when you need one endpoint for multiple upstream MCP servers.
1. Enable gateway in this service:
```
MCP_GATEWAY_ENABLED=true ./scripts/setup.sh
```
2. Add upstreams:
```
./scripts/manage-upstreams.sh --add
```
3. Call namespaced tools through the proxy:
```
npx -y mcporter config add stproxy https://<your-domain>/mcp-gateway --scope home
npx -y mcporter call --server stproxy --tool gateway.list_upstreams
npx -y mcporter call --server stproxy --tool smartthings.list_locations
```

**Manual MCP Test (SSE)**
Most clients (OpenClaw, MCP SDKs) handle this automatically. If you test manually, you must send `Accept: text/event-stream`:
```
curl -N \
  -H "Accept: text/event-stream" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}' \
  https://<your-domain>/mcp
```

Gateway test:
```
curl -N \
  -H "Accept: text/event-stream" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}' \
  https://<your-domain>/mcp-gateway
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

Gateway mode adds a namespace prefix:
- `smartthings.list_locations`
- `smartthings.get_device_status`

**Safety Rules**
- Ask before any destructive action: rule updates or device commands.
- Never log or return access tokens.
- Validate IDs and inputs before calling tools.

**Troubleshooting**
- `403 Host not allowed`: add your hostname to `ALLOWED_MCP_HOSTS`.
- `401` from SmartThings API: re-run OAuth at `/oauth/start`.
- Missing devices: verify OAuth scopes and reinstall the SmartApp if needed.
- Gateway tool not found: use namespaced tools (`<upstream>.<tool>`) and ensure `config/upstreams.json` includes that upstream.
- `SSE error: Non-200 status code (400)` on `mcporter call`: pull latest, rerun `./scripts/setup.sh` (it re-registers mcporter), and restart `smartthings-mcp.service`.
