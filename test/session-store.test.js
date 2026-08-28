import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { SessionStore } from '../src/auth/session-store.js';

function temporarySessionFile(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'foggy-session-test-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return path.join(directory, 'nested', 'sessions.json');
}

test('session store issues opaque isolated sessions and destroys them', () => {
  const store = new SessionStore({ ttlMs: 1000 });
  const fog = { system: {} };
  const first = store.create({ serverId: 'one', username: 'tech', fog });
  const second = store.create({ serverId: 'two', username: 'tech', fog });
  assert.notEqual(first.id, second.id);
  assert.notEqual(first.csrfToken, second.csrfToken);
  assert.equal(store.get(first.id).serverId, 'one');
  store.destroy(first.id);
  assert.equal(store.get(first.id), null);
  assert.equal(store.get(second.id).serverId, 'two');
});

test('expired sessions are rejected', (t) => {
  const originalNow = Date.now;
  let now = 1_000;
  Date.now = () => now;
  t.after(() => { Date.now = originalNow; });
  const store = new SessionStore({ ttlMs: 100 });
  const session = store.create({ serverId: 'one', username: 'tech', fog: {} });
  now = 1_101;
  assert.equal(store.get(session.id), null);
});

test('sessions survive restart without persisting bearer IDs, FOG clients, or credentials', (t) => {
  const file = temporarySessionFile(t);
  const firstStore = new SessionStore({ ttlMs: 60_000, filePath: file });
  const session = firstStore.create({
    serverId: 'primary', username: 'tech',
    fog: { secretToken: 'must-not-persist' },
  });

  assert.equal(fs.statSync(file).mode & 0o777, 0o600);
  const source = fs.readFileSync(file, 'utf8');
  assert.doesNotMatch(source, new RegExp(session.id));
  assert.doesNotMatch(source, /must-not-persist|secretToken|apiToken|userToken/);

  const restoredStore = new SessionStore({ ttlMs: 60_000, filePath: file });
  const restored = restoredStore.get(session.id);
  assert.equal(restored.serverId, 'primary');
  assert.equal(restored.username, 'tech');
  assert.equal(restored.csrfToken, session.csrfToken);
  assert.equal(restored.fog, null);

  restoredStore.destroy(session.id);
  assert.equal(new SessionStore({ ttlMs: 60_000, filePath: file }).get(session.id), null);
});

test('session persistence refuses a symlink target', (t) => {
  const file = temporarySessionFile(t);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const target = path.join(path.dirname(file), 'real.json');
  fs.writeFileSync(target, '{"version":1,"sessions":[]}');
  fs.symlinkSync(target, file);
  assert.throws(() => new SessionStore({ filePath: file }), /not a symlink/);
});
