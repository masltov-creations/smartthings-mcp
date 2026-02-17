# SmartThings MCP

*And now for something completely automated.*

A practical MCP server for SmartThings with OAuth2, durable HTTPS tunnel support, and setup automation that does the boring bits for you.

Built via human + AI collaboration (human thought, AI coded).

## Start Here (60 Seconds)

```bash
git clone https://github.com/masltov-creations/smartthings-mcp && cd smartthings-mcp && ./scripts/setup.sh
```

Then authorize once:

```text
https://<your-domain>/oauth/start
```

## What Setup Handles For You

`./scripts/setup.sh` is the primary workflow and is safe to rerun.

It can:
- configure Cloudflare or ngrok tunnel settings
- write/update `.env` defaults
- collect SmartThings OAuth client credentials
- install dependencies and build
- install/refresh systemd services (server + tunnel)
- optionally install `SKILL.md` for OpenClaw
- optionally configure and verify `mcporter`
- wait for local/public health readiness
- optionally wait for OAuth e2e pass after authorization

## What Setup Asks You For

- tunnel provider (`cloudflare` or `ngrok`)
- ngrok domain + authtoken (if ngrok selected)
- SmartThings `client_id` + `client_secret`
- optional OpenClaw skill install
- optional `mcporter` registration/verification
- optional gateway upstream management

## Provider Access Checklist

1. Install SmartThings CLI: https://developer.smartthings.com/docs/sdks/cli/
2. Log in: `smartthings login`
3. Create OAuth-In SmartApp: https://developer.smartthings.com/docs/connected-services/oauth-integrations/
4. Use these exact values:
- Target URL: `https://<your-domain>/smartthings`
- Redirect URI: `https://<your-domain>/oauth/callback`
- Scopes: `r:locations:* r:devices:* x:devices:* r:scenes:* x:scenes:* r:rules:* w:rules:*`
5. Paste credentials into setup when prompted.
6. Authorize at `/oauth/start`.

ngrok links:
- domains: https://dashboard.ngrok.com/domains
- authtoken: https://dashboard.ngrok.com/get-started/your-authtoken

## Quick Verify

```bash
curl -sS http://127.0.0.1:8080/healthz?e2e=1
npx -y mcporter list smartthings --schema
```

If `e2e.status` is `pass`, you are in business.

## Skill (For LLMs)

Use `SKILL.md` as the operator guide:
- tool routing
- progressive disclosure
- output formatting contract
- write-safety confirmation flow

Setup can install this automatically when OpenClaw is detected.

## Tool Highlights

### Read/query
- `list_locations`
- `list_devices`
- `list_devices_with_room_temperatures`
- `get_device_details`
- `get_device_status`
- `list_scenes`
- `list_rules`
- `get_rule_details`

### Write/control
- `send_device_command` (confirm first)
- `execute_scene` (confirm first)
- `update_rule` (confirm first)

## Fast Query Examples

```bash
# Device + room temperature summary (fast path)
npx -y mcporter call --server smartthings --tool list_devices_with_room_temperatures

# Device inventory
npx -y mcporter call --server smartthings --tool list_devices

# Device details
npx -y mcporter call --server smartthings --tool get_device_details deviceId=<uuid>
```

## OpenClaw + mcporter

Register server:

```bash
npx -y mcporter config add smartthings https://<your-domain>/mcp --scope home
```

List tools:

```bash
npx -y mcporter list smartthings --schema
```

## Optional Integrations

If you want one shared endpoint with named upstreams:

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

Install workspace skill manually:

```bash
install -Dm644 SKILL.md ~/.openclaw/workspace/skills/smartthings-mcp/SKILL.md
```

## Troubleshooting (Quick Hits)

- `redirect_uri could not be validated`
  Redirect URI must exactly match `https://<your-domain>/oauth/callback`.

- `dial tcp 127.0.0.1:8080: connect: connection refused`
  Service is down/restarting. Check `systemctl status smartthings-mcp`.

- `406` / SSE errors
  MCP endpoint expects `Accept: text/event-stream` for manual calls.

- `401` from SmartThings API
  Re-run `/oauth/start` and complete authorization.

- Temperature questions are slow
  Use `list_devices_with_room_temperatures` before per-device status loops.

## Security Notes

- Keep secrets in `.env`, never in git.
- OAuth token refresh is automatic server-side.
- Host/origin checks are enforced.
- Agent layer should require explicit confirmation before write actions.

## Architecture (High Level)

```text
MCP client -> SmartThings MCP -> SmartThings APIs
                      |
                OAuth2 + token refresh
                      |
      optional public tunnel (Cloudflare/ngrok)
```

## License

MIT
