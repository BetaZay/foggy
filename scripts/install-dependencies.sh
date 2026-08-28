#!/usr/bin/env bash
set -euo pipefail

if (( EUID != 0 )); then
  echo "Dependency installation must run as root (for example, with sudo)." >&2
  exit 1
fi
if [[ ! -r /etc/os-release ]]; then
  echo "Cannot identify this Linux distribution: /etc/os-release is missing." >&2
  exit 1
fi

# shellcheck disable=SC1091
. /etc/os-release
DISTRO_ID="${ID:-unknown}"
DISTRO_LIKE="${ID_LIKE:-}"

if [[ "$DISTRO_ID" =~ ^(debian|ubuntu)$ || "$DISTRO_LIKE" == *debian* ]]; then
  apt-get update
  DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
    ca-certificates curl xz-utils tar coreutils
elif [[ "$DISTRO_ID" =~ ^(fedora|rhel|centos|rocky|almalinux)$ || "$DISTRO_LIKE" == *fedora* || "$DISTRO_LIKE" == *rhel* ]]; then
  dnf install -y ca-certificates curl xz tar coreutils
elif [[ "$DISTRO_ID" == "arch" || "$DISTRO_LIKE" == *arch* ]]; then
  # Do not run pacman -Sy here: refreshing package databases without a full
  # Arch upgrade creates an unsupported partial-upgrade state.
  pacman -S --needed --noconfirm ca-certificates curl xz tar coreutils
else
  echo "Unsupported automatic dependency installation for: $DISTRO_ID ${DISTRO_LIKE}" >&2
  echo "Install ca-certificates, curl, xz, tar, coreutils, systemd, and Node.js 22+ manually." >&2
  exit 1
fi

if command -v node >/dev/null 2>&1 && command -v npm >/dev/null 2>&1; then
  NODE_MAJOR="$(node -p "Number(process.versions.node.split('.')[0])" 2>/dev/null || printf '0')"
  if (( NODE_MAJOR >= 22 )); then
    echo "Using existing $(node --version) at $(command -v node)."
    exit 0
  fi
fi

case "$(uname -m)" in
  x86_64|amd64) NODE_ARCH="x64" ;;
  aarch64|arm64) NODE_ARCH="arm64" ;;
  armv7l) NODE_ARCH="armv7l" ;;
  ppc64le) NODE_ARCH="ppc64le" ;;
  s390x) NODE_ARCH="s390x" ;;
  *) echo "Node.js 22 has no configured Foggy binary mapping for architecture: $(uname -m)" >&2; exit 1 ;;
esac

NODE_BASE_URL="${FOGGY_NODE_DIST_URL:-https://nodejs.org/download/release/latest-v22.x}"
NODE_WORK_DIR="$(mktemp -d)"
trap 'rm -rf -- "$NODE_WORK_DIR"' EXIT
curl --fail --location --proto '=https' --tlsv1.2 \
  --output "$NODE_WORK_DIR/SHASUMS256.txt" "$NODE_BASE_URL/SHASUMS256.txt"
NODE_ARCHIVE="$(awk -v arch="$NODE_ARCH" '$2 ~ ("^node-v22[.][0-9.]+-linux-" arch "[.]tar[.]xz$") { print $2; exit }' "$NODE_WORK_DIR/SHASUMS256.txt")"
if [[ -z "$NODE_ARCHIVE" ]]; then
  echo "The official Node.js checksum list has no Linux $NODE_ARCH build." >&2
  exit 1
fi
curl --fail --location --proto '=https' --tlsv1.2 \
  --output "$NODE_WORK_DIR/$NODE_ARCHIVE" "$NODE_BASE_URL/$NODE_ARCHIVE"
(cd "$NODE_WORK_DIR" && grep -F "  $NODE_ARCHIVE" SHASUMS256.txt | sha256sum --check --strict)

NODE_DIRECTORY="${NODE_ARCHIVE%.tar.xz}"
tar -xJf "$NODE_WORK_DIR/$NODE_ARCHIVE" -C "$NODE_WORK_DIR"
install -d -m 0755 -o root -g root /opt/nodejs/releases
if [[ ! -d "/opt/nodejs/releases/$NODE_DIRECTORY" ]]; then
  cp -R "$NODE_WORK_DIR/$NODE_DIRECTORY" "/opt/nodejs/releases/$NODE_DIRECTORY"
  chown -R root:root "/opt/nodejs/releases/$NODE_DIRECTORY"
  chmod -R go-w "/opt/nodejs/releases/$NODE_DIRECTORY"
fi
ln -sfnT "/opt/nodejs/releases/$NODE_DIRECTORY" /opt/nodejs/current
for executable in node npm npx corepack; do
  if [[ -e "/opt/nodejs/current/bin/$executable" ]]; then
    ln -sfn "/opt/nodejs/current/bin/$executable" "/usr/local/bin/$executable"
  fi
done
hash -r

NODE_MAJOR="$(/usr/local/bin/node -p "Number(process.versions.node.split('.')[0])")"
if (( NODE_MAJOR < 22 )); then
  echo "Official Node.js installation did not produce a supported runtime." >&2
  exit 1
fi
echo "Installed $(/usr/local/bin/node --version) from the checksum-verified official Node.js release."
