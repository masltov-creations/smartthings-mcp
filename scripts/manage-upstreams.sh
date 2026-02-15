#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)

log() { printf "[upstreams] %s\n" "$*"; }
fail() { printf "[upstreams] ERROR: %s\n" "$*" >&2; exit 1; }

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || fail "Missing required command: $1"
}

CONFIG_PATH=${UPSTREAMS_CONFIG_PATH:-"$ROOT_DIR/config/upstreams.json"}
DEFAULT_PORT=${PORT:-8080}
DEFAULT_MCP_PATH=${MCP_HTTP_PATH:-/mcp}
SMARTTHINGS_LOCAL_MCP_URL=${SMARTTHINGS_LOCAL_MCP_URL:-"http://localhost:${DEFAULT_PORT}${DEFAULT_MCP_PATH}"}

usage() {
  cat <<'USAGE'
Usage:
  scripts/manage-upstreams.sh                   # interactive manager
  scripts/manage-upstreams.sh --list            # list upstream namespaces
  scripts/manage-upstreams.sh --view            # view raw config JSON
  scripts/manage-upstreams.sh --add             # add/update one namespace (interactive prompts)
  scripts/manage-upstreams.sh --remove          # remove one namespace (interactive prompts)
  scripts/manage-upstreams.sh --edit            # open config in $EDITOR
  scripts/manage-upstreams.sh --reset           # reset to smartthings-only config
  scripts/manage-upstreams.sh --ensure-smartthings
  scripts/manage-upstreams.sh --help
USAGE
}

write_default_config() {
  mkdir -p "$(dirname "$CONFIG_PATH")"
  cat > "$CONFIG_PATH" <<CFG
{
  "upstreams": [
    {
      "name": "smartthings",
      "url": "$SMARTTHINGS_LOCAL_MCP_URL",
      "description": "Local SmartThings MCP"
    }
  ]
}
CFG
}

ensure_config() {
  if [ ! -f "$CONFIG_PATH" ]; then
    log "Creating upstream config at $CONFIG_PATH"
    write_default_config
  fi
  validate_config
}

validate_config() {
  node - "$CONFIG_PATH" <<'NODE'
const fs = require("fs");
const path = process.argv[2];
const nameRegex = /^[A-Za-z0-9_-]{1,32}$/;

let data;
try {
  data = JSON.parse(fs.readFileSync(path, "utf8"));
} catch (err) {
  console.error(`Invalid JSON in ${path}`);
  process.exit(1);
}

if (!data || typeof data !== "object" || Array.isArray(data)) {
  console.error("Config root must be an object");
  process.exit(1);
}

if (!Array.isArray(data.upstreams)) {
  console.error('Config must contain an "upstreams" array');
  process.exit(1);
}

const seen = new Set();
for (const up of data.upstreams) {
  if (!up || typeof up !== "object" || Array.isArray(up)) {
    console.error("Each upstream entry must be an object");
    process.exit(1);
  }
  if (typeof up.name !== "string" || !nameRegex.test(up.name)) {
    console.error(`Invalid upstream name: ${String(up.name)}`);
    process.exit(1);
  }
  if (seen.has(up.name)) {
    console.error(`Duplicate upstream name: ${up.name}`);
    process.exit(1);
  }
  seen.add(up.name);
  if (typeof up.url !== "string" || up.url.trim().length === 0) {
    console.error(`Invalid URL for upstream ${up.name}`);
    process.exit(1);
  }
  try {
    const url = new URL(up.url);
    if (!["http:", "https:"].includes(url.protocol)) {
      console.error(`Unsupported protocol for upstream ${up.name}`);
      process.exit(1);
    }
  } catch {
    console.error(`Invalid URL for upstream ${up.name}`);
    process.exit(1);
  }
  if (typeof up.enabled !== "undefined" && typeof up.enabled !== "boolean") {
    console.error(`Invalid enabled flag for upstream ${up.name}`);
    process.exit(1);
  }
  if (typeof up.description !== "undefined" && typeof up.description !== "string") {
    console.error(`Invalid description for upstream ${up.name}`);
    process.exit(1);
  }
  if (typeof up.headers !== "undefined") {
    if (!up.headers || typeof up.headers !== "object" || Array.isArray(up.headers)) {
      console.error(`Headers for upstream ${up.name} must be an object`);
      process.exit(1);
    }
    for (const [k, v] of Object.entries(up.headers)) {
      if (typeof k !== "string" || typeof v !== "string") {
        console.error(`Headers for upstream ${up.name} must be string:string`);
        process.exit(1);
      }
    }
  }
}
NODE
}

upstream_exists() {
  local name="$1"
  node - "$CONFIG_PATH" "$name" <<'NODE'
const fs = require("fs");
const path = process.argv[2];
const name = process.argv[3];
const data = JSON.parse(fs.readFileSync(path, "utf8"));
const exists = Array.isArray(data.upstreams) && data.upstreams.some((u) => u.name === name);
process.exit(exists ? 0 : 1);
NODE
}

get_upstream_field() {
  local name="$1"
  local field="$2"
  node - "$CONFIG_PATH" "$name" "$field" <<'NODE'
const fs = require("fs");
const [path, name, field] = process.argv.slice(2);
const data = JSON.parse(fs.readFileSync(path, "utf8"));
const up = (data.upstreams || []).find((u) => u.name === name);
if (!up || typeof up[field] === "undefined" || up[field] === null) process.exit(0);
if (typeof up[field] === "object") {
  console.log(JSON.stringify(up[field]));
} else {
  console.log(String(up[field]));
}
NODE
}

write_config_atomically() {
  local json="$1"
  local tmp
  tmp=$(mktemp)
  printf "%s\n" "$json" > "$tmp"
  mv "$tmp" "$CONFIG_PATH"
}

upsert_upstream() {
  local name="$1"
  local url="$2"
  local description="$3"
  local enabled="$4"
  local headers_json="$5"

  local updated
  updated=$(node - "$CONFIG_PATH" "$name" "$url" "$description" "$enabled" "$headers_json" <<'NODE'
const fs = require("fs");
const [path, name, url, description, enabledRaw, headersRaw] = process.argv.slice(2);
const nameRegex = /^[A-Za-z0-9_-]{1,32}$/;
if (!nameRegex.test(name)) {
  console.error("Invalid upstream name");
  process.exit(1);
}
try {
  const parsedUrl = new URL(url);
  if (!["http:", "https:"].includes(parsedUrl.protocol)) {
    throw new Error("Unsupported protocol");
  }
} catch (err) {
  console.error("Invalid upstream URL");
  process.exit(1);
}

const enabled = enabledRaw === "true";
const data = JSON.parse(fs.readFileSync(path, "utf8"));
const upstreams = Array.isArray(data.upstreams) ? data.upstreams : [];
let headers;
if (headersRaw && headersRaw.length > 0) {
  try {
    headers = JSON.parse(headersRaw);
  } catch {
    console.error("Headers JSON is invalid");
    process.exit(1);
  }
  if (!headers || typeof headers !== "object" || Array.isArray(headers)) {
    console.error("Headers must be a JSON object");
    process.exit(1);
  }
  for (const [k, v] of Object.entries(headers)) {
    if (typeof k !== "string" || typeof v !== "string") {
      console.error("Headers must be string:string");
      process.exit(1);
    }
  }
}

const next = {
  name,
  url,
  enabled
};
if (description && description.length > 0) {
  next.description = description;
}
if (headersRaw && headersRaw.length > 0) {
  next.headers = headers;
}

const index = upstreams.findIndex((u) => u.name === name);
if (index >= 0) {
  upstreams[index] = next;
} else {
  upstreams.push(next);
}

data.upstreams = upstreams;
console.log(JSON.stringify(data, null, 2));
NODE
  )
  write_config_atomically "$updated"
  validate_config
}

remove_upstream() {
  local name="$1"
  local updated
  updated=$(node - "$CONFIG_PATH" "$name" <<'NODE'
const fs = require("fs");
const [path, name] = process.argv.slice(2);
const data = JSON.parse(fs.readFileSync(path, "utf8"));
const upstreams = Array.isArray(data.upstreams) ? data.upstreams : [];
const next = upstreams.filter((u) => u.name !== name);
if (next.length === upstreams.length) {
  console.error(`Namespace not found: ${name}`);
  process.exit(1);
}
data.upstreams = next;
console.log(JSON.stringify(data, null, 2));
NODE
  )
  write_config_atomically "$updated"
  validate_config
}

list_upstreams() {
  node - "$CONFIG_PATH" <<'NODE'
const fs = require("fs");
const path = process.argv[2];
const data = JSON.parse(fs.readFileSync(path, "utf8"));
const upstreams = Array.isArray(data.upstreams) ? data.upstreams : [];
if (upstreams.length === 0) {
  console.log("No upstream namespaces configured.");
  process.exit(0);
}
console.log("Namespaces:");
for (const up of upstreams) {
  const enabled = typeof up.enabled === "boolean" ? String(up.enabled) : "true";
  const headers = up.headers ? `${Object.keys(up.headers).length} header(s)` : "none";
  const desc = up.description || "";
  console.log(`- ${up.name}`);
  console.log(`  url: ${up.url}`);
  console.log(`  enabled: ${enabled}`);
  console.log(`  headers: ${headers}`);
  if (desc) console.log(`  description: ${desc}`);
}
NODE
}

view_config() {
  cat "$CONFIG_PATH"
}

edit_config() {
  local editor="${EDITOR:-nano}"
  if ! command -v "$editor" >/dev/null 2>&1; then
    if command -v vi >/dev/null 2>&1; then
      editor="vi"
    else
      fail "No editor found. Set EDITOR or install nano/vi."
    fi
  fi

  local backup
  backup=$(mktemp)
  cp "$CONFIG_PATH" "$backup"

  "$editor" "$CONFIG_PATH"
  if ! validate_config; then
    cp "$backup" "$CONFIG_PATH"
    rm -f "$backup"
    fail "Config was invalid after edit. Original restored."
  fi
  rm -f "$backup"
}

prompt_yes_no() {
  local prompt="$1"
  local default="$2"
  local input
  if [ -t 0 ]; then
    read -rp "$prompt" input
  else
    input="$default"
  fi
  input=${input:-$default}
  if printf "%s" "$input" | grep -qi '^y'; then
    return 0
  fi
  return 1
}

prompt_add_or_update() {
  local name
  read -rp "Namespace name (A-Z, a-z, 0-9, _ -): " name
  if [ -z "$name" ] || ! printf "%s" "$name" | grep -Eq '^[A-Za-z0-9_-]{1,32}$'; then
    fail "Invalid namespace name."
  fi

  local exists=false
  if upstream_exists "$name"; then
    exists=true
    if ! prompt_yes_no "Namespace \"$name\" exists. Update it? [y/N]: " "n"; then
      log "No changes made."
      return
    fi
  fi

  local current_url=""
  local current_description=""
  local current_enabled="true"
  local current_headers=""

  if [ "$exists" = "true" ]; then
    current_url=$(get_upstream_field "$name" "url" || true)
    current_description=$(get_upstream_field "$name" "description" || true)
    current_enabled=$(get_upstream_field "$name" "enabled" || true)
    current_enabled=${current_enabled:-true}
    current_headers=$(get_upstream_field "$name" "headers" || true)
  fi

  local default_url="$SMARTTHINGS_LOCAL_MCP_URL"
  if [ -n "$current_url" ]; then
    default_url="$current_url"
  fi
  read -rp "Upstream URL [$default_url]: " url
  url=${url:-$default_url}

  local default_desc="$current_description"
  read -rp "Description [$default_desc]: " description
  description=${description:-$default_desc}

  local enabled_prompt="[Y/n]"
  local enabled_default="y"
  if [ "$current_enabled" = "false" ]; then
    enabled_prompt="[y/N]"
    enabled_default="n"
  fi
  local enabled_input
  read -rp "Enabled? $enabled_prompt: " enabled_input
  enabled_input=${enabled_input:-$enabled_default}
  local enabled="false"
  if printf "%s" "$enabled_input" | grep -qi '^y'; then
    enabled="true"
  fi

  local headers_json=""
  if [ -n "$current_headers" ]; then
    read -rp "Headers exist. [k]eep, [u]pdate, [r]emove [k]: " header_choice
    header_choice=${header_choice:-k}
    case "$header_choice" in
      u|U)
        read -rp 'Headers JSON (example: {"Authorization":"Bearer ${TOKEN}"}): ' headers_json
        ;;
      r|R)
        headers_json=""
        ;;
      *)
        headers_json="$current_headers"
        ;;
    esac
  else
    if prompt_yes_no "Add auth headers JSON now? [y/N]: " "n"; then
      read -rp 'Headers JSON (example: {"Authorization":"Bearer ${TOKEN}"}): ' headers_json
    fi
  fi

  upsert_upstream "$name" "$url" "$description" "$enabled" "$headers_json"
  log "Namespace saved: $name"
}

prompt_remove() {
  list_upstreams
  local name
  read -rp "Namespace to remove: " name
  if [ -z "$name" ]; then
    fail "Namespace is required."
  fi
  if ! upstream_exists "$name"; then
    fail "Namespace not found: $name"
  fi
  if prompt_yes_no "Remove \"$name\" from config? [y/N]: " "n"; then
    remove_upstream "$name"
    log "Removed namespace: $name"
  else
    log "No changes made."
  fi
}

ensure_smartthings_namespace() {
  local name="smartthings"
  if upstream_exists "$name"; then
    log "Namespace \"$name\" already exists."
    return 0
  fi

  if prompt_yes_no "Namespace \"$name\" missing. Add it now? [Y/n]: " "y"; then
    upsert_upstream "$name" "$SMARTTHINGS_LOCAL_MCP_URL" "Local SmartThings MCP" "true" ""
    log "Added namespace \"$name\"."
  else
    log "Skipped adding \"$name\" namespace."
  fi
}

interactive_menu() {
  while true; do
    printf "\n"
    printf "Upstream Config Manager (%s)\n" "$CONFIG_PATH"
    printf "  1) List namespaces\n"
    printf "  2) View raw config\n"
    printf "  3) Add or update namespace\n"
    printf "  4) Remove namespace\n"
    printf "  5) Edit config in editor\n"
    printf "  6) Ensure smartthings namespace\n"
    printf "  7) Reset config to smartthings-only\n"
    printf "  0) Done\n"

    local choice
    read -rp "Choose an option: " choice
    case "$choice" in
      1) list_upstreams ;;
      2) view_config ;;
      3) prompt_add_or_update ;;
      4) prompt_remove ;;
      5) edit_config ;;
      6) ensure_smartthings_namespace ;;
      7)
        if prompt_yes_no "Reset config and keep only smartthings namespace? [y/N]: " "n"; then
          write_default_config
          validate_config
          log "Config reset complete."
        fi
        ;;
      0) break ;;
      *) log "Unknown option: $choice" ;;
    esac
  done
}

ACTION=${1:-}

require_cmd node
if [ "$ACTION" = "--help" ] || [ "$ACTION" = "-h" ]; then
  usage
  exit 0
fi
ensure_config

case "$ACTION" in
  "" )
    interactive_menu
    ;;
  --list )
    list_upstreams
    ;;
  --view )
    view_config
    ;;
  --add )
    prompt_add_or_update
    ;;
  --remove )
    prompt_remove
    ;;
  --edit )
    edit_config
    ;;
  --reset )
    write_default_config
    validate_config
    log "Config reset complete."
    ;;
  --ensure-smartthings )
    ensure_smartthings_namespace
    ;;
  * )
    usage
    fail "Unknown argument: $ACTION"
    ;;
esac
