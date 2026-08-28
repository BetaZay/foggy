import test from 'node:test';
import assert from 'node:assert/strict';
import { healthCheck } from '../src/app.js';

test('health endpoint is unauthenticated and reveals no server state', () => {
  const response = {
    statusCode: 0,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
  healthCheck({}, response);
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.body, { status: 'ok' });
});
