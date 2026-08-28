import test from 'node:test';
import assert from 'node:assert/strict';
import { createFogContext, FogRegistry } from '../src/fog/registry.js';
import { SessionStore } from '../src/auth/session-store.js';

const servers = [
  { id: 'one', name: 'FOG One', baseUrl: 'http://one.test/fog', apiToken: 'secret-one', userToken: 'user-one', configured: true, setupRequired: false, timeoutMs: 1000 },
  { id: 'two', name: 'FOG Two', baseUrl: 'http://two.test/fog', apiToken: 'secret-two', userToken: 'user-two', configured: true, setupRequired: false, timeoutMs: 1000 },
];

function registryFixture() {
  const store = {
    listServers: () => servers.map((server) => ({ ...server })),
    getServer: (id) => servers.find((server) => server.id === id) || null,
  };
  const registry = new FogRegistry(store);
  registry.client = (server) => ({ system: { status: async () => server.id } });
  return registry;
}

test('registry public server list never exposes credentials', () => {
  const list = registryFixture().listPublic();
  assert.deepEqual(list[0], { id: 'one', name: 'FOG One', baseUrl: 'http://one.test/fog', configured: true, setupRequired: false });
  assert.equal(Object.hasOwn(list[0], 'apiToken'), false);
});

test('request context uses only the server bound to an authenticated session', async () => {
  const registry = registryFixture();
  const sessions = new SessionStore();
  const session = sessions.create({ serverId: 'two', username: 'technician', fog: registry.client(servers[1]) });
  const context = createFogContext(registry, sessions);
  const locals = {};
  const request = {
    originalUrl: '/computers?search=LAB',
    get: (name) => name === 'cookie' ? `foggy_session=${session.id}` : '',
  };
  await new Promise((resolve, reject) => {
    context.middleware(request, { locals }, async () => {
      try {
        assert.equal(await context.fog.system.status(), 'two');
        assert.equal(request.fogServer.id, 'two');
        assert.equal(request.session.username, 'technician');
        assert.equal(locals.fogServerReturnTo, '/computers?search=LAB');
        resolve();
      } catch (error) { reject(error); }
    });
  });
});

test('request context reconstructs a FOG client for a restart-restored session', async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  let headers;
  globalThis.fetch = async (url, options) => {
    headers = options.headers;
    return new Response('success\n', { status: 200, headers: { 'content-type': 'application/json' } });
  };
  const registry = registryFixture();
  const sessions = new SessionStore();
  const session = sessions.create({ serverId: 'two', username: 'technician', fog: {} });
  sessions.sessions.get(session.key).fog = null;
  const context = createFogContext(registry, sessions);
  const request = {
    originalUrl: '/',
    get: (name) => name === 'cookie' ? `foggy_session=${session.id}` : '',
  };
  await new Promise((resolve, reject) => {
    context.middleware(request, { locals: {} }, async () => {
      try {
        assert.equal(await context.fog.system.status(), 'success');
        resolve();
      } catch (error) { reject(error); }
    });
  });
  assert.equal(headers['fog-api-token'], 'secret-two');
  assert.equal(headers['fog-user-token'], 'user-two');
});

test('registry validates native login then uses stored API tokens for the session client', async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  let apiHeaders;
  let call = 0;
  globalThis.fetch = async (url, options) => {
    call += 1;
    if (call === 1) return new Response('<form><input name="uname"><input name="upass"></form>', { status: 200, headers: { 'set-cookie': 'PHPSESSID=test; Path=/' } });
    if (call === 2) return new Response('', { status: 302, headers: { location: 'index.php' } });
    if (call === 3) return new Response('<a href="index.php?node=logout">Logout</a>', { status: 200 });
    if (call === 4) return new Response('', { status: 302, headers: { location: 'index.php' } });
    apiHeaders = options.headers;
    return new Response('success\n', { status: 200, headers: { 'content-type': 'application/json' } });
  };
  const authenticated = await registryFixture().authenticate('one', 'technician', 'correct horse');
  assert.equal(authenticated.serverId, 'one');
  assert.equal(authenticated.username, 'technician');
  assert.equal(apiHeaders['fog-api-token'], 'secret-one');
  assert.equal(apiHeaders['fog-user-token'], 'user-one');
  assert.equal(Object.hasOwn(apiHeaders, 'authorization'), false);
  assert.equal(Object.hasOwn(authenticated, 'password'), false);
});
