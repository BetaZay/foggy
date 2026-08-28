import { FogError } from './errors.js';

function mergeCookies(jar, response) {
  const values = typeof response.headers.getSetCookie === 'function'
    ? response.headers.getSetCookie()
    : [response.headers.get('set-cookie')].filter(Boolean);
  for (const value of values) {
    const pair = String(value).split(';', 1)[0];
    const separator = pair.indexOf('=');
    if (separator < 1) continue;
    const name = pair.slice(0, separator).trim();
    const cookieValue = pair.slice(separator + 1).trim();
    if (cookieValue) jar.set(name, cookieValue);
    else jar.delete(name);
  }
}

function cookieHeader(jar) {
  return [...jar].map(([name, value]) => `${name}=${value}`).join('; ');
}

async function request(url, { timeoutMs, jar, method = 'GET', body } = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  let response;
  try {
    response = await fetch(url, {
      method,
      redirect: 'manual',
      signal: controller.signal,
      headers: {
        accept: 'text/html,application/xhtml+xml',
        'user-agent': 'Foggy login validator',
        ...(jar.size ? { cookie: cookieHeader(jar) } : {}),
        ...(body ? { 'content-type': 'application/x-www-form-urlencoded' } : {}),
      },
      body,
    });
  } catch (error) {
    throw new FogError(error.name === 'AbortError'
      ? `FOG login timed out after ${timeoutMs}ms`
      : 'Unable to reach the FOG login page', {
      cause: error,
      code: 'FOG_LOGIN_UNREACHABLE',
    });
  } finally {
    clearTimeout(timeout);
  }
  mergeCookies(jar, response);
  return response;
}

export async function validateFogWebLogin(server, username, password) {
  const managementUrl = `${server.baseUrl.replace(/\/+$/, '')}/management/index.php`;
  const jar = new Map();
  let authenticated = false;
  try {
    const initial = await request(managementUrl, { timeoutMs: server.timeoutMs, jar });
    if (initial.status >= 400) {
      throw new FogError(`FOG login page returned HTTP ${initial.status}`, {
        status: initial.status,
        code: 'FOG_LOGIN_HTTP_ERROR',
      });
    }
    await initial.arrayBuffer();

    const login = await request(managementUrl, {
      timeoutMs: server.timeoutMs,
      jar,
      method: 'POST',
      body: new URLSearchParams({ uname: username, upass: password, login: '1' }).toString(),
    });
    if (login.status >= 400) {
      throw new FogError(`FOG login returned HTTP ${login.status}`, {
        status: login.status,
        code: 'FOG_LOGIN_HTTP_ERROR',
      });
    }
    await login.arrayBuffer();

    const check = await request(`${managementUrl}?node=home`, { timeoutMs: server.timeoutMs, jar });
    if (check.status >= 400) {
      throw new FogError(`FOG login verification returned HTTP ${check.status}`, {
        status: check.status,
        code: 'FOG_LOGIN_HTTP_ERROR',
      });
    }
    const html = await check.text();
    const isLoginForm = /name=["']uname["']/i.test(html) && /name=["']upass["']/i.test(html);
    authenticated = !isLoginForm && /node=logout/i.test(html);
    if (!authenticated) {
      throw new FogError('FOG rejected the management login', {
        status: 401,
        code: 'FOG_LOGIN_REJECTED',
      });
    }
    return true;
  } finally {
    if (jar.size) {
      try {
        const logout = await request(`${managementUrl}?node=logout`, { timeoutMs: server.timeoutMs, jar });
        await logout.arrayBuffer();
      } catch {
        // The temporary remote session will expire in FOG if logout cannot complete.
      }
    }
  }
}
