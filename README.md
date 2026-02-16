# SmartThings MCP

*And now for something completely automated.*

A small, sturdy MCP server that lets MCP-capable AI agents (including ChatGPT, Claude, OpenClaw, and friends) talk to your SmartThings home—without duct-taping API calls together in the dark.

## What this thing is (and why it exists)
SmartThings MCP is a bridge between:
- **MCP clients** (ChatGPT, Claude, OpenClaw, other MCP-capable agents, and your own automations)
- **Your SmartThings account**

In plain English: it gives your assistant a safe, structured way to **see devices, read state, run commands, launch scenes, and work with rules**.

It exists so you can stop manually poking dashboards and start saying things like:
- “List all my locations.”
- “Turn off the office lights.”
- “Run Movie Night scene.”
- “Show me device status that isn’t behaving.”

All with one service endpoint and a minimum of ceremonial chanting.

## How it works (the not-magic)
1. You run this server (typically in **WSL2**).
2. You expose it securely over HTTPS (usually via **Cloudflare Tunnel** or **ngrok**).
3. You create a SmartThings OAuth SmartApp pointed at this server.
4. You authorize once.
5. The server stores and refreshes OAuth tokens automatically.
6. MCP clients call the server’s tool endpoints; the server talks to SmartThings APIs on your behalf.

That’s it. No hand-rolled token scripts. No “why did this expire at 2:14 AM?” surprises.

## What you need before setup
- **Node.js 18+**
- **Git**
- **WSL2 with systemd** (recommended path)
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

If you do not yet have a domain, check `docs/SETUP.md` for temporary Quick Tunnel guidance.

## SmartThings OAuth app setup (6 short steps)
1. Install SmartThings CLI: [SmartThings CLI docs](https://developer.smartthings.com/docs/sdks/cli/)
2. Log in:
   ```bash
   smartthings login
   ```
3. Create an OAuth-In SmartApp: [OAuth integrations](https://developer.smartthings.com/docs/connected-services/oauth-integrations/)
4. Use these values exactly:
   - **Target URL:** `https://<your-domain>/smartthings`
   - **Redirect URI:** `https://<your-domain>/oauth/callback`
   - **Scopes:** `r:locations:* r:devices:* x:devices:* r:scenes:* x:scenes:* r:rules:* w:rules:*`
5. Paste the resulting `client_id` and `client_secret` when `./scripts/setup.sh` asks.
6. Open `https://<your-domain>/oauth/start`, sign in, and approve access.

Optional for testing in the mobile app:
- [Enable Developer Mode](https://developer.smartthings.com/docs/devices/enable-developer-mode/)
- [Test your connected service](https://developer.smartthings.com/docs/connected-services/test-your-connected-service/)

## What this enables you to do
Once connected, your MCP client can:
- Discover locations and devices
- Read current device status/state
- Send device commands
- Run scenes
- Read and manage rules

In practical terms: your AI assistant can help you *operate* your home setup, not just discuss it politely.

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
```

`./scripts/setup.sh` can do most of this for you automatically, including optional verification.

## Optional: install the SmartThings skill for OpenClaw
Setup can install it automatically. Manual fallback:

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

If health is green, you’re in business. If not, the server will be candid about it (with just a hint of attitude).

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
- **Security by default**
- **Reliable automation over heroic manual fixes**
- **Simple setup with sensible defaults**
- **Serious engineering, unserious tone (in moderation)**

## Repository layout
- `SKILL.md` — MCP usage skill and operational best practices
- `docs/SETUP.md` — installation instructions
- `docs/ARCHITECTURE.md` — design and data flow
- `docs/SECURITY.md` — security model and operational guidance
- `scripts/setup.sh` — one-command setup
- `src/` — server and OAuth implementation

## Contributing
Contributions are welcome after initial publication focus areas land. High-value areas include:
- Security review
- SmartThings API/tool coverage
- Reliability and observability improvements

## License
MIT
