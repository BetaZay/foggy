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
  verifyPreAuthCsrf,
  verifyServerConfigCsrf,
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

test('login CSRF uses a time-limited signed challenge and safe redirects stay local', () => {
  const issuedAt = Date.now();
  const loginToken = issuePreAuthCsrf(issuedAt);
  assert.equal(verifyPreAuthCsrf(loginToken, issuedAt + 60_000), true);
  assert.equal(verifyPreAuthCsrf(loginToken, issuedAt + 10 * 60 * 1000 + 1), false);
  assert.equal(verifyPreAuthCsrf(`${loginToken}tampered`, issuedAt + 60_000), false);
  let continued = false;
  const valid = request({
    body: { _csrf: loginToken },
    get: (name) => ({ cookie: '', origin: 'http://foggy.test', host: 'foggy.test' })[name] || '',
  });
  requireLoginCsrf(valid, responseDouble(), () => { continued = true; });
  assert.equal(continued, true);
  assert.equal(safeReturnTo('/tasks?status=active'), '/tasks?status=active');
  assert.equal(safeReturnTo('//attacker.test'), '/');
  assert.equal(safeReturnTo('https://attacker.test'), '/');
});

test('server configuration uses a separate pre-auth CSRF challenge', () => {
  const response = responseDouble();
  const loginToken = issuePreAuthCsrf();
  const issuedAt = Date.now();
  const serverToken = issueServerConfigCsrf(issuedAt);
  assert.notEqual(loginToken, serverToken);
  assert.deepEqual(response.cookies, []);
  assert.equal(verifyServerConfigCsrf(serverToken, issuedAt + 60_000), true);
  assert.equal(verifyServerConfigCsrf(serverToken, issuedAt + 10 * 60 * 1000 + 1), false);
  assert.equal(verifyServerConfigCsrf(`${serverToken}tampered`, issuedAt + 60_000), false);

  let continued = false;
  const valid = request({
    body: { _csrf: serverToken },
    get: (name) => ({ cookie: '', origin: 'http://foggy.test', host: 'foggy.test' })[name] || '',
  });
  requireServerConfigCsrf(valid, responseDouble(), () => { continued = true; });
  assert.equal(continued, true);
});

test('empty CSRF values never validate', () => {
  let continued = false;
  requireCsrf(request({ body: {}, session: { csrfToken: '' } }), responseDouble(), () => { continued = true; });
  assert.equal(continued, false);
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
