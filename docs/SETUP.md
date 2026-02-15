# Setup (WSL2 First)

This project targets WSL2 with systemd enabled. A single command performs the full setup: tunnel, services, and configuration.

## Prerequisites
- WSL2 with systemd enabled
- Node.js (LTS)
- SmartThings CLI (optional for app registration)
- Cloudflare account and domain (for durable URL)
- Cloudflared installed in WSL2

## WSL2 Systemd Check
Ensure `/etc/wsl.conf` contains:
```
[boot]
systemd=true
```
Then restart WSL.

## One-Command Setup
```
./scripts/setup.sh
```

Direct upstream manager mode from setup script:
```
./scripts/setup.sh upstreams
```

Cleanup mode from setup script:
```
./scripts/setup.sh cleanup --soft
./scripts/setup.sh cleanup --purge --dry-run
```

The setup script will:
- Create or reuse a Cloudflare Tunnel
- Create DNS for a stable hostname
- Generate config and systemd unit files
- Create `.env` and `.env.example`
- Default to direct MCP mode (`/mcp`) for simpler `mcporter` usage
- Optionally enable gateway mode (`/mcp-gateway`) when `MCP_GATEWAY_ENABLED=true`
- Enable and start services

Service unit templates are available in `systemd/` for reference.

### Tunnel Provider Prompt
The setup script will prompt for a tunnel provider:
- `cloudflare` (recommended)
- `ngrok` (static domain + authtoken required)

If you choose `ngrok`, get these values first:
- Static domain (`NGROK_DOMAIN`): https://dashboard.ngrok.com/domains
- Authtoken (`NGROK_AUTHTOKEN`): https://dashboard.ngrok.com/get-started/your-authtoken

You can also preseed via env vars:
- `TUNNEL_PROVIDER=cloudflare|ngrok`
- `HOSTNAME=st-mcp.example.com` (Cloudflare)
- `NGROK_DOMAIN=my-app.ngrok-free.app` (ngrok)
- `NGROK_AUTHTOKEN=...` (ngrok)
- `MCP_GATEWAY_ENABLED=true|false` (default: `false`)
- `MANAGE_UPSTREAMS_NOW=y|n` (open or skip upstream manager prompt)
- `INSTALL_OPENCLAW_SKILL=true|false` (default prompt: yes)
- `CONFIGURE_MCPORTER=true|false` (default prompt: yes)
- `VERIFY_MCPORTER=true|false` (default prompt: yes when mcporter is configured)
- `MCPORTER_SERVER_NAME=smartthings` (mcporter alias to create/update)

To force re-entering SmartThings credentials on re-run:
- `FORCE_REENTER_CREDS=true ./scripts/setup.sh`

## After Setup
During setup you will be prompted for:
- `SMARTTHINGS_CLIENT_ID`
- `SMARTTHINGS_CLIENT_SECRET`

Create an OAuth-In SmartApp in SmartThings Developer Workspace and copy the client ID/secret. Set the SmartApp target URL to:
```
https://your-domain.example/smartthings
```

If you update `.env` later, restart the service:
```
sudo systemctl restart smartthings-mcp.service
```

Setup can also handle OpenClaw wiring in one run:
- Install `SKILL.md` into `~/.openclaw/workspace/skills/smartthings-mcp/SKILL.md`.
- Install `SKILL.md` into `/usr/lib/node_modules/openclaw/skills/smartthings-mcp/SKILL.md` when global OpenClaw exists.
- Create/update a `mcporter` server entry using your configured public endpoint.
- Verify that `mcporter` points at the expected URL and can list tools.

## Default Mode: Direct MCP (Recommended)
Use `mcporter` to call SmartThings directly at `/mcp`.

Example:
```bash
npx -y mcporter config add smartthings https://<your-domain>/mcp --scope home
npx -y mcporter list smartthings --schema
npx -y mcporter call --server smartthings --tool list_locations
```

## Gateway: Named Upstreams (Optional Advanced Mode)
The gateway provides a single MCP endpoint that routes to multiple MCP servers using namespaced tools: `<upstream>.<tool>`.

Default endpoints:
- SmartThings MCP: `/mcp`
- Gateway (multi-upstream): `/mcp-gateway`

Enable gateway mode:
```bash
MCP_GATEWAY_ENABLED=true ./scripts/setup.sh
```

Config lives in `config/upstreams.json`. Edit this file to add/remove upstreams:
```
{
  "upstreams": [
    {
      "name": "smartthings",
      "url": "http://localhost:8080/mcp",
      "description": "Local SmartThings MCP"
    }
  ]
}
```

Notes:
- Names must be unique and use `A-Z a-z 0-9 _ -` (no dots).
- SmartThings MCP does **not** require auth headers by default.
- If an upstream requires auth, add static headers:
```
{
  "name": "example",
  "url": "https://mcp.example.com/mcp",
  "headers": {
    "Authorization": "Bearer ${EXAMPLE_MCP_TOKEN}"
  }
}
```
- Reload by restarting the service or call the tool `gateway.reload_upstreams`.

Disable gateway mode later:
```bash
MCP_GATEWAY_ENABLED=false ./scripts/setup.sh
```

### Upstream Config Manager
You can manage namespaces anytime without re-running full setup:
```
./scripts/manage-upstreams.sh
```

Or via the setup script passthrough:
```
./scripts/setup.sh upstreams
```

Available commands:
```
./scripts/manage-upstreams.sh --list
./scripts/manage-upstreams.sh --view
./scripts/manage-upstreams.sh --add
./scripts/manage-upstreams.sh --remove
./scripts/manage-upstreams.sh --edit
./scripts/manage-upstreams.sh --reset
./scripts/manage-upstreams.sh --ensure-smartthings
```

## Cleanup / Uninstall Options
Use cleanup when you want to stop services or remove generated runtime/config artifacts.

Soft cleanup (safe default, keep configs/secrets):
```
./scripts/cleanup.sh --soft
```

Purge cleanup (remove service units and generated local files):
```
./scripts/cleanup.sh --purge
```

Purge and also remove `.env`:
```
./scripts/cleanup.sh --purge --remove-env
```

Preview without changes:
```
./scripts/cleanup.sh --purge --dry-run
```

You can also call cleanup through setup:
```
./scripts/setup.sh cleanup --purge --dry-run
```

To make the gateway the primary endpoint, set:
- `MCP_GATEWAY_PATH=/mcp`
- `MCP_HTTP_PATH=/mcp-smartthings`

## Logs
By default logs are written to:
```
data/smartthings-mcp.log
```
You can change the path via `LOG_FILE` in `.env`.

## E2E Health Check (Green Signal)
The service performs a lightweight E2E check (SmartThings `list_locations`) on a timer and exposes the result:
```
GET /healthz
```
To force an immediate E2E check:
```
GET /healthz?e2e=1
```

## Cloudflare Tunnel (Manual, Step-by-Step)
If you prefer to set up Cloudflare Tunnel yourself, follow this exact sequence:

1. Add your domain to Cloudflare and point your nameservers to Cloudflare.  
   Reference: [Add a site to Cloudflare](https://developers.cloudflare.com/dns/zone-setups/full-setup/setup/)
2. Install `cloudflared` for Linux (WSL2). Use Cloudflare’s downloads page for the latest method.  
   Reference: [Cloudflared downloads](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/)
3. Log in to Cloudflare from WSL2:
```
cloudflared tunnel login
```
   Reference: [Cloudflared tunnel commands](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/configure-tunnels/local-management/cli-commands/)
4. Create a named tunnel (this generates a credentials JSON file in `~/.cloudflared/`):
```
cloudflared tunnel create smartthings-mcp
```
   Reference: [Cloudflared tunnel commands](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/configure-tunnels/local-management/cli-commands/)
5. Create a config file (example below) and include a catch‑all rule:
```
tunnel: <TUNNEL-UUID>
credentials-file: /home/<user>/.cloudflared/<TUNNEL-UUID>.json

ingress:
  - hostname: st-mcp.example.com
    service: http://localhost:8080
  - service: http_status:404
```
   Reference: [Tunnel configuration file](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/configure-tunnels/local-management/configuration-file/)
6. Create a DNS CNAME record for your hostname pointing to `<TUNNEL-UUID>.cfargotunnel.com`.  
   Reference: [Create DNS records](https://developers.cloudflare.com/dns/manage-dns-records/how-to/create-dns-records/)
7. Run as a service:
```
cloudflared service install
systemctl start cloudflared
systemctl status cloudflared
```
   Reference: [Run cloudflared as a service](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/do-more-with-tunnels/local-management/as-a-service/linux/)

Note: the setup script automates these steps and writes `cloudflared/config.yml` for you.

## No Domain Yet? Two Paths
If you do not have a domain on Cloudflare, choose one of the paths below.

### Path A: Get a Domain (Durable, Recommended)
This is the correct long-term setup for SmartThings. You need a stable HTTPS hostname for the SmartApp target URL.

1. Buy or use any domain (from any registrar).
2. Add the domain to Cloudflare and point your nameservers to Cloudflare.  
   Reference: [Add a site to Cloudflare](https://developers.cloudflare.com/dns/zone-setups/full-setup/setup/) citeturn1search9
3. Continue with the “Cloudflare Tunnel (Manual, Step-by-Step)” section above.

### Path B: Quick Tunnel (Temporary Testing Only)
Quick Tunnels create a random `trycloudflare.com` URL. It changes each time and is not durable. Good for demos, not for a stable SmartThings integration. citeturn0search1

1. Make sure you do **not** have `~/.cloudflared/config.yml` present. Quick Tunnels are not supported when a config file exists.  
   Reference: [Quick Tunnels limitations](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/do-more-with-tunnels/trycloudflare/) citeturn0search1
2. Run:
```
cloudflared tunnel --url http://localhost:8080
```
3. Copy the generated `https://<random>.trycloudflare.com` URL.
4. Use that URL as `PUBLIC_URL` (only for temporary testing).

Limitations: Quick Tunnels have request limits and do not support SSE. citeturn0search1
