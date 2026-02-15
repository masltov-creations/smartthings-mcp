# SmartThings MCP Plan (OAuth2-Enabled, Robust + Dead Simple)

## Goals
- Deliver a production-grade MCP server for SmartThings.
- Use OAuth 2.0 Authorization Code flow for SmartThings (SmartApp OAuth-In).
- Provide a durable, stable HTTPS URL that survives restarts.
- Ship a one-command setup script and system services.
- Be safe to publish publicly with best-practice security defaults.

## Non-Goals
- Multi-tenant SaaS hosting. This plan targets single-tenant self-hosting first.
- Legacy SmartApp Groovy or SmartThings Classic flows.

## Key Requirements
- MCP server as the primary product; OAuth2 is the authentication path to SmartThings.
- OAuth 2.0 Authorization Code flow with exact redirect URI match.
- CSRF protection via `state`.
- Persistent token storage with automatic refresh.
- HTTPS endpoint for SmartApp webhook lifecycles.
- Durable public URL with auto-restart on reboot.
- Minimal configuration for end users.
 - Must run reliably in WSL2 (Windows Subsystem for Linux).

## Recommended Architecture
- Single Node.js service that hosts:
  - SmartApp webhook endpoint `/smartthings`.
  - OAuth callback endpoint `/oauth/callback`.
  - MCP server endpoint(s) as the core API surface.
- Cloudflare Tunnel for stable HTTPS.
- Systemd services for both tunnel and app.
- File-based encrypted or permission-restricted token store.

## Durable URL Strategy (Recommended)
- Use Cloudflare named tunnel.
- Create a DNS hostname mapped to the tunnel.
- Run `cloudflared` as a system service.
- Include a setup script that:
  - Creates or reuses tunnel.
  - Writes `config.yml` with ingress rules.
  - Sets DNS route.
  - Installs service and starts it.

## OAuth Implementation Plan
- Use Authorization Code flow with client secret.
- Enforce exact match for redirect URI.
- Generate and validate `state` for CSRF.
- Token exchange to store access + refresh tokens.
- Refresh access token before expiry and rotate refresh tokens when returned.
- Log token events without logging token values.

## SmartApp Lifecycle Handling
- `CONFIRMATION`: respond with `targetUrl`.
- `CONFIGURATION`:
  - `INITIALIZE`: define pages and permissions.
  - `PAGE`: allow device selection and preferences.
- `INSTALL`: store tokens and app instance metadata.
- `UPDATE`: refresh preferences and tokens.
- `EVENT`: consume device events.
- `UNINSTALL`: revoke tokens and clean up storage.

## MCP Server Design
- Tool surface (baseline):
  - `list_locations`
  - `list_devices`
  - `get_device_details`
  - `get_device_status`
  - `send_device_command`
  - `list_scenes`
  - `execute_scene`
  - `list_rules`
  - `get_rule_details`
  - `update_rule`
- Tool surface (optional extensions):
  - `list_rooms`
  - `list_capabilities`
  - `list_installed_apps`
  - `get_device_health`
- Input validation and scope checks for every tool.
- Avoid dynamic outbound URL fetches and untrusted redirects.

## Security Hardening Checklist
- HTTPS only.
- Strict redirect URI validation.
- `state` validation.
- No token values in logs.
- Limit scopes to minimum needed.
- Rate-limit OAuth endpoints.
- Store secrets in `.env` and never commit.
- File permissions for token store: `600`.
- Pin allowed egress to SmartThings API hostnames.
 - Maintain an allowlist for tool names and parameters (reject unknowns).
 - Validate SmartThings IDs (location, device, scene, rule) format before use.

## Service Reliability
- Systemd service for app:
  - `Restart=always`
  - `RestartSec=2`
  - `EnvironmentFile=/path/.env`
- Systemd service for Cloudflare tunnel.
- Health endpoint `/healthz` for monitoring.

## WSL2-Specific Considerations
- Assume WSL2 with systemd enabled.
- Setup script must:
  - Detect WSL2 and verify systemd is active.
  - If systemd is not active, print clear steps to enable it via `/etc/wsl.conf` and restart WSL.
- Use `systemctl` inside WSL to manage services.
- Prefer `localhost` binding for the app; Cloudflare Tunnel will reach it from WSL.
- Ensure Windows firewall allows outbound connections for `cloudflared`.

## One-Command Setup Script
- `./scripts/setup.sh` should:
  - Check prerequisites.
  - Verify WSL2 + systemd; fail fast with clear instructions if missing.
  - Create Cloudflare tunnel and DNS record.
  - Generate config files and service units.
  - Create `.env` and `.env.example`.
  - Run SmartThings CLI app create or prompt for OAuth client values.
  - Enable and start services.
- Script must be idempotent and safe to re-run.

## Testing Matrix
- OAuth flow: happy path + invalid state.
- Token refresh: forced expiry.
- Webhook lifecycles: confirmation, configuration, install, update, event, uninstall.
- Restart test: reboot host, verify tunnel and app are back.
- Scope test: remove a scope, verify API failure.

## Public Sharing Safety
- Add `.gitignore` for `.env`, token store, tunnel credentials.
- Provide `.env.example` with placeholders only.
- Provide `docs/SECURITY.md` with security model and known risks.
- Provide `docs/REDACTION.md` with safe-sharing steps:
  - Rotate secrets before sharing.
  - Scrub logs and `.env`.
  - Remove `cloudflared` credentials file.
- Optionally add secret-scanning in CI.

## Open Decisions
- Durable URL provider: Cloudflare Tunnel (recommended) or alternatives.
- Host OS and service manager (systemd vs Docker).
- Single-user vs multi-user install.

## Implementation Order
1. Scaffold Node server with SmartApp webhook + OAuth callback.
2. Implement token store + refresh logic.
3. Add MCP endpoints and SmartThings API wrapper.
4. Add Cloudflare tunnel config and service.
5. Build one-command setup script.
6. Add docs and public sharing checklist.
7. Add tests and a minimal CI pipeline.
