#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)

log() { printf "[cleanup] %s\n" "$*"; }
fail() { printf "[cleanup] ERROR: %s\n" "$*" >&2; exit 1; }

MODE="soft"
DRY_RUN=false
ASSUME_YES=false
REMOVE_ENV=false

APP_SERVICE=smartthings-mcp.service
CLOUDFLARE_SERVICE=cloudflared-smartthings-mcp.service
NGROK_SERVICE=ngrok-smartthings-mcp.service

usage() {
  cat <<'USAGE'
Usage:
  scripts/cleanup.sh
  scripts/cleanup.sh --soft
  scripts/cleanup.sh --purge
  scripts/cleanup.sh --purge --remove-env
  scripts/cleanup.sh --dry-run
  scripts/cleanup.sh --yes
  scripts/cleanup.sh --help

Modes:
  --soft        Stop/disable services only (keeps files/config/secrets)
  --purge       Soft cleanup + remove generated service units and local generated files
  --remove-env  With --purge, also remove .env

Safety:
  --dry-run     Show what would happen without changing anything
  --yes         Non-interactive confirmation
USAGE
}

confirm() {
  local prompt="$1"
  if [ "$ASSUME_YES" = "true" ]; then
    return 0
  fi
  local answer
  read -rp "$prompt [y/N]: " answer
  if printf "%s" "$answer" | grep -qi '^y'; then
    return 0
  fi
  return 1
}

run_cmd() {
  if [ "$DRY_RUN" = "true" ]; then
    printf "[cleanup] DRY-RUN: %s\n" "$*"
    return 0
  fi
  "$@"
}

run_sudo() {
  if [ "$DRY_RUN" = "true" ]; then
    printf "[cleanup] DRY-RUN: sudo %s\n" "$*"
    return 0
  fi
  sudo "$@"
}

service_known() {
  local service="$1"
  systemctl list-unit-files --type=service --no-legend 2>/dev/null | awk '{print $1}' | grep -Fxq "$service"
}

stop_disable_service() {
  local service="$1"
  if service_known "$service"; then
    log "Disabling and stopping $service"
    run_sudo systemctl disable --now "$service" >/dev/null 2>&1 || true
  else
    log "Service not found: $service (skipping)"
  fi
}

remove_unit_file() {
  local unit_file="/etc/systemd/system/$1"
  if [ -f "$unit_file" ]; then
    log "Removing unit file $unit_file"
    run_sudo rm -f "$unit_file"
  fi
}

read_env_value() {
  local key="$1"
  local env_file="$ROOT_DIR/.env"
  if [ ! -f "$env_file" ]; then
    return
  fi
  grep -E "^${key}=" "$env_file" | head -n1 | cut -d= -f2-
}

safe_remove_file_if_exists() {
  local path="$1"
  if [ -z "$path" ]; then
    return
  fi
  if [ -f "$path" ]; then
    log "Removing file $path"
    run_cmd rm -f "$path"
  fi
}

safe_remove_dir_if_empty() {
  local path="$1"
  if [ -d "$path" ] && [ -z "$(ls -A "$path" 2>/dev/null)" ]; then
    log "Removing empty directory $path"
    run_cmd rmdir "$path"
  fi
}

purge_local_files() {
  local token_store log_file upstreams_cfg
  token_store=$(read_env_value TOKEN_STORE_PATH || true)
  log_file=$(read_env_value LOG_FILE || true)
  upstreams_cfg=$(read_env_value UPSTREAMS_CONFIG_PATH || true)

  safe_remove_file_if_exists "$ROOT_DIR/cloudflared/config.yml"
  safe_remove_file_if_exists "$ROOT_DIR/ngrok/ngrok.yml"

  if [ -n "$upstreams_cfg" ]; then
    safe_remove_file_if_exists "$upstreams_cfg"
  else
    safe_remove_file_if_exists "$ROOT_DIR/config/upstreams.json"
  fi

  if [ -n "$token_store" ]; then
    safe_remove_file_if_exists "$token_store"
  else
    safe_remove_file_if_exists "$ROOT_DIR/data/token-store.json"
  fi

  if [ -n "$log_file" ]; then
    safe_remove_file_if_exists "$log_file"
  else
    safe_remove_file_if_exists "$ROOT_DIR/data/smartthings-mcp.log"
  fi

  safe_remove_dir_if_empty "$ROOT_DIR/cloudflared"
  safe_remove_dir_if_empty "$ROOT_DIR/ngrok"
  safe_remove_dir_if_empty "$ROOT_DIR/config"
}

while [ $# -gt 0 ]; do
  case "$1" in
    --soft)
      MODE="soft"
      ;;
    --purge)
      MODE="purge"
      ;;
    --remove-env)
      REMOVE_ENV=true
      ;;
    --dry-run)
      DRY_RUN=true
      ;;
    --yes)
      ASSUME_YES=true
      ;;
    --help|-h)
      usage
      exit 0
      ;;
    *)
      usage
      fail "Unknown argument: $1"
      ;;
  esac
  shift
done

if [ "$MODE" = "soft" ] && [ "$REMOVE_ENV" = "true" ]; then
  fail "--remove-env requires --purge"
fi

log "Requested mode: $MODE"
if [ "$DRY_RUN" = "true" ]; then
  log "Dry-run mode enabled"
fi

if ! confirm "Proceed with cleanup?"; then
  log "Cancelled."
  exit 0
fi

stop_disable_service "$APP_SERVICE"
stop_disable_service "$CLOUDFLARE_SERVICE"
stop_disable_service "$NGROK_SERVICE"

if [ "$MODE" = "purge" ]; then
  remove_unit_file "$APP_SERVICE"
  remove_unit_file "$CLOUDFLARE_SERVICE"
  remove_unit_file "$NGROK_SERVICE"

  log "Reloading systemd daemon"
  run_sudo systemctl daemon-reload

  purge_local_files

  if [ "$REMOVE_ENV" = "true" ]; then
    safe_remove_file_if_exists "$ROOT_DIR/.env"
  fi
fi

log "Cleanup complete."
