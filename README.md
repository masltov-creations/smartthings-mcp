# SmartThings MCP (OAuth2-Enabled)

An MCP server for SmartThings with OAuth 2.0 Authorization Code flow, durable HTTPS endpoint, and a security-first architecture. Designed to be dead simple to deploy in WSL2 while remaining robust enough for real-world use.

## Highlights
- OAuth 2.0 Authorization Code flow with strict redirect URI matching and CSRF protection.
- Durable public URL via Cloudflare Tunnel, auto-starting on reboot.
- SmartApp lifecycle handling with safe defaults.
- Comprehensive MCP tool surface: devices, status, commands, scenes, rules.
- Hardened by default: minimal scopes, strict validation, no token leakage.

## Quickstart (WSL2)
```
./scripts/setup.sh
```
You will be prompted for your SmartThings OAuth client ID and client secret.

## Status
- Core server scaffolding and security docs complete.
- One-command WSL2 setup script included.

## Architecture (High Level)
```
+----------------------+       +---------------------------+
|   MCP Clients        |  -->  |   MCP Server (Node.js)     |
|  (LLM tools / apps)  |       |  - /smartthings webhook     |
+----------------------+       |  - /oauth/callback         |
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
- Simplicity: one-command setup and single process server.

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
