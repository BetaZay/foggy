import test from 'node:test';
import assert from 'node:assert/strict';
import {
  issuePreAuthCsrf,
  issueServerConfigCsrf,
  requireAuthentication,
  requireCsrf,
  requireLoginCsrf,
  requireServerConfigCsrf,
  safeReturnTo,
} from '../src/auth/security.js';
import { privateCookieOptions } from '../src/lib/cookies.js';

function responseDouble() {
  return {
    statusCode: 200, body: '', location: '', cookies: [],
    status(code) { this.statusCode = code; return this; },
    send(body) { this.body = body; return this; },
    redirect(code, location) { this.statusCode = code; this.location = location; return this; },
    cookie(name, value, options) { this.cookies.push({ name, value, options }); return this; },
  };
}

function request(overrides = {}) {
  const headers = { origin: 'http://foggy.test', host: 'foggy.test', cookie: '' };
  return {
    method: 'POST', originalUrl: '/deploy', body: {}, session: null,
    get: (name) => headers[name] || '',
    ...overrides,
  };
}

test('authentication redirects reads and rejects unauthenticated writes', () => {
  const read = responseDouble();
  requireAuthentication(request({ method: 'GET', originalUrl: '/computers?search=LAB' }), read, () => {});
  assert.equal(read.statusCode, 303);
  assert.match(read.location, /^\/login\?returnTo=/);

  const write = responseDouble();
  requireAuthentication(request(), write, () => {});
  assert.equal(write.statusCode, 401);
});

test('session CSRF requires both the token and same origin', () => {
  let continued = false;
  const valid = request({ body: { _csrf: 'secret' }, session: { csrfToken: 'secret' } });
  requireCsrf(valid, responseDouble(), () => { continued = true; });
  assert.equal(continued, true);

  const invalid = responseDouble();
  requireCsrf(request({ body: { _csrf: 'wrong' }, session: { csrfToken: 'secret' } }), invalid, () => {});
  assert.equal(invalid.statusCode, 403);
});

test('login CSRF uses the HttpOnly challenge cookie and safe redirects stay local', () => {
  let continued = false;
  const valid = request({
    body: { _csrf: 'challenge' },
    get: (name) => ({ cookie: 'foggy_login_csrf=challenge', origin: 'http://foggy.test', host: 'foggy.test' })[name] || '',
  });
  requireLoginCsrf(valid, responseDouble(), () => { continued = true; });
  assert.equal(continued, true);
  assert.equal(safeReturnTo('/tasks?status=active'), '/tasks?status=active');
  assert.equal(safeReturnTo('//attacker.test'), '/');
  assert.equal(safeReturnTo('https://attacker.test'), '/');
});

test('server configuration uses a separate pre-auth CSRF challenge', () => {
  const response = responseDouble();
  const loginToken = issuePreAuthCsrf(request(), response);
  const serverToken = issueServerConfigCsrf(request(), response);
  assert.notEqual(loginToken, serverToken);
  assert.deepEqual(response.cookies.map(({ name }) => name), ['foggy_login_csrf', 'foggy_server_csrf']);

  let continued = false;
  const valid = request({
    body: { _csrf: serverToken },
    get: (name) => ({ cookie: `foggy_server_csrf=${serverToken}; foggy_login_csrf=${loginToken}`, origin: 'http://foggy.test', host: 'foggy.test' })[name] || '',
  });
  requireServerConfigCsrf(valid, responseDouble(), () => { continued = true; });
  assert.equal(continued, true);
});

test('authenticated session cookies are persistent and browser-protected', () => {
  assert.deepEqual(privateCookieOptions({ secure: true }, 60 * 60 * 1000), {
    httpOnly: true,
    sameSite: 'strict',
    secure: true,
    maxAge: 60 * 60 * 1000,
    path: '/',
  });
});
