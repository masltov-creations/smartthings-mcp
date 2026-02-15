# SmartThings MCP

An MCP server for SmartThings with OAuth2 support, HTTPS, and a security-first architecture. Designed to be dead simple in WSL2 while still feeling dependable. Built by a human + AI collaboration (OK human thought, AI coded).

And now for something completely automated.

## Highlights
- OAuth2 token handling (access + refresh) with automatic refresh.
- Durable public URL via Cloudflare Tunnel, auto-starting on reboot.
- SmartApp lifecycle handling with webhook signature verification.
- Comprehensive MCP tool surface: devices, status, commands, scenes, rules.
- Hardened by default: minimal scopes, strict validation, no token leakage.
- Status endpoint that is crisp, candid, and mildly amused.
- `mcporter`-direct workflow by default (lowest complexity).
- Optional MCP gateway with named upstreams for multi-server setups.

## Quickstart (WSL2)
1. Install Git (WSL): `sudo apt-get update && sudo apt-get install -y git`
2. Clone + enter repo: `git clone https://github.com/masltov-creations/smartthings-mcp && cd smartthings-mcp`
3. Install your tunnel client (`cloudflared` or `ngrok`) in WSL2 (see `docs/SETUP.md`).
4. Run setup: `./scripts/setup.sh`
5. Authorize once: open `https://<your-domain>/oauth/start`

Windows host option: `winget install Git.Git`
Setup script runs `npm install` for you.
No domain yet? See `docs/SETUP.md` for Quick Tunnel instructions (temporary only).
Setup will prompt for Cloudflare or ngrok.
If you choose ngrok, get your static domain at https://dashboard.ngrok.com/domains and your authtoken at https://dashboard.ngrok.com/get-started/your-authtoken.
Setup also waits for local/public health readiness and can verify OAuth e2e after you authorize.

## SmartThings OAuth: 6-Step Checklist
1. Install the SmartThings CLI: [SmartThings CLI docs](https://developer.smartthings.com/docs/sdks/cli/)
2. Log in: `smartthings login`
3. Create an OAuth-In SmartApp: [OAuth integrations](https://developer.smartthings.com/docs/connected-services/oauth-integrations/)
4. Use these exact values:
Target URL: `https://<your-domain>/smartthings`
Redirect URI: `https://<your-domain>/oauth/callback`
Scopes: `r:locations:* r:devices:* x:devices:* r:scenes:* x:scenes:* r:rules:* w:rules:*`
5. Paste `client_id` + `client_secret` when `./scripts/setup.sh` prompts you.
6. Open `https://<your-domain>/oauth/start`, sign in, and approve access.

Optional (for testing in the SmartThings app):
- Enable Developer Mode: [SmartThings app developer mode](https://developer.smartthings.com/docs/devices/enable-developer-mode/)
- Test your connected service: [Test your connected service](https://developer.smartthings.com/docs/connected-services/test-your-connected-service/)

## MCP Skill
See `SKILL.md` for the MCP usage skill and operational best practices.

## OpenClaw: Install the Skill
`./scripts/setup.sh` now offers to do this automatically:
- installs `SKILL.md` to `~/.openclaw/workspace/skills/smartthings-mcp/SKILL.md`
- installs to global OpenClaw skills when `/usr/lib/node_modules/openclaw/skills` exists

Manual fallback:
```bash
mkdir -p ~/.openclaw/workspace/skills/smartthings-mcp
cp SKILL.md ~/.openclaw/workspace/skills/smartthings-mcp/SKILL.md
```

Then start a new OpenClaw session so it picks up the skill.

## OpenClaw + mcporter (Direct, Recommended)
OpenClaw does not currently use an `mcpServers` block in `~/.openclaw/openclaw.json`. Use `mcporter` to call MCP servers directly.

### 1. Add the SmartThings MCP endpoint
`./scripts/setup.sh` now offers to run this for you automatically:
```bash
npx -y mcporter config add smartthings https://<your-domain>/mcp --scope home
```
It also offers a verification pass (`mcporter config get` + `mcporter list --schema`).

Inspect available tools:
```bash
npx -y mcporter list smartthings --schema
```

Call SmartThings tools:
```bash
npx -y mcporter call --server smartthings --tool list_locations
npx -y mcporter call --server smartthings --tool list_devices
```

### 2. Add more MCP servers directly (no gateway)
```bash
npx -y mcporter config add playwright https://mcp.example.com/mcp --scope home
npx -y mcporter list playwright --schema
```

If a server needs headers:
```bash
npx -y mcporter config add playwright https://mcp.example.com/mcp \
  --header "Authorization=Bearer ${PLAYWRIGHT_MCP_TOKEN}" --scope home
```

## Optional Gateway (Advanced, Multi-Client)
Use the built-in gateway only if you need one shared MCP endpoint with named upstreams.

Enable gateway mode:
```bash
MCP_GATEWAY_ENABLED=true ./scripts/setup.sh
```

Gateway endpoint:
- `POST /mcp-gateway`

Manage upstreams:
```bash
./scripts/manage-upstreams.sh
./scripts/setup.sh upstreams
```

Example `config/upstreams.json`:
```json
{
  "upstreams": [
    {
      "name": "smartthings",
      "url": "http://localhost:8080/mcp",
      "description": "Local SmartThings MCP"
    },
    {
      "name": "playwright",
      "url": "https://mcp.example.com/mcp",
      "headers": {
        "Authorization": "Bearer ${PLAYWRIGHT_MCP_TOKEN}"
      }
    }
  ]
}
```

Call through gateway:
```bash
npx -y mcporter config add stproxy https://<your-domain>/mcp-gateway --scope home
npx -y mcporter call --server stproxy --tool gateway.list_upstreams
npx -y mcporter call --server stproxy --tool smartthings.list_locations
```

Operational notes:
- Names must be unique and use `A-Z a-z 0-9 _ -` (no dots).
- SmartThings MCP does not require auth headers by default.
- Cleanup options: `./scripts/cleanup.sh --soft|--purge` or `./scripts/setup.sh cleanup ...`.

## Status
Status endpoint: `GET /healthz`
```
{
  "ok": true,
  "service": "smartthings-mcp",
  "version": "0.1.0",
  "time": "2026-02-15T12:34:56.789Z",
  "uptimeSec": 12345,
  "mode": "operational",
  "e2e": { "status": "pass", "checkedAt": "2026-02-15T12:34:50.000Z" },
  "go": true,
  "quip": "Green across the board."
}
```
If your server doesn’t answer like that, it’s having a day.

## Architecture (High Level)
```
+----------------------+       +---------------------------+
|   MCP Clients        |  -->  |   MCP Server (Node.js)     |
|  (LLM tools / apps)  |       |  - /smartthings webhook     |
+----------------------+       |  - /oauth/start + callback  |
                               |  - MCP tools API           |
                               +-------------+-------------+
                                             |
                                             v
                               +---------------------------+
                               |   SmartThings REST APIs    |
                               +---------------------------+

Public HTTPS:
  Cloudflare Tunnel -> HTTPS hostname -> local MCP server
```

## Design Principles
- Security by default: no secrets in git, strict OAuth2 validation, minimal scopes.
- Robustness: automatic token refresh, resilient services, health checks.
- Simplicity: one-command setup and single process server (with just enough fun).

## WSL2 Support
This project is designed to run under WSL2 with systemd enabled. The setup script detects WSL2 and validates systemd before installing services.

## Repository Layout (planned)
- `SKILL.md` - MCP usage skill and best practices
- `docs/PLAN.md` - detailed implementation plan
- `docs/ARCHITECTURE.md` - system design and data flow
- `docs/THREAT_MODEL.md` - high-level threat model
- `docs/SECURITY.md` - security model and operational guidance
- `docs/SETUP.md` - installation instructions (one-command)
- `docs/REDACTION.md` - safe-sharing checklist
- `scripts/setup.sh` - one-command setup
- `src/` - server and OAuth implementation

## Contributing
This repository will accept contributions once the initial implementation is published. Focus areas include security review, SmartThings API coverage, and MCP tool design.

## License
MIT
