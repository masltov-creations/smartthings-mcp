# SmartThings MCP

*And now for something completely automated.*

A small, sturdy MCP server that lets MCP-capable AI agents (including ChatGPT, Claude, OpenClaw, and friends) talk to your SmartThings home without duct-taping API calls together in the dark.

Built as a human + AI collaboration (OK human thought, AI coded).

## What this thing is (and why it exists)
SmartThings MCP is a bridge between:
- MCP clients (ChatGPT, Claude, OpenClaw, other MCP-capable agents, and your own automations)
- Your SmartThings account

In plain English: it gives your assistant a safe, structured way to see devices, read state, run commands, launch scenes, and work with rules.

## How it works (the not-magic)
1. You run this server (typically in WSL2).
2. You expose it securely over HTTPS (usually via Cloudflare Tunnel or ngrok).
3. You create a SmartThings OAuth SmartApp pointed at this server.
4. You authorize once.
5. The server stores and refreshes OAuth tokens automatically.
6. MCP clients call MCP tools; the server talks to SmartThings APIs on your behalf.

## What you need before setup
- Node.js 18+
- Git
- WSL2 with systemd (recommended path)
- A public HTTPS hostname (Cloudflare Tunnel or ngrok)
- A SmartThings developer setup so you can create an OAuth SmartApp

## Quickstart (WSL2)
1. Install Git:
   ```bash
   sudo apt-get update && sudo apt-get install -y git
   ```
2. Clone and enter the repo:
   ```bash
   git clone https://github.com/masltov-creations/smartthings-mcp
   cd smartthings-mcp
   ```
3. Make sure your tunnel is ready (`cloudflared` or `ngrok`) — see `docs/SETUP.md`.
4. Run setup:
   ```bash
   ./scripts/setup.sh
   ```
5. Authorize once in your browser:
   ```text
   https://<your-domain>/oauth/start
   ```

Windows host option for Git:
```bash
winget install Git.Git
```

Setup prompts for Cloudflare/ngrok, waits for health checks, and can verify OAuth e2e after you authorize.

If you choose ngrok:
- static domain: https://dashboard.ngrok.com/domains
- authtoken: https://dashboard.ngrok.com/get-started/your-authtoken

## SmartThings OAuth app setup (6 short steps)
1. Install SmartThings CLI: [SmartThings CLI docs](https://developer.smartthings.com/docs/sdks/cli/)
2. Log in:
   ```bash
   smartthings login
   ```
3. Create an OAuth-In SmartApp: [OAuth integrations](https://developer.smartthings.com/docs/connected-services/oauth-integrations/)
4. Use these values exactly:
   - Target URL: `https://<your-domain>/smartthings`
   - Redirect URI: `https://<your-domain>/oauth/callback`
   - Scopes: `r:locations:* r:devices:* x:devices:* r:scenes:* x:scenes:* r:rules:* w:rules:*`
5. Paste `client_id` and `client_secret` when `./scripts/setup.sh` asks.
6. Open `https://<your-domain>/oauth/start`, sign in, and approve access.

Optional for testing in the mobile app:
- [Enable Developer Mode](https://developer.smartthings.com/docs/devices/enable-developer-mode/)
- [Test your connected service](https://developer.smartthings.com/docs/connected-services/test-your-connected-service/)

## MCP Skill (For LLMs)
Use `SKILL.md` as the LLM-facing guide for this MCP:
- tool selection
- safety constraints
- consistent human-first response formatting

If you integrate this MCP with an agent, point that agent at `SKILL.md`.

## MCP client integration (ChatGPT, Claude, OpenClaw, and others)
This server works with any AI agent/client that supports MCP.

For OpenClaw specifically, direct MCP endpoints via `mcporter` are currently the most reliable path.

Add this server:
```bash
npx -y mcporter config add smartthings https://<your-domain>/mcp --scope home
```

Inspect tools:
```bash
npx -y mcporter list smartthings --schema
```

Call tools:
```bash
npx -y mcporter call --server smartthings --tool list_locations
npx -y mcporter call --server smartthings --tool list_devices
npx -y mcporter call --server smartthings --tool list_devices_with_room_temperatures
```

If your prompt is "what temperature is the room each device is in?", use `list_devices_with_room_temperatures` instead of per-device status loops.

`./scripts/setup.sh` can configure mcporter for you automatically.

## OpenClaw skill install
`./scripts/setup.sh` now checks whether OpenClaw is installed locally and offers to install the skill when detected.

It installs:
- `SKILL.md` to `~/.openclaw/workspace/skills/smartthings-mcp/SKILL.md`
- `SKILL.md` to `/usr/lib/node_modules/openclaw/skills/smartthings-mcp/SKILL.md` when that path exists

No local OpenClaw detected: setup skips the prompt by default.

Manual fallback:
```bash
mkdir -p ~/.openclaw/workspace/skills/smartthings-mcp
cp SKILL.md ~/.openclaw/workspace/skills/smartthings-mcp/SKILL.md
```

Then start a new OpenClaw session.

## Optional gateway mode (advanced)
If you want one shared endpoint with multiple named upstream MCP servers, enable gateway mode:

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

## Security + operational behavior
- OAuth2 access + refresh tokens with automatic refresh
- SmartApp webhook signature verification
- Minimal scopes and strict validation
- No secret leakage in normal logs
- Health endpoint for quick readiness checks

Health endpoint:
- `GET /healthz`

Performance tuning env vars:
- `SMARTTHINGS_REQUEST_TIMEOUT_MS`
- `ROOM_TEMP_CACHE_TTL_SEC`
- `ROOM_TEMP_STATUS_CONCURRENCY`

## Architecture (high level)
```text
+----------------------+       +----------------------------+
|   MCP Clients        |  -->  |   MCP Server (Node.js)     |
| (LLM tools / apps)   |       |  - /smartthings webhook    |
+----------------------+       |  - /oauth/start + callback |
                               |  - MCP tools API           |
                               +-------------+--------------+
                                             |
                                             v
                               +----------------------------+
                               |   SmartThings REST APIs    |
                               +----------------------------+

Public HTTPS:
  Cloudflare Tunnel -> HTTPS hostname -> local MCP server
```

## Design principles
- Security by default
- Reliable automation over heroic manual fixes
- Simple setup with sensible defaults
- Serious engineering, unserious tone (in moderation)

## Repository layout
- `SKILL.md` — MCP usage skill and operational best practices
- `docs/SETUP.md` — installation instructions
- `docs/ARCHITECTURE.md` — design and data flow
- `docs/SECURITY.md` — security model and operational guidance
- `scripts/setup.sh` — one-command setup
- `src/` — server and OAuth implementation

## Contributing
Contributions are welcome.

## License
MIT
