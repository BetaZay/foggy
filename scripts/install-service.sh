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

for command_name in node npm systemctl useradd groupadd getent install sed; do
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
    'FOGGY_SNAPIN_UPLOAD_MAX_BYTES=2147483648' \
    'FOGGY_SNAPIN_UPLOAD_TIMEOUT_MS=1800000' > "$ENV_TEMP"
  install -m 0640 -o root -g foggy "$ENV_TEMP" "$CONFIG_DIR/foggy.env"
fi

UNIT_TEMP="$(mktemp)"
trap 'rm -f -- "${ENV_TEMP:-}" "$UNIT_TEMP"' EXIT
sed -e "s|@NODE@|$NODE_BIN|g" -e "s|@INSTALL_ROOT@|$INSTALL_ROOT|g" \
  -e "s|@STATE_DIR@|$STATE_DIR|g" -e "s|@CONFIG_DIR@|$CONFIG_DIR|g" \
  "$SOURCE_DIR/deployment/foggy.service.in" > "$UNIT_TEMP"
install -m 0644 -o root -g root "$UNIT_TEMP" "$UNIT_DIR/foggy.service"
install -m 0755 -o root -g root "$RELEASE_DIR/scripts/update-service.sh" /usr/local/sbin/foggy-update

ln -sfnT "$RELEASE_DIR" "$INSTALL_ROOT/current"
systemctl daemon-reload
if (( NO_START == 0 )); then
  systemctl enable --now foggy.service
  SERVICE_PORT="$(awk -F= '/^[[:space:]]*PORT=/{ value=$2 } END { gsub(/[[:space:]]/, "", value); print value }' "$CONFIG_DIR/foggy.env")"
  if [[ ! "$SERVICE_PORT" =~ ^[0-9]+$ ]] || (( SERVICE_PORT < 1 || SERVICE_PORT > 65535 )); then
    SERVICE_PORT=7400
  fi
  SETUP_URL="http://$(detect_local_ipv4):$SERVICE_PORT/"
  print_setup_link "$SETUP_URL"
else
  echo "Foggy installed without starting (--no-start)."
fi
echo "Environment: $CONFIG_DIR/foggy.env"
echo "State: $STATE_DIR"
