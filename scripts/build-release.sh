#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

for command_name in node npm tar sha256sum; do
  command -v "$command_name" >/dev/null 2>&1 || {
    echo "Required command not found: $command_name" >&2
    exit 1
  }
done

NODE_MAJOR="$(node -p "Number(process.versions.node.split('.')[0])")"
if (( NODE_MAJOR < 22 )); then
  echo "Foggy release builds require Node.js 22 or newer." >&2
  exit 1
fi

VERSION="$(node -p "require('./package.json').version")"
COMMIT="$(git rev-parse --verify HEAD 2>/dev/null || printf 'unknown')"
if [[ -n "$(git status --porcelain --untracked-files=normal 2>/dev/null || true)" ]]; then
  COMMIT="$COMMIT-dirty"
fi
OUTPUT_DIR="$ROOT_DIR/dist"
ARCHIVE="$OUTPUT_DIR/foggy-$VERSION.tar.gz"
STAGING_DIR="$(mktemp -d)"
RELEASE_DIR="$STAGING_DIR/foggy-$VERSION"
trap 'rm -rf -- "$STAGING_DIR"' EXIT

echo "Installing the locked dependency graph..."
npm ci
echo "Running tests..."
npm test
echo "Building production assets..."
npm run build

mkdir -p "$RELEASE_DIR/public" "$OUTPUT_DIR"
cp -R src docs deployment scripts "$RELEASE_DIR/"
cp -R public/assets "$RELEASE_DIR/public/"
cp package.json package-lock.json README.md .env.example "$RELEASE_DIR/"
printf '{\n  "version": "%s",\n  "commit": "%s",\n  "builtAt": "%s"\n}\n' \
  "$VERSION" "$COMMIT" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > "$RELEASE_DIR/release-manifest.json"

tar -C "$STAGING_DIR" -czf "$ARCHIVE" "foggy-$VERSION"
(cd "$OUTPUT_DIR" && sha256sum "$(basename "$ARCHIVE")" > "$(basename "$ARCHIVE").sha256")

echo "Created $ARCHIVE"
echo "Checksum: $ARCHIVE.sha256"
