#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)

log() { printf "[setup] %s\n" "$*"; }
fail() { printf "[setup] ERROR: %s\n" "$*" >&2; exit 1; }

is_wsl() {
  grep -qi microsoft /proc/sys/kernel/osrelease
}

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || fail "Missing required command: $1"
}

is_no() {
  local value
  value=$(printf "%s" "${1:-}" | tr '[:upper:]' '[:lower:]')
  case "$value" in
    0|false|no|n)
      return 0
      ;;
    *)
      return 1
      ;;
  esac
}

require_wsl_systemd() {
  if ! is_wsl; then
    log "WSL2 not detected. Proceeding anyway."
    return
  fi

  if ! command -v systemctl >/dev/null 2>&1; then
    fail "systemctl not found. Enable systemd in WSL2 and restart WSL."
  fi

  if ! systemctl is-system-running >/dev/null 2>&1; then
    cat <<'MSG' >&2
[setup] systemd is not running in WSL2.
Enable by creating /etc/wsl.conf with:

[boot]
systemd=true

Then restart WSL.
MSG
    exit 1
  fi
}

normalize_host() {
  local value="$1"
  value=${value#https://}
  value=${value#http://}
  value=${value%%/*}
  printf "%s" "$value"
}

escape_sed() {
  printf "%s" "$1" | sed -e 's/[\\&|]/\\&/g'
}

ensure_env_file() {
  if [ -f "$ROOT_DIR/.env" ]; then
    return
  fi

  log "Creating .env"
  cat > "$ROOT_DIR/.env" <<ENV
SMARTTHINGS_CLIENT_ID=
SMARTTHINGS_CLIENT_SECRET=
SMARTTHINGS_WEBHOOK_PATH=/smartthings
MCP_HTTP_PATH=/mcp
MCP_GATEWAY_PATH=/mcp-gateway
SMARTTHINGS_OAUTH_TOKEN_URL=https://api.smartthings.com/oauth/token
SMARTTHINGS_OAUTH_AUTHORIZE_URL=https://api.smartthings.com/oauth/authorize
SMARTTHINGS_API_BASE_URL=https://api.smartthings.com/v1
SMARTTHINGS_VERIFY_SIGNATURES=true
SIGNATURE_TOLERANCE_SEC=300
TOKEN_STORE_PATH=$ROOT_DIR/data/token-store.json
OAUTH_SCOPES=r:locations:* r:devices:* x:devices:* r:scenes:* x:scenes:* r:rules:* w:rules:*
OAUTH_REDIRECT_PATH=/oauth/callback
LOG_LEVEL=info
LOG_FILE=$ROOT_DIR/data/smartthings-mcp.log
E2E_CHECK_ENABLED=true
E2E_CHECK_INTERVAL_SEC=300
E2E_CHECK_TIMEOUT_MS=5000
MCP_GATEWAY_ENABLED=false
UPSTREAMS_CONFIG_PATH=$ROOT_DIR/config/upstreams.json
UPSTREAMS_REFRESH_INTERVAL_SEC=300
UPSTREAMS_REQUEST_TIMEOUT_MS=15000
ENV
}

update_env() {
  local key="$1"
  local value="$2"
  local file="$ROOT_DIR/.env"
  local esc_value
  esc_value=$(escape_sed "$value")
  if grep -q "^${key}=" "$file"; then
    sed -i "s|^${key}=.*|${key}=${esc_value}|" "$file"
  else
    printf "%s=%s\n" "$key" "$value" >> "$file"
  fi
}

set_env_default() {
  local key="$1"
  local value="$2"
  local file="$ROOT_DIR/.env"
  if grep -q "^${key}=" "$file"; then
    return
  fi
  update_env "$key" "$value"
}

read_env_value() {
  local key="$1"
  if [ ! -f "$ROOT_DIR/.env" ]; then
    return
  fi
  grep -E "^${key}=" "$ROOT_DIR/.env" | head -n1 | cut -d= -f2-
}

install_openclaw_skill() {
  local workspace_skill_path="$HOME/.openclaw/workspace/skills/smartthings-mcp/SKILL.md"
  local global_skills_dir="/usr/lib/node_modules/openclaw/skills"
  local global_skill_path="$global_skills_dir/smartthings-mcp/SKILL.md"

  mkdir -p "$(dirname "$workspace_skill_path")"
  install -m 0644 "$ROOT_DIR/SKILL.md" "$workspace_skill_path"
  log "Installed SKILL.md to $workspace_skill_path"

  if [ -d "$global_skills_dir" ]; then
    if sudo install -Dm644 "$ROOT_DIR/SKILL.md" "$global_skill_path"; then
      log "Installed SKILL.md to $global_skill_path"
    else
      log "Could not install SKILL.md to $global_skill_path (continuing)"
    fi
  else
    log "Global OpenClaw skills directory not found; workspace skill install only"
  fi
}

configure_mcporter_server() {
  local server_name="$1"
  local endpoint="$2"
  local transport="$3"

  if ! command -v npx >/dev/null 2>&1; then
    log "npx not found; skipping mcporter config"
    return 0
  fi

  local output_file
  output_file=$(mktemp)
  if npx -y mcporter config add "$server_name" "$endpoint" --transport "$transport" --scope home >"$output_file" 2>&1; then
    log "$(cat "$output_file")"
    rm -f "$output_file"
    return 0
  fi

  log "mcporter config add failed:"
  cat "$output_file" >&2
  rm -f "$output_file"
  return 1
}

if [ "${1:-}" = "upstreams" ] || [ "${1:-}" = "--upstreams" ]; then
  ensure_env_file

  PORT_VALUE=$(read_env_value PORT || true)
  PORT_VALUE=${PORT_VALUE:-8080}

  MCP_HTTP_PATH_VALUE=$(read_env_value MCP_HTTP_PATH || true)
  MCP_HTTP_PATH_VALUE=${MCP_HTTP_PATH_VALUE:-/mcp}

  UPSTREAMS_CONFIG_PATH_VALUE=$(read_env_value UPSTREAMS_CONFIG_PATH || true)
  UPSTREAMS_CONFIG_PATH_VALUE=${UPSTREAMS_CONFIG_PATH_VALUE:-$ROOT_DIR/config/upstreams.json}

  UPSTREAM_MANAGER_SCRIPT="$ROOT_DIR/scripts/manage-upstreams.sh"
  if [ ! -f "$UPSTREAM_MANAGER_SCRIPT" ]; then
    fail "Upstream manager not found at $UPSTREAM_MANAGER_SCRIPT"
  fi

  shift
  UPSTREAMS_CONFIG_PATH="$UPSTREAMS_CONFIG_PATH_VALUE" \
  SMARTTHINGS_LOCAL_MCP_URL="http://localhost:$PORT_VALUE$MCP_HTTP_PATH_VALUE" \
  PORT="$PORT_VALUE" \
  MCP_HTTP_PATH="$MCP_HTTP_PATH_VALUE" \
  bash "$UPSTREAM_MANAGER_SCRIPT" "$@"
  exit 0
fi

if [ "${1:-}" = "cleanup" ] || [ "${1:-}" = "--cleanup" ]; then
  CLEANUP_SCRIPT="$ROOT_DIR/scripts/cleanup.sh"
  if [ ! -f "$CLEANUP_SCRIPT" ]; then
    fail "Cleanup script not found at $CLEANUP_SCRIPT"
  fi
  shift
  bash "$CLEANUP_SCRIPT" "$@"
  exit 0
fi

require_cmd node
require_cmd npm

require_wsl_systemd

NODE_BIN=$(command -v node)

if ! command -v smartthings >/dev/null 2>&1; then
  log "SmartThings CLI not found. You can create the OAuth app in Developer Workspace."
fi

TUNNEL_PROVIDER=${TUNNEL_PROVIDER:-}
if [ -z "$TUNNEL_PROVIDER" ]; then
  read -rp "Tunnel provider ([c]loudflare/[n]grok) [cloudflare]: " TUNNEL_PROVIDER
fi

TUNNEL_PROVIDER=$(printf "%s" "$TUNNEL_PROVIDER" | tr '[:upper:]' '[:lower:]')
if [ -z "$TUNNEL_PROVIDER" ] || [ "$TUNNEL_PROVIDER" = "c" ]; then
  TUNNEL_PROVIDER="cloudflare"
fi
if [ "$TUNNEL_PROVIDER" = "n" ]; then
  TUNNEL_PROVIDER="ngrok"
fi

PORT=${PORT:-}
if [ -z "$PORT" ]; then
  PORT=$(read_env_value PORT || true)
fi
PORT=${PORT:-8080}
PUBLIC_HOST=""

if [ "$TUNNEL_PROVIDER" = "cloudflare" ]; then
  require_cmd cloudflared
  require_cmd python3
  CLOUDFLARED_BIN=$(command -v cloudflared)

  log "Checking Cloudflare login"
  if [ ! -f "$HOME/.cloudflared/cert.pem" ]; then
    log "Cloudflare login required. Opening login flow."
    cloudflared tunnel login
  fi

  TUNNEL_NAME=${TUNNEL_NAME:-smartthings-mcp}
  HOSTNAME=${HOSTNAME:-}

  if [ -z "$HOSTNAME" ]; then
    read -rp "Public hostname (e.g. st-mcp.example.com): " HOSTNAME
  fi

  HOSTNAME=$(normalize_host "$HOSTNAME")
  if [ -z "$HOSTNAME" ]; then
    fail "HOSTNAME is required"
  fi

  log "Resolving tunnel ID"
  TUNNEL_ID=$(cloudflared tunnel list --output json | python3 - <<PY
import json,sys
name = "$TUNNEL_NAME"
try:
    data = json.load(sys.stdin)
except Exception:
    data = []
for t in data:
    if t.get("name") == name:
        print(t.get("id", ""))
        break
PY
  )

  if [ -z "$TUNNEL_ID" ]; then
    log "Creating tunnel $TUNNEL_NAME"
    cloudflared tunnel create "$TUNNEL_NAME" >/dev/null
    TUNNEL_ID=$(cloudflared tunnel list --output json | python3 - <<PY
import json,sys
name = "$TUNNEL_NAME"
try:
    data = json.load(sys.stdin)
except Exception:
    data = []
for t in data:
    if t.get("name") == name:
        print(t.get("id", ""))
        break
PY
    )
  fi

  if [ -z "$TUNNEL_ID" ]; then
    fail "Failed to resolve tunnel ID"
  fi

  CRED_FILE="$HOME/.cloudflared/${TUNNEL_ID}.json"
  if [ ! -f "$CRED_FILE" ]; then
    fail "Tunnel credentials not found at $CRED_FILE"
  fi

  log "Configuring Cloudflare tunnel"
  mkdir -p "$ROOT_DIR/cloudflared"
  cat > "$ROOT_DIR/cloudflared/config.yml" <<CFG
# Auto-generated by setup.sh

tunnel: $TUNNEL_ID
credentials-file: $CRED_FILE

ingress:
  - hostname: $HOSTNAME
    service: http://localhost:$PORT
  - service: http_status:404
CFG

  cloudflared tunnel route dns "$TUNNEL_NAME" "$HOSTNAME" >/dev/null || true
  PUBLIC_HOST="$HOSTNAME"

elif [ "$TUNNEL_PROVIDER" = "ngrok" ]; then
  require_cmd ngrok
  NGROK_BIN=$(command -v ngrok)

  NGROK_DOMAIN=${NGROK_DOMAIN:-}
  if [ -z "$NGROK_DOMAIN" ]; then
    read -rp "ngrok static domain (e.g. my-app.ngrok-free.app): " NGROK_DOMAIN
  fi

  NGROK_DOMAIN=$(normalize_host "$NGROK_DOMAIN")
  if [ -z "$NGROK_DOMAIN" ]; then
    fail "NGROK_DOMAIN is required"
  fi

  NGROK_AUTHTOKEN=${NGROK_AUTHTOKEN:-}
  if [ -z "$NGROK_AUTHTOKEN" ]; then
    read -rp "ngrok authtoken: " NGROK_AUTHTOKEN
  fi

  if [ -z "$NGROK_AUTHTOKEN" ]; then
    fail "NGROK_AUTHTOKEN is required"
  fi

  log "Writing ngrok config"
  mkdir -p "$ROOT_DIR/ngrok"
  cat > "$ROOT_DIR/ngrok/ngrok.yml" <<CFG
version: "3"
agent:
  authtoken: "$NGROK_AUTHTOKEN"
endpoints:
  - name: smartthings-mcp
    url: https://$NGROK_DOMAIN
    upstream:
      url: http://localhost:$PORT
CFG

  ngrok config check --config "$ROOT_DIR/ngrok/ngrok.yml" >/dev/null || fail "ngrok config check failed"
  PUBLIC_HOST="$NGROK_DOMAIN"

else
  fail "Unknown tunnel provider: $TUNNEL_PROVIDER"
fi

PUBLIC_URL="https://$PUBLIC_HOST"

ensure_env_file
update_env PUBLIC_URL "$PUBLIC_URL"
update_env PORT "$PORT"
update_env ALLOWED_MCP_HOSTS "localhost,127.0.0.1,$PUBLIC_HOST"
set_env_default SMARTTHINGS_WEBHOOK_PATH "/smartthings"
set_env_default MCP_HTTP_PATH "/mcp"
set_env_default MCP_GATEWAY_PATH "/mcp-gateway"
set_env_default SMARTTHINGS_OAUTH_TOKEN_URL "https://api.smartthings.com/oauth/token"
set_env_default SMARTTHINGS_OAUTH_AUTHORIZE_URL "https://api.smartthings.com/oauth/authorize"
set_env_default SMARTTHINGS_API_BASE_URL "https://api.smartthings.com/v1"
set_env_default SMARTTHINGS_VERIFY_SIGNATURES "true"
set_env_default SIGNATURE_TOLERANCE_SEC "300"
set_env_default TOKEN_STORE_PATH "$ROOT_DIR/data/token-store.json"
set_env_default OAUTH_SCOPES "r:locations:* r:devices:* x:devices:* r:scenes:* x:scenes:* r:rules:* w:rules:*"
set_env_default OAUTH_REDIRECT_PATH "/oauth/callback"
set_env_default LOG_LEVEL "info"
set_env_default LOG_FILE "$ROOT_DIR/data/smartthings-mcp.log"
set_env_default E2E_CHECK_ENABLED "true"
set_env_default E2E_CHECK_INTERVAL_SEC "300"
set_env_default E2E_CHECK_TIMEOUT_MS "5000"
set_env_default MCP_GATEWAY_ENABLED "false"
set_env_default UPSTREAMS_CONFIG_PATH "$ROOT_DIR/config/upstreams.json"
set_env_default UPSTREAMS_REFRESH_INTERVAL_SEC "300"
set_env_default UPSTREAMS_REQUEST_TIMEOUT_MS "15000"

MCP_GATEWAY_ENABLED_VALUE=${MCP_GATEWAY_ENABLED:-}
if [ -z "$MCP_GATEWAY_ENABLED_VALUE" ]; then
  MCP_GATEWAY_ENABLED_VALUE=$(read_env_value MCP_GATEWAY_ENABLED || true)
fi
MCP_GATEWAY_ENABLED_VALUE=$(printf "%s" "$MCP_GATEWAY_ENABLED_VALUE" | tr '[:upper:]' '[:lower:]')
case "$MCP_GATEWAY_ENABLED_VALUE" in
  1|true|yes|y)
    MCP_GATEWAY_ENABLED_VALUE="true"
    ;;
  *)
    MCP_GATEWAY_ENABLED_VALUE="false"
    ;;
esac
update_env MCP_GATEWAY_ENABLED "$MCP_GATEWAY_ENABLED_VALUE"

MCP_HTTP_PATH_VALUE=$(read_env_value MCP_HTTP_PATH || true)
MCP_HTTP_PATH_VALUE=${MCP_HTTP_PATH_VALUE:-/mcp}

UPSTREAMS_CONFIG_PATH_VALUE=$(read_env_value UPSTREAMS_CONFIG_PATH || true)
UPSTREAMS_CONFIG_PATH_VALUE=${UPSTREAMS_CONFIG_PATH_VALUE:-$ROOT_DIR/config/upstreams.json}

ensure_upstreams_config() {
  local file="$1"
  if [ -f "$file" ]; then
    return
  fi
  log "Creating upstreams config"
  mkdir -p "$(dirname "$file")"
  cat > "$file" <<CFG
{
  "upstreams": [
    {
      "name": "smartthings",
      "url": "http://localhost:$PORT$MCP_HTTP_PATH_VALUE",
      "description": "Local SmartThings MCP"
    }
  ]
}
CFG
}

if [ "$MCP_GATEWAY_ENABLED_VALUE" = "true" ]; then
  ensure_upstreams_config "$UPSTREAMS_CONFIG_PATH_VALUE"
fi

UPSTREAM_MANAGER_SCRIPT="$ROOT_DIR/scripts/manage-upstreams.sh"
if [ "$MCP_GATEWAY_ENABLED_VALUE" = "true" ] && [ -f "$UPSTREAM_MANAGER_SCRIPT" ]; then
  log "Checking upstream namespaces"
  UPSTREAMS_CONFIG_PATH="$UPSTREAMS_CONFIG_PATH_VALUE" \
  SMARTTHINGS_LOCAL_MCP_URL="http://localhost:$PORT$MCP_HTTP_PATH_VALUE" \
  PORT="$PORT" \
  MCP_HTTP_PATH="$MCP_HTTP_PATH_VALUE" \
  bash "$UPSTREAM_MANAGER_SCRIPT" --ensure-smartthings

  MANAGE_UPSTREAMS_NOW=${MANAGE_UPSTREAMS_NOW:-}
  if [ -z "$MANAGE_UPSTREAMS_NOW" ]; then
    read -rp "Open upstream config manager now (add/view/edit/remove namespaces)? [y/N]: " MANAGE_UPSTREAMS_NOW
  fi
  if printf "%s" "$MANAGE_UPSTREAMS_NOW" | grep -qi '^y'; then
    UPSTREAMS_CONFIG_PATH="$UPSTREAMS_CONFIG_PATH_VALUE" \
    SMARTTHINGS_LOCAL_MCP_URL="http://localhost:$PORT$MCP_HTTP_PATH_VALUE" \
    PORT="$PORT" \
    MCP_HTTP_PATH="$MCP_HTTP_PATH_VALUE" \
    bash "$UPSTREAM_MANAGER_SCRIPT"
  fi
else
  if [ "$MCP_GATEWAY_ENABLED_VALUE" = "true" ]; then
    log "Upstream manager not found at $UPSTREAM_MANAGER_SCRIPT"
  else
    log "MCP gateway disabled (direct MCP mode)"
  fi
fi

CLIENT_ID=${SMARTTHINGS_CLIENT_ID:-}
CLIENT_SECRET=${SMARTTHINGS_CLIENT_SECRET:-}

if [ -z "$CLIENT_ID" ]; then
  CLIENT_ID=$(read_env_value SMARTTHINGS_CLIENT_ID || true)
fi
if [ -z "$CLIENT_SECRET" ]; then
  CLIENT_SECRET=$(read_env_value SMARTTHINGS_CLIENT_SECRET || true)
fi

FORCE_REENTER_CREDS=${FORCE_REENTER_CREDS:-}
if [ -n "$CLIENT_ID" ] && [ -n "$CLIENT_SECRET" ] && [ -z "$FORCE_REENTER_CREDS" ]; then
  read -rp "Use existing SmartThings credentials from .env? [Y/n]: " USE_EXISTING
  USE_EXISTING=${USE_EXISTING:-y}
  if printf "%s" "$USE_EXISTING" | grep -qi "^n"; then
    CLIENT_ID=""
    CLIENT_SECRET=""
  fi
fi

if [ -z "$CLIENT_ID" ]; then
  read -rp "SmartThings Client ID: " CLIENT_ID
fi
if [ -z "$CLIENT_SECRET" ]; then
  read -rp "SmartThings Client Secret: " CLIENT_SECRET
fi

if [ -z "$CLIENT_ID" ] || [ -z "$CLIENT_SECRET" ]; then
  fail "SmartThings Client ID/Secret required"
fi

update_env SMARTTHINGS_CLIENT_ID "$CLIENT_ID"
update_env SMARTTHINGS_CLIENT_SECRET "$CLIENT_SECRET"

log "Installing dependencies"
cd "$ROOT_DIR"
npm install
npm run build

log "Writing systemd services"
APP_SERVICE=/etc/systemd/system/smartthings-mcp.service
CLOUDFLARE_SERVICE=/etc/systemd/system/cloudflared-smartthings-mcp.service
NGROK_SERVICE=/etc/systemd/system/ngrok-smartthings-mcp.service

sudo tee "$APP_SERVICE" >/dev/null <<SERVICE
[Unit]
Description=SmartThings MCP Server
After=network.target

[Service]
Type=simple
User=$USER
WorkingDirectory=$ROOT_DIR
EnvironmentFile=$ROOT_DIR/.env
ExecStart=$NODE_BIN dist/index.js
Restart=always
RestartSec=2

[Install]
WantedBy=multi-user.target
SERVICE

if [ "$TUNNEL_PROVIDER" = "cloudflare" ]; then
  sudo tee "$CLOUDFLARE_SERVICE" >/dev/null <<SERVICE
[Unit]
Description=Cloudflare Tunnel for SmartThings MCP
After=network.target

[Service]
Type=simple
User=$USER
ExecStart=$CLOUDFLARED_BIN --config $ROOT_DIR/cloudflared/config.yml tunnel run
Restart=always
RestartSec=2

[Install]
WantedBy=multi-user.target
SERVICE

elif [ "$TUNNEL_PROVIDER" = "ngrok" ]; then
  sudo tee "$NGROK_SERVICE" >/dev/null <<SERVICE
[Unit]
Description=ngrok Tunnel for SmartThings MCP
After=network.target

[Service]
Type=simple
User=$USER
WorkingDirectory=$ROOT_DIR
ExecStart=$NGROK_BIN start smartthings-mcp --config $ROOT_DIR/ngrok/ngrok.yml
Restart=always
RestartSec=2

[Install]
WantedBy=multi-user.target
SERVICE
fi

sudo systemctl daemon-reload
if [ "$TUNNEL_PROVIDER" = "cloudflare" ]; then
  sudo systemctl disable --now ngrok-smartthings-mcp.service >/dev/null 2>&1 || true
  sudo systemctl enable --now cloudflared-smartthings-mcp.service
elif [ "$TUNNEL_PROVIDER" = "ngrok" ]; then
  sudo systemctl disable --now cloudflared-smartthings-mcp.service >/dev/null 2>&1 || true
  sudo systemctl enable --now ngrok-smartthings-mcp.service
fi
sudo systemctl enable --now smartthings-mcp.service
sudo systemctl restart smartthings-mcp.service

MCP_PATH_FOR_CLIENTS=$(read_env_value MCP_HTTP_PATH || true)
MCP_PATH_FOR_CLIENTS=${MCP_PATH_FOR_CLIENTS:-/mcp}
MCP_TRANSPORT="http"
if [ "$MCP_GATEWAY_ENABLED_VALUE" = "true" ]; then
  MCP_PATH_FOR_CLIENTS=$(read_env_value MCP_GATEWAY_PATH || true)
  MCP_PATH_FOR_CLIENTS=${MCP_PATH_FOR_CLIENTS:-/mcp-gateway}
fi
MCP_SERVER_URL="$PUBLIC_URL$MCP_PATH_FOR_CLIENTS"
MCPORTER_SERVER_NAME=${MCPORTER_SERVER_NAME:-smartthings}

INSTALL_OPENCLAW_SKILL_VALUE=${INSTALL_OPENCLAW_SKILL:-}
if [ -z "$INSTALL_OPENCLAW_SKILL_VALUE" ]; then
  read -rp "Install SKILL.md into OpenClaw skill folders now? [Y/n]: " INSTALL_OPENCLAW_SKILL_VALUE
fi
INSTALL_OPENCLAW_SKILL_VALUE=${INSTALL_OPENCLAW_SKILL_VALUE:-y}
if ! is_no "$INSTALL_OPENCLAW_SKILL_VALUE"; then
  install_openclaw_skill
else
  log "Skipping OpenClaw skill installation"
fi

CONFIGURE_MCPORTER_VALUE=${CONFIGURE_MCPORTER:-}
if [ -z "$CONFIGURE_MCPORTER_VALUE" ]; then
  read -rp "Configure mcporter server \"$MCPORTER_SERVER_NAME\" -> $MCP_SERVER_URL now? [Y/n]: " CONFIGURE_MCPORTER_VALUE
fi
CONFIGURE_MCPORTER_VALUE=${CONFIGURE_MCPORTER_VALUE:-y}
if ! is_no "$CONFIGURE_MCPORTER_VALUE"; then
  if configure_mcporter_server "$MCPORTER_SERVER_NAME" "$MCP_SERVER_URL" "$MCP_TRANSPORT"; then
    log "mcporter server \"$MCPORTER_SERVER_NAME\" now points to $MCP_SERVER_URL"
  else
    log "mcporter configuration failed. Run manually:"
    log "npx -y mcporter config add $MCPORTER_SERVER_NAME $MCP_SERVER_URL --transport $MCP_TRANSPORT --scope home"
  fi
else
  log "Skipping mcporter configuration"
fi

log "Setup complete"
log "Authorize once: $PUBLIC_URL/oauth/start"
if [ "$MCP_GATEWAY_ENABLED_VALUE" = "true" ]; then
  log "Gateway enabled at: $PUBLIC_URL$(read_env_value MCP_GATEWAY_PATH || true)"
else
  log "Direct MCP endpoint: $PUBLIC_URL$(read_env_value MCP_HTTP_PATH || true)"
  log "Enable gateway later with: MCP_GATEWAY_ENABLED=true ./scripts/setup.sh"
fi
