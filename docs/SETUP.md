# Setup (WSL2 First)

This project targets WSL2 with systemd enabled. A single command performs the full setup: tunnel, services, and configuration.

## Prerequisites
- WSL2 with systemd enabled
- Node.js (LTS)
- SmartThings CLI (for app registration)
- Cloudflare account and domain (for durable URL)

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

The setup script will:
- Create or reuse a Cloudflare Tunnel
- Create DNS for a stable hostname
- Generate config and systemd unit files
- Create `.env` and `.env.example`
- Enable and start services

Service unit templates are available in `systemd/` for reference.

## After Setup
Open `.env` and set:
- `SMARTTHINGS_CLIENT_ID`
- `SMARTTHINGS_CLIENT_SECRET`

Then restart the service:
```
sudo systemctl restart smartthings-mcp.service
```
