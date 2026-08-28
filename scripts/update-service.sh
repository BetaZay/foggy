#!/usr/bin/env bash
set -euo pipefail

if (( EUID != 0 )); then
  echo "Run foggy-update as root (for example, with sudo)." >&2
  exit 1
fi
if (( $# < 1 || $# > 2 )); then
  echo "Usage: foggy-update <release.tar.gz|https://...> [sha256]" >&2
  exit 2
fi

SOURCE="$1"
EXPECTED_SHA256="${2:-}"
INSTALL_ROOT="${FOGGY_INSTALL_ROOT:-/opt/foggy}"
STATE_DIR="${FOGGY_STATE_DIR:-/var/lib/foggy}"
CONFIG_DIR="${FOGGY_CONFIG_DIR:-/etc/foggy}"
UNIT_DIR="${FOGGY_SYSTEMD_UNIT_DIR:-/etc/systemd/system}"
CONFIG_FILE="${FOGGY_SERVICE_ENV:-$CONFIG_DIR/foggy.env}"
WORK_DIR="$(mktemp -d)"
ARCHIVE="$WORK_DIR/release.tar.gz"
RELEASE_DIR=""
RELEASE_ACTIVATED=0

cleanup() {
  rm -rf -- "$WORK_DIR"
  if (( RELEASE_ACTIVATED == 0 )) && [[ -n "$RELEASE_DIR" && -d "$RELEASE_DIR" ]]; then
    case "$RELEASE_DIR" in
      "$INSTALL_ROOT/releases/"*) rm -rf -- "$RELEASE_DIR" ;;
    esac
  fi
}
trap cleanup EXIT

case "$SOURCE" in
  http://*|https://*)
    if [[ -z "$EXPECTED_SHA256" ]]; then
      echo "A SHA-256 checksum is required for remote updates." >&2
      exit 2
    fi
    if command -v curl >/dev/null 2>&1; then
      curl --fail --location --proto '=https' --tlsv1.2 --output "$ARCHIVE" "$SOURCE"
    elif command -v wget >/dev/null 2>&1; then
      wget --https-only --output-document="$ARCHIVE" "$SOURCE"
    else
      echo "Install curl or wget to download remote releases." >&2
      exit 1
    fi
    ;;
  *)
    [[ -f "$SOURCE" ]] || { echo "Release archive not found: $SOURCE" >&2; exit 1; }
    cp "$SOURCE" "$ARCHIVE"
    ;;
esac

if [[ -n "$EXPECTED_SHA256" ]]; then
  ACTUAL_SHA256="$(sha256sum "$ARCHIVE" | awk '{print $1}')"
  [[ "$ACTUAL_SHA256" == "$EXPECTED_SHA256" ]] || {
    echo "Release checksum mismatch; update aborted." >&2
    exit 1
  }
fi

if tar -tzf "$ARCHIVE" | awk '/(^\/|(^|\/)\.\.($|\/))/ { bad=1 } END { exit bad ? 0 : 1 }'; then
  echo "Unsafe path found in release archive; update aborted." >&2
  exit 1
fi
tar -xzf "$ARCHIVE" -C "$WORK_DIR"
mapfile -t ROOTS < <(find "$WORK_DIR" -mindepth 1 -maxdepth 1 -type d -name 'foggy-*' -print)
if (( ${#ROOTS[@]} != 1 )); then
  echo "Release archive must contain exactly one foggy-* directory." >&2
  exit 1
fi
SOURCE_DIR="${ROOTS[0]}"
for required in package.json package-lock.json release-manifest.json public/assets/.vite/manifest.json src/server.js; do
  [[ -f "$SOURCE_DIR/$required" ]] || { echo "Invalid release: missing $required" >&2; exit 1; }
done

if [[ -f "$CONFIG_FILE" ]]; then
  for update_setting in \
    'FOGGY_UPDATES_ENABLED=true' \
    "FOGGY_UPDATE_REQUEST_FILE=$STATE_DIR/update-request.json" \
    "FOGGY_UPDATE_STATUS_FILE=$STATE_DIR/update-status.json"; do
    update_key="${update_setting%%=*}"
    if ! grep -q "^[[:space:]]*$update_key=" "$CONFIG_FILE"; then
      printf '%s\n' "$update_setting" >> "$CONFIG_FILE"
    fi
  done
fi

NODE_MAJOR="$(node -p "Number(process.versions.node.split('.')[0])")"
(( NODE_MAJOR >= 22 )) || { echo "Foggy requires Node.js 22 or newer." >&2; exit 1; }
VERSION="$(node -p "require('$SOURCE_DIR/package.json').version")"
RELEASE_ID="$VERSION-$(date -u +%Y%m%d%H%M%S)"
RELEASE_DIR="$INSTALL_ROOT/releases/$RELEASE_ID"
OLD_RELEASE="$(readlink -f "$INSTALL_ROOT/current" 2>/dev/null || true)"
OLD_UNIT="$WORK_DIR/foggy.service.old"
[[ ! -f "$UNIT_DIR/foggy.service" ]] || cp "$UNIT_DIR/foggy.service" "$OLD_UNIT"

install -d -m 0755 -o root -g root "$RELEASE_DIR"
cp -R "$SOURCE_DIR/." "$RELEASE_DIR/"
(cd "$RELEASE_DIR" && npm ci --omit=dev --ignore-scripts --cache "$WORK_DIR/npm-cache")
node --check "$RELEASE_DIR/src/server.js"
chown -R root:root "$RELEASE_DIR"
chmod -R go-w "$RELEASE_DIR"
chmod 0755 "$RELEASE_DIR/scripts/"*.sh

NEW_LINK="$INSTALL_ROOT/.current-new"
rm -f -- "$NEW_LINK"
ln -s "$RELEASE_DIR" "$NEW_LINK"
mv -Tf "$NEW_LINK" "$INSTALL_ROOT/current"
RELEASE_ACTIVATED=1
install -m 0755 -o root -g root "$RELEASE_DIR/scripts/update-service.sh" /usr/local/sbin/foggy-update
UNIT_TEMP="$WORK_DIR/foggy.service.new"
NODE_BIN="$(command -v node)"
sed -e "s|@NODE@|$NODE_BIN|g" -e "s|@INSTALL_ROOT@|$INSTALL_ROOT|g" \
  -e "s|@STATE_DIR@|$STATE_DIR|g" -e "s|@CONFIG_DIR@|$CONFIG_DIR|g" \
  "$RELEASE_DIR/deployment/foggy.service.in" > "$UNIT_TEMP"
install -m 0644 -o root -g root "$UNIT_TEMP" "$UNIT_DIR/foggy.service"
systemctl daemon-reload
systemctl restart foggy.service

PORT="$(awk -F= '/^[[:space:]]*PORT=/{value=$2} END{gsub(/[[:space:]]/, "", value); print value}' "$CONFIG_FILE" 2>/dev/null || true)"
[[ "$PORT" =~ ^[0-9]+$ ]] || PORT=7400
HEALTHY=0
for _ in $(seq 1 30); do
  if systemctl is-active --quiet foggy.service && \
      node -e "fetch('http://127.0.0.1:$PORT/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"; then
    HEALTHY=1
    break
  fi
  sleep 1
done

if (( HEALTHY == 0 )); then
  echo "Foggy $VERSION failed its health check; rolling back." >&2
  if [[ -n "$OLD_RELEASE" && -d "$OLD_RELEASE" ]]; then
    rm -f -- "$NEW_LINK"
    ln -s "$OLD_RELEASE" "$NEW_LINK"
    mv -Tf "$NEW_LINK" "$INSTALL_ROOT/current"
    if [[ -f "$OLD_UNIT" ]]; then
      install -m 0644 -o root -g root "$OLD_UNIT" "$UNIT_DIR/foggy.service"
      systemctl daemon-reload
    fi
    systemctl restart foggy.service
  fi
  exit 1
fi

install -m 0755 -o root -g root "$RELEASE_DIR/scripts/update-latest.sh" /usr/local/sbin/foggy-update-latest
for update_unit in foggy-update.path foggy-update.service; do
  sed -e "s|@INSTALL_ROOT@|$INSTALL_ROOT|g" -e "s|@STATE_DIR@|$STATE_DIR|g" \
    -e "s|@CONFIG_DIR@|$CONFIG_DIR|g" -e "s|@UNIT_DIR@|$UNIT_DIR|g" \
    "$RELEASE_DIR/deployment/$update_unit.in" > "$UNIT_DIR/$update_unit"
  chown root:root "$UNIT_DIR/$update_unit"
  chmod 0644 "$UNIT_DIR/$update_unit"
done
systemctl daemon-reload
systemctl enable --now foggy-update.path

echo "Foggy updated to $VERSION ($RELEASE_DIR)."
echo "Previous releases were retained for manual rollback or cleanup."
