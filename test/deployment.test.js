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

test('service updater requires checksums remotely and includes rollback health checks', async () => {
  const updater = await readFile('scripts/update-service.sh', 'utf8');
  assert.match(updater, /checksum is required for remote updates/i);
  assert.match(updater, /\/healthz/);
  assert.match(updater, /rolling back/i);
  assert.match(updater, /OLD_RELEASE/);
});
