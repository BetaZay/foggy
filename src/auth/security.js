import crypto from 'node:crypto';
import { parseCookies, privateCookieOptions } from '../lib/cookies.js';

const PRE_AUTH_CSRF_TTL = 10 * 60 * 1000;

function equalToken(actual, expected) {
  const left = Buffer.from(String(actual || ''), 'utf8');
  const right = Buffer.from(String(expected || ''), 'utf8');
  return left.length === right.length && crypto.timingSafeEqual(left, right);
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

export function issueServerConfigCsrf(request, response) {
  const token = crypto.randomBytes(32).toString('base64url');
  response.cookie('foggy_server_csrf', token, privateCookieOptions(request, PRE_AUTH_CSRF_TTL));
  return token;
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
  const cookieToken = parseCookies(request.get('cookie')).foggy_server_csrf;
  if (!equalToken(request.body?._csrf, cookieToken)) {
    return response.status(403).send('The server configuration form has expired. Reload it and try again.');
  }
  return requireSameOrigin(request, response, next);
}
