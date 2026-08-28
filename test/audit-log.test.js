import test from 'node:test';
import assert from 'node:assert/strict';
import { authLog } from '../src/lib/audit-log.js';

test('authentication logs are structured and ignore secret-bearing fields', (t) => {
  const originalWarn = console.warn;
  let output = '';
  console.warn = (value) => { output = value; };
  t.after(() => { console.warn = originalWarn; });

  authLog('warn', 'login_failed', {
    requestId: 'request-1', serverId: 'primary', serverName: 'Main FOG',
    serverHost: 'fog.test', username: 'tech\nforged', remoteAddress: '127.0.0.1',
    status: 401, code: 'FOG_HTTP_ERROR', durationMs: 12.4,
    password: 'never-log-password', apiToken: 'never-log-api-token',
    authorization: 'never-log-authorization',
  });

  const entry = JSON.parse(output);
  assert.equal(entry.event, 'login_failed');
  assert.equal(entry.username, 'tech forged');
  assert.equal(entry.upstreamStatus, 401);
  assert.equal(entry.code, 'FOG_HTTP_ERROR');
  assert.equal(entry.durationMs, 12);
  assert.doesNotMatch(output, /never-log/);
  assert.equal(Object.hasOwn(entry, 'password'), false);
  assert.equal(Object.hasOwn(entry, 'apiToken'), false);
  assert.equal(Object.hasOwn(entry, 'authorization'), false);
});
