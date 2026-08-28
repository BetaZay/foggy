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
  assert.match(updater, /foggy-update[.]path/);
  assert.match(updater, /npm ci[^\n]+--cache "\$WORK_DIR\/npm-cache"/);
  assert.match(updater, /RELEASE_ACTIVATED/);
  assert.match(updater, /"\$INSTALL_ROOT\/releases\/"\*/);
});

test('built-in update bridge is fixed-source, checksum-gated, and root-owned', async () => {
  const agent = await readFile('scripts/update-latest.sh', 'utf8');
  const pathUnit = await readFile('deployment/foggy-update.path.in', 'utf8');
  const serviceUnit = await readFile('deployment/foggy-update.service.in', 'utf8');
  assert.match(agent, /https:\/\/github[.]com\/BetaZay\/foggy/);
  assert.match(agent, /releases\/latest/);
  assert.match(agent, /EXPECTED_SHA256/);
  assert.match(agent, /\/usr\/local\/sbin\/foggy-update/);
  assert.doesNotMatch(agent, /REQUEST_FILE.*(source|cat)|source.*REQUEST_FILE/);
  assert.match(pathUnit, /PathExists=@STATE_DIR@\/update-request[.]json/);
  assert.match(serviceUnit, /Type=oneshot/);
  assert.match(serviceUnit, /ExecStart=\/usr\/local\/sbin\/foggy-update-latest/);
  assert.doesNotMatch(serviceUnit, /^User=foggy$/m);
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

test('release workflow generates CalVer tags and publishes verified assets', async () => {
  const workflow = await readFile('.github/workflows/release.yml', 'utf8');
  const builder = await readFile('scripts/build-release.sh', 'utf8');
  assert.match(workflow, /branches:\s*\n\s*- main/);
  assert.match(workflow, /contents: write/);
  assert.match(workflow, /date -u \+%Y.*date -u \+%-m.*GITHUB_RUN_NUMBER/);
  assert.match(workflow, /FOGGY_RELEASE_VERSION/);
  assert.match(workflow, /npm run release/);
  assert.match(workflow, /foggy-\$FOGGY_RELEASE_VERSION[.]tar[.]gz[.]sha256/);
  assert.match(workflow, /scripts\/install-foggy[.]sh/);
  assert.match(workflow, /--target "\$GITHUB_SHA"/);
  assert.match(builder, /cp -R public\/brand "\$RELEASE_DIR\/public\/"/);
});
