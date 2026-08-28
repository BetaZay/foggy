import crypto from 'node:crypto';
import { parseCookies, privateCookieOptions } from '../lib/cookies.js';

const PRE_AUTH_CSRF_TTL = 10 * 60 * 1000;
const SERVER_CONFIG_CSRF_SECRET = crypto.randomBytes(32);

function equalToken(actual, expected) {
  const left = Buffer.from(String(actual || ''), 'utf8');
  const right = Buffer.from(String(expected || ''), 'utf8');
  return left.length > 0 && left.length === right.length && crypto.timingSafeEqual(left, right);
}

function serverConfigSignature(payload) {
  return crypto.createHmac('sha256', SERVER_CONFIG_CSRF_SECRET)
    .update(`server-config:${payload}`)
    .digest('base64url');
}

function securityLog(event, request, details = {}) {
  console.warn(JSON.stringify({
    timestamp: new Date().toISOString(),
    level: 'warn',
    scope: 'security',
    event,
    method: String(request.method || '').slice(0, 12),
    path: String(request.path || '').slice(0, 160),
    host: String(request.get('host') || '').slice(0, 160),
    originPresent: Boolean(request.get('origin')),
    secure: Boolean(request.secure),
    forwardedProto: String(request.get('x-forwarded-proto') || '').slice(0, 40),
    ...details,
  }));
}

export function safeReturnTo(value, fallback = '/') {
  const path = String(value || '');
  return /^\/(?!\/)/.test(path) ? path : fallback;
}

export function issuePreAuthCsrf(request, response) {
  const token = crypto.randomBytes(32).toString('base64url');
  response.cookie('foggy_login_csrf', token, privateCookieOptions(request, PRE_AUTH_CSRF_TTL));
  return token;
}

export function issueServerConfigCsrf(now = Date.now()) {
  const payload = `${now}.${crypto.randomBytes(24).toString('base64url')}`;
  return `${payload}.${serverConfigSignature(payload)}`;
}

export function verifyServerConfigCsrf(token, now = Date.now()) {
  const parts = String(token || '').split('.');
  if (parts.length !== 3) return false;
  const [issuedValue, nonce, signature] = parts;
  const issuedAt = Number(issuedValue);
  if (!Number.isSafeInteger(issuedAt) || !/^[A-Za-z0-9_-]{32}$/.test(nonce)) return false;
  const age = now - issuedAt;
  if (age < 0 || age > PRE_AUTH_CSRF_TTL) return false;
  return equalToken(signature, serverConfigSignature(`${issuedValue}.${nonce}`));
}

export function requireSameOrigin(request, response, next) {
  const origin = request.get('origin');
  let originHost = '';
  try { originHost = new URL(origin).host; } catch { /* rejected below */ }
  if (!originHost || originHost !== request.get('host')) {
    return response.status(403).send('A same-origin form submission is required.');
  }
  return next();
}

export function requireAuthentication(request, response, next) {
  if (request.session) return next();
  if (['GET', 'HEAD'].includes(request.method)) {
    const returnTo = encodeURIComponent(safeReturnTo(request.originalUrl));
    return response.redirect(303, `/login?returnTo=${returnTo}`);
  }
  return response.status(401).send('Your Foggy session has expired. Sign in again.');
}

export function requireCsrf(request, response, next) {
  if (!request.session || !equalToken(request.body?._csrf, request.session.csrfToken)) {
    return response.status(403).send('The form security token is missing or expired. Reload the page and try again.');
  }
  return requireSameOrigin(request, response, next);
}

export function requireLoginCsrf(request, response, next) {
  const cookieToken = parseCookies(request.get('cookie')).foggy_login_csrf;
  if (!equalToken(request.body?._csrf, cookieToken)) {
    return response.status(403).send('The sign-in form has expired. Reload the page and try again.');
  }
  return requireSameOrigin(request, response, next);
}

export function requireServerConfigCsrf(request, response, next) {
  if (!verifyServerConfigCsrf(request.body?._csrf)) {
    securityLog('server_config_csrf_rejected', request, {
      challengePresent: Boolean(request.body?._csrf),
    });
    return response.status(403).send('The server configuration form has expired. Reload it and try again.');
  }
  return requireSameOrigin(request, response, next);
}
