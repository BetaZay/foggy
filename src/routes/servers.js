import crypto from 'node:crypto';
import { Router } from 'express';
import {
  issueServerConfigCsrf,
  requireCsrf,
  requireServerConfigCsrf,
  safeReturnTo,
} from '../auth/security.js';
import { authLog, serverHost } from '../lib/audit-log.js';

function formValues(body = {}) {
  return {
    name: String(body.name || ''),
    baseUrl: String(body.baseUrl || ''),
    timeoutMs: String(body.timeoutMs || '10000'),
  };
}

function isModalRequest(request) {
  return request.get('HX-Request') === 'true' || request.query.modal === '1';
}

function renderServerForm(request, response, options = {}) {
  const modal = isModalRequest(request);
  return response.status(modal ? 200 : (options.status || 200)).render(
    modal ? 'pages/servers/form' : 'pages/servers/new', {
    title: options.heading || 'Add FOG server',
    heading: options.heading || 'Add a FOG server',
    description: options.description || 'Foggy stores both API tokens only on this server.',
    action: options.action || '/servers',
    submitLabel: options.submitLabel || 'Add server',
    values: options.values || formValues(),
    errors: options.errors || {},
    formError: options.formError || '',
    cancelHref: request.session ? '/' : '/login',
    preAuthCsrfToken: issueServerConfigCsrf(),
    modal,
  });
}

function connectionChanged(request, response, location) {
  if (request.get('HX-Request') === 'true') {
    response.set('HX-Redirect', location);
    return response.status(204).send();
  }
  return response.redirect(303, location);
}

export function createServerRouter(registry, sessions) {
  const router = Router();

  router.post('/servers/select', requireCsrf, (request, response) => {
    const server = registry.get(String(request.body.serverId || ''));
    if (!server) return response.status(422).send('Select a configured FOG server.');
    const requestId = crypto.randomUUID();
    response.set('X-Request-ID', requestId);
    authLog('info', 'server_switch_requested', {
      requestId,
      serverId: server.id,
      serverName: server.name,
      serverHost: serverHost(server),
      username: request.session.username,
      remoteAddress: request.ip,
    });
    sessions.destroy(request.session.id);
    response.clearCookie('foggy_session', { path: '/' });
    const returnTo = encodeURIComponent(safeReturnTo(request.body.returnTo));
    return response.redirect(303, `/login?server=${encodeURIComponent(server.id)}&returnTo=${returnTo}`);
  });

  router.get('/servers/manage', (request, response) => response.render('pages/servers/manager', {
    servers: registry.listPublic(),
    currentServerId: request.fogServer?.id || '',
    signedIn: Boolean(request.session),
    csrfToken: request.session?.csrfToken || '',
    returnTo: safeReturnTo(request.query.returnTo || request.get('referer')?.replace(/^https?:\/\/[^/]+/i, ''), '/'),
  }));

  router.get('/servers/new', (request, response) => renderServerForm(request, response));

  router.get('/servers/:id/edit', (request, response, next) => {
    const server = registry.get(String(request.params.id));
    if (!server) return next();
    return renderServerForm(request, response, {
      heading: `Configure ${server.name}`,
      description: 'Re-enter both API tokens. Existing secret values are never sent to the browser.',
      action: `/servers/${encodeURIComponent(server.id)}`,
      submitLabel: 'Save server',
      values: formValues(server),
    });
  });

  router.post('/servers', requireServerConfigCsrf, (request, response, next) => {
    const requestId = crypto.randomUUID();
    response.set('X-Request-ID', requestId);
    try {
      const server = registry.add({
        name: request.body.name,
        baseUrl: request.body.baseUrl,
        apiToken: request.body.apiToken,
        userToken: request.body.userToken,
        timeoutMs: request.body.timeoutMs,
      });
      authLog('info', 'server_added', {
        requestId,
        serverId: server.id,
        serverName: server.name,
        serverHost: serverHost(server),
        username: request.session?.username,
        remoteAddress: request.ip,
      });
      sessions.destroy(request.session?.id);
      response.clearCookie('foggy_session', { path: '/' });
      response.clearCookie('foggy_server_csrf', { path: '/' });
      return connectionChanged(request, response, `/login?server=${encodeURIComponent(server.id)}&added=1`);
    } catch (error) {
      authLog('warn', 'server_add_failed', {
        requestId,
        serverName: request.body.name,
        serverHost: serverHost({ baseUrl: request.body.baseUrl }),
        username: request.session?.username,
        remoteAddress: request.ip,
        code: error?.code || error?.name || 'UNKNOWN_ERROR',
        fields: Object.keys(error?.fields || {}),
      });
      if (error.code !== 'CONFIG_VALIDATION_ERROR') return next(error);
      return renderServerForm(request, response, {
        status: 422,
        values: formValues(request.body),
        errors: error.fields || {},
        formError: error.message,
      });
    }
  });

  router.post('/servers/:id', requireServerConfigCsrf, (request, response, next) => {
    const requestId = crypto.randomUUID();
    response.set('X-Request-ID', requestId);
    try {
      const server = registry.update(String(request.params.id), {
        name: request.body.name,
        baseUrl: request.body.baseUrl,
        apiToken: request.body.apiToken,
        userToken: request.body.userToken,
        timeoutMs: request.body.timeoutMs,
      });
      authLog('info', 'server_updated', {
        requestId, serverId: server.id, serverName: server.name,
        serverHost: serverHost(server), username: request.session?.username,
        remoteAddress: request.ip,
      });
      sessions.destroy(request.session?.id);
      response.clearCookie('foggy_session', { path: '/' });
      response.clearCookie('foggy_server_csrf', { path: '/' });
      return connectionChanged(request, response, `/login?server=${encodeURIComponent(server.id)}`);
    } catch (error) {
      authLog('warn', 'server_update_failed', {
        requestId, serverId: request.params.id, serverName: request.body.name,
        serverHost: serverHost({ baseUrl: request.body.baseUrl }),
        username: request.session?.username, remoteAddress: request.ip,
        code: error?.code || error?.name || 'UNKNOWN_ERROR',
        fields: Object.keys(error?.fields || {}),
      });
      if (error.code !== 'CONFIG_VALIDATION_ERROR') return next(error);
      return renderServerForm(request, response, {
        status: 422,
        heading: `Configure ${String(request.body.name || 'FOG server')}`,
        description: 'Re-enter both API tokens. Existing secret values are never sent to the browser.',
        action: `/servers/${encodeURIComponent(request.params.id)}`,
        submitLabel: 'Save server',
        values: formValues(request.body), errors: error.fields || {}, formError: error.message,
      });
    }
  });

  return router;
}
