# SmartThings MCP

*And now for something completely automated.*

A practical MCP server that lets MCP-capable agents talk to SmartThings safely, with OAuth2 handling, solid defaults, and one setup flow that does the heavy lifting.

Built via human + AI collaboration (human thought, AI coded).

## Start Here (60 Seconds)

```bash
git clone https://github.com/masltov-creations/smartthings-mcp && cd smartthings-mcp && ./scripts/setup.sh
```

That setup flow is the main entry point. It is designed to be rerun safely after partial/failed attempts.

After setup, authorize once:

```text
https://<your-domain>/oauth/start
```

## What Setup Handles For You

`./scripts/setup.sh` can do all of this:
- prompts for Cloudflare or ngrok tunnel configuration
- writes/updates `.env` with sane defaults
- prompts for SmartThings OAuth client credentials
- installs dependencies and builds
- installs/refreshes systemd services (MCP server + tunnel)
- optionally installs `SKILL.md` into OpenClaw locations
- optionally configures/verifies `mcporter`
- waits for local/public health endpoints
- can wait for OAuth e2e pass after you authorize

In short: setup is the intended operator workflow, not a side quest.

## What Setup Asks You For

- tunnel provider: `cloudflare` or `ngrok`
- SmartThings `client_id` + `client_secret`
- optional OpenClaw skill install
- optional `mcporter` registration/verification
- optional gateway upstream management

If using ngrok:
- static domain: https://dashboard.ngrok.com/domains
- authtoken: https://dashboard.ngrok.com/get-started/your-authtoken

## Quick Verify

```bash
curl -sS http://127.0.0.1:8080/healthz?e2e=1
npx -y mcporter list smartthings --schema
```

If `e2e.status` is `pass`, the server is ready.

## Skill (For LLMs)

Use `SKILL.md` as the operator guide for agents:
- tool routing
- progressive disclosure
- output formatting contract
- write-safety confirmation flow

If OpenClaw is detected locally, setup offers to install the skill automatically.

## Tool Highlights

### Read and query
- `list_locations`
- `list_devices`
- `list_devices_with_room_temperatures` (fast path for room/device temperature questions)
- `get_device_details`
- `get_device_status`
- `list_scenes`
- `list_rules`
- `get_rule_details`

### Write and control
- `send_device_command` (confirm first)
- `execute_scene` (confirm first)
- `update_rule` (confirm first)

## SmartThings OAuth App Checklist (Exact Values)

1. Install SmartThings CLI: https://developer.smartthings.com/docs/sdks/cli/
2. Log in: `smartthings login`
3. Create OAuth-In SmartApp: https://developer.smartthings.com/docs/connected-services/oauth-integrations/
4. Use:
- Target URL: `https://<your-domain>/smartthings`
- Redirect URI: `https://<your-domain>/oauth/callback`
- Scopes: `r:locations:* r:devices:* x:devices:* r:scenes:* x:scenes:* r:rules:* w:rules:*`
5. Paste `client_id` + `client_secret` into setup when asked.
6. Complete authorization at `/oauth/start`.

Optional mobile testing:
- Enable developer mode: https://developer.smartthings.com/docs/devices/enable-developer-mode/
- Test connected service: https://developer.smartthings.com/docs/connected-services/test-your-connected-service/

## OpenClaw + mcporter

Register server:

```bash
npx -y mcporter config add smartthings https://<your-domain>/mcp --scope home
```

List tools:

```bash
npx -y mcporter list smartthings --schema
```

Sample calls:

```bash
npx -y mcporter call --server smartthings --tool list_locations
npx -y mcporter call --server smartthings --tool list_devices
npx -y mcporter call --server smartthings --tool list_devices_with_room_temperatures
```

## Optional: Gateway Mode (Advanced)

Use this only if you want one MCP endpoint with named upstreams.

Enable:

```bash
MCP_GATEWAY_ENABLED=true ./scripts/setup.sh
```

Manage upstreams:

```bash
./scripts/manage-upstreams.sh
./scripts/setup.sh upstreams
```

Gateway endpoint:
- `POST /mcp-gateway`

## Common Operations

Update runtime install and restart:

```bash
cd /home/$USER/apps/smartthings-mcp && git pull --ff-only origin main && npm run build && sudo systemctl restart smartthings-mcp
```

Re-run setup safely:

```bash
cd /home/$USER/apps/smartthings-mcp && ./scripts/setup.sh
```

Install skill manually (workspace):

```bash
install -Dm644 SKILL.md ~/.openclaw/workspace/skills/smartthings-mcp/SKILL.md
```

## Troubleshooting (Quick Hits)

- `redirect_uri could not be validated`
  Redirect URI in SmartThings app must exactly match `https://<your-domain>/oauth/callback`.

- `dial tcp 127.0.0.1:8080: connect: connection refused`
  Service is down or restarting. Check `systemctl status smartthings-mcp`.

- `SSE error` / `406 Not Acceptable`
  MCP endpoint requires `Accept: text/event-stream` for manual calls.

- `401` from SmartThings API
  Re-run `/oauth/start` and complete authorization again.

- Temperature queries feel slow
  Use `list_devices_with_room_temperatures` before per-device status fan-out.

## Security Notes

- No secrets should be committed.
- OAuth token refresh is automatic server-side.
- Host/origin checks are enforced.
- Write actions should always require explicit user confirmation in the agent layer.

## Architecture (High Level)

```text
MCP client -> SmartThings MCP -> SmartThings APIs
                      |
                OAuth2 + token refresh
                      |
          optional tunnel (Cloudflare/ngrok)
```

## WSL Notes

WSL2 + systemd is the recommended runtime for durable services.

Windows host Git option:

```bash
winget install Git.Git
```

## License

MIT
