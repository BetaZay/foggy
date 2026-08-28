import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createUpdateRouter } from '../src/routes/updates.js';

async function withUpdateServer(run) {
  let requests = 0;
  const updates = {
    async status() { return {}; },
    async requestUpdate(username) {
      requests += 1;
      assert.equal(username, 'technician');
      return { version: '2026.8.12' };
    },
  };
  const app = express();
  app.use(express.urlencoded({ extended: false }));
  app.use((request, response, next) => {
    request.session = { username: 'technician', csrfToken: 'csrf-secret' };
    next();
  });
  app.use(createUpdateRouter(updates));
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  try {
    await run(`http://127.0.0.1:${server.address().port}`, () => requests);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
}

test('update mutation requires same-origin CSRF and exact confirmation before queueing', async () => {
  await withUpdateServer(async (origin, requestCount) => {
    const missingCsrf = await fetch(`${origin}/administration/updates`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', origin },
      body: 'confirmation=UPDATE',
      redirect: 'manual',
    });
    assert.equal(missingCsrf.status, 403);
    assert.equal(requestCount(), 0);

    const crossOrigin = await fetch(`${origin}/administration/updates`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', origin: 'https://attacker.test' },
      body: '_csrf=csrf-secret&confirmation=UPDATE',
      redirect: 'manual',
    });
    assert.equal(crossOrigin.status, 403);
    assert.equal(requestCount(), 0);

    const accepted = await fetch(`${origin}/administration/updates`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', origin },
      body: '_csrf=csrf-secret&confirmation=UPDATE',
      redirect: 'manual',
    });
    assert.equal(accepted.status, 303);
    assert.equal(accepted.headers.get('location'), '/administration/updates?requested=1');
    assert.equal(requestCount(), 1);
  });
});
