import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('systemd unit runs unprivileged with external state and hardening', async () => {
  const unit = await readFile('deployment/foggy.service.in', 'utf8');
  assert.match(unit, /^User=foggy$/m);
  assert.match(unit, /^NoNewPrivileges=true$/m);
  assert.match(unit, /^PrivateTmp=true$/m);
  assert.match(unit, /^ProtectSystem=strict$/m);
  assert.match(unit, /^ReadWritePaths=@STATE_DIR@$/m);
  assert.doesNotMatch(unit, /FOG_API_TOKEN|fog-api-token|fog-user-token/);
});

test('service installer prints a clickable setup URL using the local address and configured port', async () => {
  const installer = await readFile('scripts/install-service.sh', 'utf8');
  assert.match(installer, /ip -4 route get/);
  assert.match(installer, /hostname -I/);
  assert.match(installer, /PORT=.*foggy[.]env|foggy[.]env.*PORT=/s);
  assert.match(installer, /SETUP_URL="http:\/\/\$\(detect_local_ipv4\):\$SERVICE_PORT\/"/);
  assert.match(installer, /\\033\]8;;%s/);
  assert.doesNotMatch(installer, /<server-address>/);
});

test('service updater requires checksums remotely and includes rollback health checks', async () => {
  const updater = await readFile('scripts/update-service.sh', 'utf8');
  assert.match(updater, /checksum is required for remote updates/i);
  assert.match(updater, /\/healthz/);
  assert.match(updater, /rolling back/i);
  assert.match(updater, /OLD_RELEASE/);
});

test('dependency bootstrap supports target distributions and verifies official Node archives', async () => {
  const installer = await readFile('scripts/install-dependencies.sh', 'utf8');
  assert.match(installer, /apt-get install/);
  assert.match(installer, /dnf install/);
  assert.match(installer, /pacman -S/);
  assert.match(installer, /latest-v22[.]x/);
  assert.match(installer, /SHASUMS256[.]txt/);
  assert.match(installer, /sha256sum --check --strict/);
});

test('one-command installer downloads the latest release and verifies it before extraction', async () => {
  const installer = await readFile('scripts/install-foggy.sh', 'utf8');
  assert.match(installer, /releases\/latest/);
  assert.match(installer, /releases\/download\/\$TAG/);
  assert.match(installer, /--proto '=https'/);
  assert.match(installer, /EXPECTED_SHA256/);
  assert.match(installer, /ACTUAL_SHA256/);
  assert.match(installer, /Unsafe path found in release archive/);
  assert.match(installer, /install-service[.]sh/);
});

test('release workflow requires a package-matching tag and publishes verified assets', async () => {
  const workflow = await readFile('.github/workflows/release.yml', 'utf8');
  assert.match(workflow, /tags:\s*\n\s*- ["']v\*[.]\*[.]\*["']/);
  assert.match(workflow, /contents: write/);
  assert.match(workflow, /GITHUB_REF_NAME.*v\$version/);
  assert.match(workflow, /npm run release/);
  assert.match(workflow, /foggy-\$version[.]tar[.]gz[.]sha256/);
  assert.match(workflow, /scripts\/install-foggy[.]sh/);
  assert.match(workflow, /--verify-tag/);
});
