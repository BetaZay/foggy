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

SOURCE_VERSION="$(node -p "require('./package.json').version")"
VERSION="${FOGGY_RELEASE_VERSION:-$SOURCE_VERSION}"
if [[ ! "$VERSION" =~ ^[0-9]+[.][0-9]+[.][0-9]+([-+][0-9A-Za-z.-]+)?$ ]]; then
  echo "Invalid Foggy release version: $VERSION" >&2
  exit 1
fi
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
if [[ "$VERSION" != "$SOURCE_VERSION" ]]; then
  node -e '
    const fs = require("node:fs");
    const version = process.argv[1];
    for (const file of process.argv.slice(2)) {
      const value = JSON.parse(fs.readFileSync(file, "utf8"));
      value.version = version;
      if (value.packages?.[""]) value.packages[""].version = version;
      fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
    }
  ' "$VERSION" "$RELEASE_DIR/package.json" "$RELEASE_DIR/package-lock.json"
fi
printf '{\n  "version": "%s",\n  "commit": "%s",\n  "builtAt": "%s"\n}\n' \
  "$VERSION" "$COMMIT" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > "$RELEASE_DIR/release-manifest.json"

tar -C "$STAGING_DIR" -czf "$ARCHIVE" "foggy-$VERSION"
(cd "$OUTPUT_DIR" && sha256sum "$(basename "$ARCHIVE")" > "$(basename "$ARCHIVE").sha256")

echo "Created $ARCHIVE"
echo "Checksum: $ARCHIVE.sha256"
