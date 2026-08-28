import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ConfigStore, ConfigValidationError } from '../src/config/config-store.js';

function temporaryConfig(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'foggy-config-test-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return path.join(directory, 'nested', 'foggy.json');
}

const seed = {
  configured: true,
  name: 'Primary FOG',
  baseUrl: 'http://fog-one.test/fog',
  apiToken: 'application-token',
  userToken: 'seed-user-token',
  timeoutMs: 10_000,
};

test('config store creates a private file and seeds the existing env server', (t) => {
  const file = temporaryConfig(t);
  const store = new ConfigStore(file, { seed });
  assert.equal(store.listServers().length, 1);
  assert.equal(store.listServers()[0].name, 'Primary FOG');
  assert.equal(fs.statSync(file).mode & 0o777, 0o600);

  const persisted = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.equal(persisted.version, 3);
  assert.equal(persisted.servers[0].apiToken, 'application-token');
  assert.equal(Object.hasOwn(persisted.servers[0], 'configured'), false);
});

test('config store validates and persists additional independent servers', (t) => {
  const file = temporaryConfig(t);
  const store = new ConfigStore(file);
  const added = store.addServer({
    name: 'Lab FOG', baseUrl: 'https://lab.test/fog/', apiToken: 'app',
    userToken: 'user',
    timeoutMs: '15000',
  });
  assert.equal(added.baseUrl, 'https://lab.test/fog');
  assert.equal(new ConfigStore(file).getServer(added.id).apiToken, 'app');

  assert.throws(() => store.addServer({ name: 'Broken', baseUrl: 'not a url' }), ConfigValidationError);
  assert.throws(() => store.addServer({
    name: 'Duplicate', baseUrl: 'https://lab.test/fog', apiToken: 'app', userToken: 'user',
  }), /already configured/);
});

test('config store refuses a symlink config target', (t) => {
  const file = temporaryConfig(t);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const target = path.join(path.dirname(file), 'real.json');
  fs.writeFileSync(target, '{"version":3,"servers":[]}');
  fs.symlinkSync(target, file);
  assert.throws(() => new ConfigStore(file), /not a symlink/);
});

test('version 1 config retains the API user token but removes passwords during migration', (t) => {
  const file = temporaryConfig(t);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify({ version: 1, servers: [{
    id: 'legacy', name: 'Legacy FOG', baseUrl: 'http://legacy.test/fog',
    apiToken: 'app', userToken: 'user-secret', username: 'admin', password: 'password-secret', timeoutMs: 10000,
  }] }), { mode: 0o600 });
  const store = new ConfigStore(file);
  assert.equal(store.listServers()[0].name, 'Legacy FOG');
  const persisted = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.equal(persisted.version, 3);
  assert.equal(persisted.servers[0].userToken, 'user-secret');
  assert.equal(Object.hasOwn(persisted.servers[0], 'password'), false);
});

test('version 2 servers remain editable until a user API token is supplied', (t) => {
  const file = temporaryConfig(t);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify({ version: 2, servers: [{
    id: 'needs-token', name: 'Needs token', baseUrl: 'http://fog.test/fog', apiToken: 'app', timeoutMs: 10000,
  }] }), { mode: 0o600 });
  const store = new ConfigStore(file);
  assert.equal(store.getServer('needs-token').setupRequired, true);
  const updated = store.updateServer('needs-token', {
    name: 'Ready FOG', baseUrl: 'http://fog.test/fog', apiToken: 'app', userToken: 'user', timeoutMs: 10000,
  });
  assert.equal(updated.configured, true);
  assert.equal(new ConfigStore(file).getServer('needs-token').userToken, 'user');
});
