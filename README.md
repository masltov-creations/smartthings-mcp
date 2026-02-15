# SmartThings MCP (OAuth2-Enabled)

An MCP server for SmartThings with OAuth2 tokens, durable HTTPS, and a security-first architecture. Designed to be dead simple in WSL2 while still feeling dependable. Built by a human + AI collaboration (OK human thought, AI coded).

## Highlights
- OAuth2 token handling (access + refresh) with automatic refresh.
- Durable public URL via Cloudflare Tunnel, auto-starting on reboot.
- SmartApp lifecycle handling with webhook signature verification.
- Comprehensive MCP tool surface: devices, status, commands, scenes, rules.
- Hardened by default: minimal scopes, strict validation, no token leakage.

## Quickstart (WSL2)
```
./scripts/setup.sh
```
You will be prompted for your SmartThings OAuth client ID and client secret. After setup, visit `https://<your-domain>/oauth/start` once to authorize.

## SmartThings OAuth: 6-Step Checklist
1. Install the SmartThings CLI.  
   Link: [SmartThings CLI docs](https://developer.smartthings.com/docs/sdks/cli/)
2. Log in via CLI: `smartthings login`
3. Create an OAuth-In SmartApp record.  
   Link: [OAuth integrations](https://developer.smartthings.com/docs/connected-services/oauth-integrations/)
4. Use these exact choices when prompted:
   - App type: `OAuth-In App`
   - Target URL: `https://<your-domain>/smartthings`
   - Redirect URI: `https://<your-domain>/oauth/callback`
   - Scopes: `r:locations:* r:devices:* x:devices:* r:scenes:* x:scenes:* r:rules:* w:rules:*`
5. Paste the CLI output `client_id` + `client_secret` when `./scripts/setup.sh` prompts you.
6. Open `https://<your-domain>/oauth/start`, sign in, and approve access. Tokens are stored automatically.

Optional (for testing in the SmartThings app):
- Enable Developer Mode: [SmartThings app developer mode](https://developer.smartthings.com/docs/devices/enable-developer-mode/)
- Test your connected service: [Test your connected service](https://developer.smartthings.com/docs/connected-services/test-your-connected-service/)

## Status
- Core server scaffolding and security docs complete.
- One-command WSL2 setup script included.

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
