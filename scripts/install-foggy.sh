#!/usr/bin/env bash
set -euo pipefail

if (( EUID != 0 )); then
  echo "Run this installer as root, for example:" >&2
  echo "  curl -fsSL https://github.com/BetaZay/foggy/releases/latest/download/install-foggy.sh | sudo bash" >&2
  exit 1
fi

for command_name in curl tar sha256sum awk find mktemp; do
  command -v "$command_name" >/dev/null 2>&1 || {
    echo "Required bootstrap command not found: $command_name" >&2
    exit 1
  }
done

REPOSITORY_URL="https://github.com/BetaZay/foggy"
WORK_DIR="$(mktemp -d)"
trap 'rm -rf -- "$WORK_DIR"' EXIT

LATEST_RELEASE_URL="$(
  curl --fail --silent --show-error --location --proto '=https' --tlsv1.2 \
    --retry 3 --retry-all-errors --output /dev/null --write-out '%{url_effective}' \
    "$REPOSITORY_URL/releases/latest"
)"
TAG="${LATEST_RELEASE_URL##*/}"
if [[ ! "$TAG" =~ ^v[0-9]+[.][0-9]+[.][0-9]+([-+][0-9A-Za-z.-]+)?$ ]]; then
  echo "GitHub returned an invalid latest release tag: $TAG" >&2
  exit 1
fi

VERSION="${TAG#v}"
ARCHIVE_NAME="foggy-$VERSION.tar.gz"
DOWNLOAD_URL="$REPOSITORY_URL/releases/download/$TAG"
ARCHIVE="$WORK_DIR/$ARCHIVE_NAME"
CHECKSUM_FILE="$ARCHIVE.sha256"

echo "Downloading Foggy $VERSION..."
curl --fail --silent --show-error --location --proto '=https' --tlsv1.2 \
  --retry 3 --retry-all-errors --output "$ARCHIVE" "$DOWNLOAD_URL/$ARCHIVE_NAME"
curl --fail --silent --show-error --location --proto '=https' --tlsv1.2 \
  --retry 3 --retry-all-errors --output "$CHECKSUM_FILE" \
  "$DOWNLOAD_URL/$ARCHIVE_NAME.sha256"

EXPECTED_SHA256="$(awk -v name="$ARCHIVE_NAME" '$2 == name || $2 == ("*" name) { print $1; exit }' "$CHECKSUM_FILE")"
if [[ ! "$EXPECTED_SHA256" =~ ^[0-9a-fA-F]{64}$ ]]; then
  echo "The published checksum file is invalid; installation aborted." >&2
  exit 1
fi
ACTUAL_SHA256="$(sha256sum "$ARCHIVE" | awk '{ print $1 }')"
if [[ "$ACTUAL_SHA256" != "$EXPECTED_SHA256" ]]; then
  echo "Release checksum mismatch; installation aborted." >&2
  exit 1
fi

if tar -tzf "$ARCHIVE" | awk '/(^\/|(^|\/)\.\.($|\/))/ { bad=1 } END { exit bad ? 0 : 1 }'; then
  echo "Unsafe path found in release archive; installation aborted." >&2
  exit 1
fi
tar -xzf "$ARCHIVE" -C "$WORK_DIR"
mapfile -t RELEASE_ROOTS < <(find "$WORK_DIR" -mindepth 1 -maxdepth 1 -type d -name 'foggy-*' -print)
if (( ${#RELEASE_ROOTS[@]} != 1 )); then
  echo "Release archive must contain exactly one foggy-* directory." >&2
  exit 1
fi

echo "Checksum verified. Installing Foggy $VERSION..."
"${RELEASE_ROOTS[0]}/scripts/install-service.sh" "$@"
