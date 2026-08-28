import test from 'node:test';
import assert from 'node:assert/strict';
import { validateFogWebLogin } from '../src/fog/web-auth.js';

test('native FOG login rejects a returned management login form and clears the temporary session', async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  const requests = [];
  globalThis.fetch = async (url, options) => {
    requests.push({ url, options });
    if (requests.length === 1) return new Response('login', { status: 200, headers: { 'set-cookie': 'PHPSESSID=temporary; Path=/' } });
    if (requests.length === 2) return new Response('', { status: 302, headers: { location: 'index.php' } });
    if (requests.length === 3) return new Response('<input name="uname"><input name="upass">', { status: 200 });
    return new Response('', { status: 302, headers: { location: 'index.php' } });
  };

  await assert.rejects(
    () => validateFogWebLogin({ baseUrl: 'http://fog.test/fog', timeoutMs: 1000 }, 'technician', 'wrong password'),
    (error) => error.code === 'FOG_LOGIN_REJECTED' && error.status === 401,
  );
  assert.match(requests[1].options.body, /uname=technician/);
  assert.match(requests[1].options.headers.cookie, /PHPSESSID=temporary/);
  assert.match(requests.at(-1).url, /node=logout/);
});
