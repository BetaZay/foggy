import crypto from 'node:crypto';
import { Router } from 'express';
import { issuePreAuthCsrf, requireCsrf, requireLoginCsrf, safeReturnTo } from '../auth/security.js';
import { parseCookies, privateCookieOptions } from '../lib/cookies.js';
import { authLog, serverHost } from '../lib/audit-log.js';

const LOGIN_ATTEMPT_WINDOW = 5 * 60 * 1000;
const LOGIN_ATTEMPT_LIMIT = 5;

class LoginLimiter {
  constructor() { this.attempts = new Map(); }

  key(request, serverId, username) {
    return `${request.ip}|${serverId}|${String(username).toLowerCase()}`;
  }

  isBlocked(key) {
    const entry = this.attempts.get(key);
    if (!entry) return false;
    if (entry.startedAt + LOGIN_ATTEMPT_WINDOW <= Date.now()) {
      this.attempts.delete(key);
      return false;
    }
    return entry.failures >= LOGIN_ATTEMPT_LIMIT;
  }

  fail(key) {
    const current = this.attempts.get(key);
    const entry = !current || current.startedAt + LOGIN_ATTEMPT_WINDOW <= Date.now()
      ? { failures: 0, startedAt: Date.now() }
      : current;
    entry.failures += 1;
    this.attempts.set(key, entry);
  }

  succeed(key) { this.attempts.delete(key); }
}

function loginMessage(error) {
  if (error?.code === 'FOG_SERVER_SETUP_REQUIRED') return 'This server needs a FOG user API token before anyone can sign in.';
  if (['FOG_UNREACHABLE', 'FOG_LOGIN_UNREACHABLE'].includes(error?.code)) return 'Foggy could not reach that FOG server.';
  if (error?.code === 'FOG_API_REDIRECT') return 'The FOG API is disabled or redirected to the management interface.';
  if (error?.code === 'FOG_LOGIN_REJECTED') return 'FOG rejected that username or password.';
  if (error?.code === 'FOG_LOGIN_HTTP_ERROR') return 'FOG returned an error from its management login page.';
  if ([401, 403].includes(error?.status)) return 'FOG rejected the username, password, or configured application token.';
  return 'FOG could not validate this sign-in. Check the server and try again.';
}

function renderLogin(request, response, registry, options = {}) {
  const servers = registry.listPublic();
  const requestedId = String(options.values?.serverId || request.query.server || '');
  const selected = registry.get(requestedId) || registry.resolve();
  return response.status(options.status || 200).render('pages/auth/login', {
    title: 'Sign in',
    servers,
    values: {
      serverId: selected?.id || '',
      username: String(options.values?.username || ''),
      returnTo: safeReturnTo(options.values?.returnTo || request.query.returnTo),
    },
    error: options.error || '',
    referenceId: options.referenceId || '',
    serverAdded: request.query.added === '1',
    loginCsrfToken: issuePreAuthCsrf(),
  });
}

export function createAuthRouter(registry, sessions) {
  const router = Router();
  const limiter = new LoginLimiter();

  router.get('/login', (request, response) => {
    if (!registry.listPublic().length) return response.redirect(303, '/servers/new');
    return renderLogin(request, response, registry);
  });

  router.post('/login', requireLoginCsrf, async (request, response) => {
    const requestId = crypto.randomUUID();
    const startedAt = Date.now();
    response.set('X-Request-ID', requestId);
    const values = {
      serverId: String(request.body.serverId || ''),
      username: String(request.body.username || '').trim(),
      returnTo: safeReturnTo(request.body.returnTo),
    };
    const password = String(request.body.password || '');
    const server = registry.get(values.serverId);
    const logDetails = {
      requestId,
      serverId: server?.id || values.serverId,
      serverName: server?.name,
      serverHost: serverHost(server),
      username: values.username,
      remoteAddress: request.ip,
    };
    if (!registry.get(values.serverId) || !values.username || !password) {
      authLog('warn', 'login_rejected_input', {
        ...logDetails,
        durationMs: Date.now() - startedAt,
        code: 'LOGIN_INPUT_INVALID',
      });
      return renderLogin(request, response, registry, {
        status: 422, values, error: 'Select a server and enter your FOG username and password.', referenceId: requestId,
      });
    }
    const attemptKey = limiter.key(request, values.serverId, values.username);
    if (limiter.isBlocked(attemptKey)) {
      authLog('warn', 'login_rate_limited', {
        ...logDetails,
        durationMs: Date.now() - startedAt,
        code: 'LOGIN_RATE_LIMITED',
      });
      return renderLogin(request, response, registry, {
        status: 429, values, error: 'Too many failed attempts. Wait five minutes before trying this account again.', referenceId: requestId,
      });
    }
    authLog('info', 'login_attempt', logDetails);
    try {
      const authenticated = await registry.authenticate(values.serverId, values.username, password);
      limiter.succeed(attemptKey);
      const oldId = parseCookies(request.get('cookie')).foggy_session;
      sessions.destroy(oldId);
      const session = sessions.create(authenticated);
      response.cookie('foggy_session', session.id, privateCookieOptions(request, sessions.ttlMs));
      response.clearCookie('foggy_login_csrf', { path: '/' });
      response.clearCookie('foggy_server', { path: '/' });
      authLog('info', 'login_succeeded', {
        ...logDetails,
        durationMs: Date.now() - startedAt,
        status: 200,
      });
      return response.redirect(303, values.returnTo);
    } catch (error) {
      limiter.fail(attemptKey);
      authLog('warn', 'login_failed', {
        ...logDetails,
        durationMs: Date.now() - startedAt,
        status: Number.isInteger(error?.status) ? error.status : undefined,
        code: error?.code || error?.name || 'UNKNOWN_ERROR',
      });
      return renderLogin(request, response, registry, {
        status: [401, 403].includes(error?.status) ? 401 : 503,
        values,
        error: loginMessage(error),
        referenceId: requestId,
      });
    }
  });

  router.post('/logout', requireCsrf, (request, response) => {
    authLog('info', 'logout', {
      requestId: crypto.randomUUID(),
      serverId: request.fogServer?.id,
      serverName: request.fogServer?.name,
      serverHost: serverHost(request.fogServer),
      username: request.session.username,
      remoteAddress: request.ip,
    });
    sessions.destroy(request.session.id);
    response.clearCookie('foggy_session', { path: '/' });
    return response.redirect(303, '/login');
  });

  return router;
}
