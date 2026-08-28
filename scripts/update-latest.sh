#!/usr/bin/env bash
set -euo pipefail

if (( EUID != 0 )); then
  echo "The Foggy update agent must run as root." >&2
  exit 1
fi

INSTALL_ROOT="${FOGGY_INSTALL_ROOT:-/opt/foggy}"
STATE_DIR="${FOGGY_STATE_DIR:-/var/lib/foggy}"
REQUEST_FILE="${FOGGY_UPDATE_REQUEST_FILE:-$STATE_DIR/update-request.json}"
STATUS_FILE="${FOGGY_UPDATE_STATUS_FILE:-$STATE_DIR/update-status.json}"
REPOSITORY_URL="https://github.com/BetaZay/foggy"
WORK_DIR="$(mktemp -d)"
TARGET_VERSION=""
trap 'rm -rf -- "$WORK_DIR"' EXIT

write_status() {
  local state="$1"
  local version="$2"
  local message="$3"
  local temporary
  temporary="$(mktemp "$STATE_DIR/.update-status.XXXXXX")"
  node -e '
    const fs = require("node:fs");
    const [file, state, version, message] = process.argv.slice(1);
    fs.writeFileSync(file, `${JSON.stringify({
      state, version, message, updatedAt: new Date().toISOString(),
    }, null, 2)}\n`);
  ' "$temporary" "$state" "$version" "$message"
  chown foggy:foggy "$temporary"
  chmod 0600 "$temporary"
  mv -Tf "$temporary" "$STATUS_FILE"
}

update_failed() {
  local exit_code=$?
  trap - ERR
  write_status 'failed' "$TARGET_VERSION" 'The update failed. Review the system journal for details.' || true
  exit "$exit_code"
}
trap update_failed ERR

rm -f -- "$REQUEST_FILE"
write_status 'checking' '' 'Checking the latest verified GitHub release.'

LATEST_RELEASE_URL="$(
  curl --fail --silent --show-error --location --proto '=https' --tlsv1.2 \
    --retry 3 --retry-all-errors --output /dev/null --write-out '%{url_effective}' \
    "$REPOSITORY_URL/releases/latest"
)"
TAG="${LATEST_RELEASE_URL##*/}"
if [[ "$TAG" =~ ^[0-9]{4}[.][0-9]{1,2}[.][0-9]+$ ]]; then
  TARGET_VERSION="$TAG"
elif [[ "$TAG" =~ ^v[0-9]+[.][0-9]+[.][0-9]+$ ]]; then
  TARGET_VERSION="${TAG#v}"
else
  echo "GitHub returned an invalid latest release tag: $TAG" >&2
  exit 1
fi

CURRENT_VERSION="$(node -p "require('$INSTALL_ROOT/current/package.json').version")"
if [[ "$CURRENT_VERSION" == "$TARGET_VERSION" ]]; then
  trap - ERR
  write_status 'current' "$CURRENT_VERSION" 'Foggy is already running the latest release.'
  exit 0
fi

ARCHIVE_NAME="foggy-$TARGET_VERSION.tar.gz"
DOWNLOAD_URL="$REPOSITORY_URL/releases/download/$TAG"
CHECKSUM_FILE="$WORK_DIR/$ARCHIVE_NAME.sha256"
write_status 'downloading' "$TARGET_VERSION" 'Downloading and verifying the release metadata.'
curl --fail --silent --show-error --location --proto '=https' --tlsv1.2 \
  --retry 3 --retry-all-errors --output "$CHECKSUM_FILE" "$DOWNLOAD_URL/$ARCHIVE_NAME.sha256"
EXPECTED_SHA256="$(awk -v name="$ARCHIVE_NAME" '$2 == name || $2 == ("*" name) { print $1; exit }' "$CHECKSUM_FILE")"
if [[ ! "$EXPECTED_SHA256" =~ ^[0-9a-fA-F]{64}$ ]]; then
  echo "The published checksum file is invalid." >&2
  exit 1
fi

write_status 'installing' "$TARGET_VERSION" 'Installing the release and checking service health.'
/usr/local/sbin/foggy-update "$DOWNLOAD_URL/$ARCHIVE_NAME" "$EXPECTED_SHA256"
trap - ERR
write_status 'succeeded' "$TARGET_VERSION" "Foggy was updated successfully to $TARGET_VERSION."
