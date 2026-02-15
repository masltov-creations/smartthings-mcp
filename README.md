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
If you choose ngrok, have a static domain and authtoken ready.

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
OpenClaw skills are Markdown files with YAML frontmatter, loaded from these locations (in order): `<workspace>/skills`, `~/.openclaw/skills`, then bundled skills. You can also add extra skill folders via `skills.load.extraDirs` in `~/.openclaw/openclaw.json`.

Option A (recommended for local use):
```
mkdir -p ~/.openclaw/skills/smartthings-mcp
cp SKILL.md ~/.openclaw/skills/smartthings-mcp/SKILL.md
```

Option B (workspace skill):
```
mkdir -p <workspace>/skills/smartthings-mcp
cp SKILL.md <workspace>/skills/smartthings-mcp/SKILL.md
```

Then start a new OpenClaw session so it picks up the new skill.

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
