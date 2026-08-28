import crypto from 'node:crypto';
import { Router } from 'express';
import { requireCsrf } from '../auth/security.js';
import { UpdateError } from '../updates/manager.js';

function updateLog(level, event, request, details = {}) {
  const entry = {
    timestamp: new Date().toISOString(),
    level,
    scope: 'updates',
    event,
    requestId: details.requestId,
    username: String(request.session?.username || '').slice(0, 80),
    remoteAddress: String(request.ip || '').slice(0, 80),
    version: String(details.version || '').slice(0, 40),
    code: String(details.code || '').slice(0, 80),
  };
  const output = JSON.stringify(entry);
  if (level === 'error') console.error(output);
  else if (level === 'warn') console.warn(output);
  else console.info(output);
}

async function renderUpdates(request, response, updates, options = {}) {
  const status = await updates.status();
  return response.status(options.httpStatus || 200).render('pages/administration/updates', {
    title: 'Updates',
    currentPath: '/administration/updates',
    status,
    requested: options.requested || request.query.requested === '1',
    formError: options.formError || '',
  });
}

export function createUpdateRouter(updates) {
  const router = Router();

  router.get('/administration/updates', (request, response, next) => {
    renderUpdates(request, response, updates).catch(next);
  });

  router.post('/administration/updates', requireCsrf, async (request, response, next) => {
    const requestId = crypto.randomUUID();
    response.set('X-Request-ID', requestId);
    if (String(request.body.confirmation || '').trim() !== 'UPDATE') {
      updateLog('warn', 'update_rejected_confirmation', request, { requestId, code: 'CONFIRMATION_INVALID' });
      return renderUpdates(request, response, updates, {
        httpStatus: 422,
        formError: 'Enter UPDATE exactly to confirm the service restart.',
      }).catch(next);
    }
    try {
      const release = await updates.requestUpdate(request.session.username);
      updateLog('info', 'update_queued', request, { requestId, version: release.version });
      return response.redirect(303, '/administration/updates?requested=1');
    } catch (error) {
      updateLog('warn', 'update_rejected', request, {
        requestId,
        code: error?.code || error?.name || 'UNKNOWN_ERROR',
      });
      const message = error instanceof UpdateError
        ? error.message
        : 'Foggy could not queue the update request.';
      return renderUpdates(request, response, updates, { httpStatus: 409, formError: message }).catch(next);
    }
  });

  return router;
}
