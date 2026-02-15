# Setup (WSL2 First)

This project targets WSL2 with systemd enabled. A single command will eventually perform the full setup: tunnel, SmartThings OAuth app, services, and configuration.

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

## Planned One-Command Setup
```
./scripts/setup.sh
```

The setup script will:
- Create or reuse a Cloudflare Tunnel
- Create DNS for a stable hostname
- Generate config and systemd unit files
- Create `.env` and `.env.example`
- Register the SmartThings OAuth app or prompt for credentials
- Enable and start services

