import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { compareVersions, UpdateError, UpdateManager } from '../src/updates/manager.js';

function releaseResponse(version = '2026.8.12') {
  const archive = `foggy-${version}.tar.gz`;
  return {
    ok: true,
    status: 200,
    async json() {
      return {
        tag_name: version,
        html_url: `https://github.com/BetaZay/foggy/releases/tag/${version}`,
        published_at: '2026-08-28T04:00:00Z',
        assets: [{ name: archive }, { name: `${archive}.sha256` }, { name: 'install-foggy.sh' }],
      };
    },
  };
}

test('CalVer comparison orders year, month, and action number numerically', () => {
  assert.ok(compareVersions('2026.8.12', '2026.8.9') > 0);
  assert.ok(compareVersions('2027.1.1', '2026.12.99') > 0);
  assert.equal(compareVersions('2026.8.12', '2026.8.12'), 0);
  assert.equal(compareVersions('invalid', '2026.8.12'), null);
});

test('update manager reports a verified newer release and public agent state', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'foggy-update-status-'));
  const statusFile = path.join(directory, 'update-status.json');
  await fs.writeFile(statusFile, JSON.stringify({
    state: 'failed', version: '2026.8.11', message: 'Health check failed.', updatedAt: '2026-08-28T04:00:00Z',
    secret: 'must-not-leak',
  }));
  const manager = new UpdateManager({
    currentVersion: '2026.8.10', enabled: true,
    requestFile: path.join(directory, 'update-request.json'), statusFile,
    fetchImpl: async () => releaseResponse(),
  });

  const status = await manager.status();
  assert.equal(status.updateAvailable, true);
  assert.equal(status.latest.version, '2026.8.12');
  assert.deepEqual(status.agentStatus, {
    state: 'failed', version: '2026.8.11', message: 'Health check failed.', updatedAt: '2026-08-28T04:00:00Z',
  });
  assert.equal(Object.hasOwn(status.agentStatus, 'secret'), false);
});

test('update request is private, atomic, fixed to latest, and rejects duplicate or symlink targets', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'foggy-update-request-'));
  const requestFile = path.join(directory, 'update-request.json');
  const manager = new UpdateManager({
    currentVersion: '2026.8.10', enabled: true, requestFile,
    statusFile: path.join(directory, 'update-status.json'),
    fetchImpl: async () => releaseResponse(),
    now: () => new Date('2026-08-28T04:05:00Z'),
  });

  await manager.requestUpdate('technician');
  const stat = await fs.stat(requestFile);
  assert.equal(stat.mode & 0o777, 0o600);
  assert.deepEqual(JSON.parse(await fs.readFile(requestFile, 'utf8')), {
    requestedAt: '2026-08-28T04:05:00.000Z', requestedBy: 'technician', version: '2026.8.12',
  });
  await assert.rejects(() => manager.requestUpdate('technician'), (error) => {
    assert.equal(error.code, 'UPDATE_ALREADY_QUEUED');
    return true;
  });

  await fs.unlink(requestFile);
  await fs.symlink(path.join(directory, 'elsewhere'), requestFile);
  await assert.rejects(() => manager.requestUpdate('technician'), (error) => {
    assert.equal(error.code, 'UPDATE_PATH_UNSAFE');
    return true;
  });
});

test('update manager refuses disabled handlers, current releases, and incomplete assets', async () => {
  const manager = new UpdateManager({
    currentVersion: '2026.8.12', enabled: false,
    requestFile: '/unused/request', statusFile: '/unused/status',
    fetchImpl: async () => releaseResponse(),
  });
  await assert.rejects(() => manager.requestUpdate('technician'), UpdateError);

  manager.enabled = true;
  await assert.rejects(() => manager.requestUpdate('technician'), (error) => {
    assert.equal(error.code, 'UPDATE_NOT_AVAILABLE');
    return true;
  });

  manager.fetch = async () => ({ ok: true, status: 200, async json() { return { tag_name: '2026.8.13', assets: [] }; } });
  await assert.rejects(() => manager.latestRelease(), (error) => {
    assert.equal(error.code, 'UPDATE_ASSETS_MISSING');
    return true;
  });
});
