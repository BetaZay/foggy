#!/usr/bin/env bash
set -euo pipefail

if (( EUID != 0 )); then
  echo "Run this installer as root (for example, with sudo)." >&2
  exit 1
fi

SOURCE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
INSTALL_ROOT="${FOGGY_INSTALL_ROOT:-/opt/foggy}"
STATE_DIR="${FOGGY_STATE_DIR:-/var/lib/foggy}"
CONFIG_DIR="${FOGGY_CONFIG_DIR:-/etc/foggy}"
UNIT_DIR="${FOGGY_SYSTEMD_UNIT_DIR:-/etc/systemd/system}"
NO_START=0
SKIP_DEPENDENCIES=0

detect_local_ipv4() {
  local address=""

  if command -v ip >/dev/null 2>&1; then
    address="$(
      ip -4 route get 1.1.1.1 2>/dev/null |
        awk '{ for (field = 1; field <= NF; field++) if ($field == "src") { print $(field + 1); exit } }'
    )"
  fi
  if [[ -z "$address" ]] && command -v hostname >/dev/null 2>&1; then
    address="$(
      hostname -I 2>/dev/null |
        awk '{ for (field = 1; field <= NF; field++) if ($field ~ /^[0-9]+([.][0-9]+){3}$/ && $field !~ /^127[.]/) { print $field; exit } }'
    )"
  fi

  if [[ "$address" =~ ^[0-9]+([.][0-9]+){3}$ ]]; then
    printf '%s' "$address"
  else
    printf 'localhost'
  fi
}

print_setup_link() {
  local url="$1"

  if [[ -t 1 && "${TERM:-dumb}" != "dumb" ]]; then
    printf 'Foggy is running. Open \033]8;;%s\033\\%s\033]8;;\033\\ to finish setup.\n' "$url" "$url"
  else
    printf 'Foggy is running. Open %s to finish setup.\n' "$url"
  fi
}

read_service_setting() {
  local key="$1"
  local fallback="$2"
  local value

  value="$(awk -F= -v key="$key" '
    $1 ~ "^[[:space:]]*" key "[[:space:]]*$" {
      value=substr($0, index($0, "=") + 1)
    }
    END {
      gsub(/^[[:space:]]+|[[:space:]]+$/, "", value)
      gsub(/^\047|\047$/, "", value)
      gsub(/^\042|\042$/, "", value)
      print value
    }
  ' "$CONFIG_DIR/foggy.env" 2>/dev/null || true)"
  printf '%s' "${value:-$fallback}"
}

wait_for_service_health() {
  local deadline=$((SECONDS + 60))

  while (( SECONDS < deadline )); do
    if systemctl is-active --quiet foggy.service && node -e '
      const [host, port] = process.argv.slice(1);
      const address = host.includes(":") ? `[${host.replace(/^\[|\]$/g, "")}]` : host;
      fetch(`http://${address}:${port}/healthz`, { signal: AbortSignal.timeout(2000) })
        .then((response) => process.exit(response.ok ? 0 : 1))
        .catch(() => process.exit(1));
    ' "$SERVICE_HEALTH_HOST" "$SERVICE_PORT"; then
      return 0
    fi
    sleep 1
  done
  return 1
}

for option in "$@"; do
  case "$option" in
    --no-start) NO_START=1 ;;
    --skip-dependencies) SKIP_DEPENDENCIES=1 ;;
    *) echo "Unknown option: $option" >&2; echo "Usage: install-service.sh [--no-start] [--skip-dependencies]" >&2; exit 2 ;;
  esac
done

if [[ ! -f "$SOURCE_DIR/release-manifest.json" || ! -f "$SOURCE_DIR/public/assets/.vite/manifest.json" ]]; then
  echo "This installer must be run from an extracted Foggy release archive." >&2
  echo "Build one with: npm run release" >&2
  exit 1
fi

if (( SKIP_DEPENDENCIES == 0 )); then
  "$SOURCE_DIR/scripts/install-dependencies.sh"
  hash -r
fi

for command_name in node npm systemctl useradd groupadd getent install sed grep; do
  command -v "$command_name" >/dev/null 2>&1 || {
    echo "Required command not found: $command_name" >&2
    exit 1
  }
done
NODE_BIN="$(command -v node)"
NODE_MAJOR="$(node -p "Number(process.versions.node.split('.')[0])")"
if (( NODE_MAJOR < 22 )); then
  echo "Foggy requires Node.js 22 or newer; found $(node --version)." >&2
  exit 1
fi
VERSION="$(node -p "require('$SOURCE_DIR/package.json').version")"
RELEASE_ID="$VERSION-$(date -u +%Y%m%d%H%M%S)"
RELEASE_DIR="$INSTALL_ROOT/releases/$RELEASE_ID"
NOLOGIN_BIN="$(command -v nologin || printf '/usr/sbin/nologin')"

if ! getent group foggy >/dev/null 2>&1; then
  groupadd --system foggy
fi
if ! getent passwd foggy >/dev/null 2>&1; then
  useradd --system --gid foggy --home-dir "$STATE_DIR" --shell "$NOLOGIN_BIN" foggy
fi

install -d -m 0755 -o root -g root "$INSTALL_ROOT" "$INSTALL_ROOT/releases" "$RELEASE_DIR"
install -d -m 0700 -o foggy -g foggy "$STATE_DIR"
install -d -m 0750 -o root -g foggy "$CONFIG_DIR"

cp -R "$SOURCE_DIR/src" "$SOURCE_DIR/public" "$SOURCE_DIR/docs" \
  "$SOURCE_DIR/deployment" "$SOURCE_DIR/scripts" "$RELEASE_DIR/"
cp "$SOURCE_DIR/package.json" "$SOURCE_DIR/package-lock.json" "$SOURCE_DIR/README.md" \
  "$SOURCE_DIR/.env.example" "$SOURCE_DIR/release-manifest.json" "$RELEASE_DIR/"

echo "Installing production dependencies for Foggy $VERSION..."
(cd "$RELEASE_DIR" && npm ci --omit=dev --ignore-scripts)
chown -R root:root "$RELEASE_DIR"
chmod -R go-w "$RELEASE_DIR"
chmod 0755 "$RELEASE_DIR/scripts/"*.sh

if [[ ! -f "$CONFIG_DIR/foggy.env" ]]; then
  ENV_TEMP="$(mktemp)"
  trap 'rm -f -- "$ENV_TEMP"' EXIT
  printf '%s\n' \
    'NODE_ENV=production' \
    'HOST=0.0.0.0' \
    'PORT=7400' \
    "FOGGY_CONFIG_FILE=$STATE_DIR/foggy.json" \
    "FOGGY_SESSION_FILE=$STATE_DIR/sessions.json" \
    'FOGGY_SESSION_TTL_MS=3600000' \
    'FOGGY_UPDATES_ENABLED=true' \
    "FOGGY_UPDATE_REQUEST_FILE=$STATE_DIR/update-request.json" \
    "FOGGY_UPDATE_STATUS_FILE=$STATE_DIR/update-status.json" \
    'FOGGY_SNAPIN_UPLOAD_MAX_BYTES=2147483648' \
    'FOGGY_SNAPIN_UPLOAD_TIMEOUT_MS=1800000' > "$ENV_TEMP"
  install -m 0640 -o root -g foggy "$ENV_TEMP" "$CONFIG_DIR/foggy.env"
fi
for update_setting in \
  'FOGGY_UPDATES_ENABLED=true' \
  "FOGGY_UPDATE_REQUEST_FILE=$STATE_DIR/update-request.json" \
  "FOGGY_UPDATE_STATUS_FILE=$STATE_DIR/update-status.json"; do
  update_key="${update_setting%%=*}"
  if ! grep -q "^[[:space:]]*$update_key=" "$CONFIG_DIR/foggy.env"; then
    printf '%s\n' "$update_setting" >> "$CONFIG_DIR/foggy.env"
  fi
done

UNIT_TEMP="$(mktemp)"
trap 'rm -f -- "${ENV_TEMP:-}" "$UNIT_TEMP"' EXIT
sed -e "s|@NODE@|$NODE_BIN|g" -e "s|@INSTALL_ROOT@|$INSTALL_ROOT|g" \
  -e "s|@STATE_DIR@|$STATE_DIR|g" -e "s|@CONFIG_DIR@|$CONFIG_DIR|g" \
  "$SOURCE_DIR/deployment/foggy.service.in" > "$UNIT_TEMP"
install -m 0644 -o root -g root "$UNIT_TEMP" "$UNIT_DIR/foggy.service"
install -m 0755 -o root -g root "$RELEASE_DIR/scripts/update-service.sh" /usr/local/sbin/foggy-update
install -m 0755 -o root -g root "$RELEASE_DIR/scripts/update-latest.sh" /usr/local/sbin/foggy-update-latest
for update_unit in foggy-update.path foggy-update.service; do
  sed -e "s|@INSTALL_ROOT@|$INSTALL_ROOT|g" -e "s|@STATE_DIR@|$STATE_DIR|g" \
    -e "s|@CONFIG_DIR@|$CONFIG_DIR|g" -e "s|@UNIT_DIR@|$UNIT_DIR|g" \
    "$SOURCE_DIR/deployment/$update_unit.in" > "$UNIT_DIR/$update_unit"
  chown root:root "$UNIT_DIR/$update_unit"
  chmod 0644 "$UNIT_DIR/$update_unit"
done

ln -sfnT "$RELEASE_DIR" "$INSTALL_ROOT/current"
systemctl daemon-reload
if (( NO_START == 0 )); then
  # `enable --now` does not restart an already-active unit. Enable first, then
  # explicitly restart both runtime units so a repair install cannot leave the
  # old process or path watcher using superseded release definitions.
  systemctl enable foggy.service foggy-update.path
  systemctl restart foggy.service
  systemctl restart foggy-update.path
  SERVICE_PORT="$(read_service_setting PORT 7400)"
  if [[ ! "$SERVICE_PORT" =~ ^[0-9]+$ ]] || (( SERVICE_PORT < 1 || SERVICE_PORT > 65535 )); then
    SERVICE_PORT=7400
  fi
  SERVICE_HEALTH_HOST="$(read_service_setting HOST 127.0.0.1)"
  case "$SERVICE_HEALTH_HOST" in
    0.0.0.0|::|'[::]') SERVICE_HEALTH_HOST=127.0.0.1 ;;
  esac
  if ! wait_for_service_health; then
    echo "Foggy did not become healthy after installation." >&2
    systemctl status foggy.service --no-pager >&2 || true
    journalctl -u foggy.service -n 50 --no-pager >&2 || true
    exit 1
  fi
  SETUP_URL="http://$(detect_local_ipv4):$SERVICE_PORT/"
  print_setup_link "$SETUP_URL"
else
  systemctl enable foggy-update.path
  echo "Foggy installed without starting (--no-start)."
fi
echo "Environment: $CONFIG_DIR/foggy.env"
echo "State: $STATE_DIR"
