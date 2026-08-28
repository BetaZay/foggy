import test from 'node:test';
import assert from 'node:assert/strict';
import { FogClient } from '../src/fog/client.js';

test('FOG client sends header-ready application and user tokens verbatim', async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });

  let observed;
  globalThis.fetch = async (url, options) => {
    observed = { url, options };
    return new Response(JSON.stringify({ count: 0, hosts: [] }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };

  const client = new FogClient({
    baseUrl: 'https://fog.example.test/fog/',
    apiToken: 'application-token',
    userToken: 'user-token',
    timeoutMs: 100,
  });
  const payload = await client.get('/host');

  assert.equal(observed.url, 'https://fog.example.test/fog/host');
  assert.equal(observed.options.headers['fog-api-token'], 'application-token');
  assert.equal(observed.options.headers['fog-user-token'], 'user-token');
  assert.deepEqual(payload, { count: 0, hosts: [] });
});

test('FOG client forwards multipart bodies without overriding their boundary header', async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  let observed;
  globalThis.fetch = async (url, options) => {
    observed = { url, options };
    return new Response(JSON.stringify({ id: 5, name: 'Agent' }), {
      status: 201, headers: { 'content-type': 'application/json' },
    });
  };
  const client = new FogClient({
    baseUrl: 'https://fog.example.test/fog', apiToken: 'app', userToken: 'user',
  });
  const form = new FormData();
  form.append('snapin', 'Agent');
  await client.postForm('snapin/createwithfile', form, { responseType: 'json', timeoutMs: 5000 });
  assert.equal(observed.options.body, form);
  assert.equal(Object.hasOwn(observed.options.headers, 'content-type'), false);
});

test('FOG client rejects redirects instead of following the management login page', async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });

  globalThis.fetch = async () => new Response('', {
    status: 302,
    headers: { location: '/fog/management/index.php' },
  });

  const client = new FogClient({
    baseUrl: 'http://fog.example.test/fog',
    apiToken: 'application-token',
    userToken: 'user-token',
  });

  await assert.rejects(
    () => client.get('host', { responseType: 'json' }),
    (error) => error.code === 'FOG_API_REDIRECT' && error.status === 302,
  );
});

test('FOG client accepts explicitly requested plain text when FOG labels it JSON', async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });

  globalThis.fetch = async () => new Response('success\n', {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });

  const client = new FogClient({
    baseUrl: 'http://fog.example.test/fog',
    apiToken: 'application-token',
    userToken: 'user-token',
  });

  assert.equal(await client.get('system/info', { responseType: 'text' }), 'success');
});
