import { FogError } from './errors.js';

function encodeHeader(value) {
  return Buffer.from(value, 'utf8').toString('base64');
}

export class FogClient {
  constructor({ baseUrl, apiToken, userToken, username, password, timeoutMs = 10_000 }) {
    this.baseUrl = baseUrl.replace(/\/+$/, '');
    this.timeoutMs = timeoutMs;
    this.headers = {
      accept: 'application/json',
      'fog-api-token': apiToken,
    };

    if (userToken) {
      this.headers['fog-user-token'] = userToken;
    } else {
      this.headers.authorization = `Basic ${encodeHeader(`${username}:${password}`)}`;
    }
  }

  async request(path, options = {}) {
    const controller = new AbortController();
    const requestTimeoutMs = options.timeoutMs || this.timeoutMs;
    const timeout = setTimeout(() => controller.abort(), requestTimeoutMs);
    const url = `${this.baseUrl}/${path.replace(/^\/+/, '')}`;
    const headers = { ...this.headers, ...options.headers };

    if (options.body !== undefined && options.rawBody === undefined) {
      headers['content-type'] = 'application/json';
    }

    let response;
    try {
      response = await fetch(url, {
        method: options.method || 'GET',
        headers,
        body: options.rawBody !== undefined
          ? options.rawBody
          : (options.body === undefined ? undefined : JSON.stringify(options.body)),
        signal: controller.signal,
        redirect: 'manual',
      });
    } catch (error) {
      const message = error.name === 'AbortError'
        ? `FOG request timed out after ${requestTimeoutMs}ms`
        : 'Unable to reach the FOG server';
      throw new FogError(message, { cause: error, code: 'FOG_UNREACHABLE' });
    } finally {
      clearTimeout(timeout);
    }

    const text = await response.text();
    if (response.status >= 300 && response.status < 400) {
      throw new FogError('FOG redirected the API request; verify that the API is enabled', {
        status: response.status,
        code: 'FOG_API_REDIRECT',
      });
    }
    if (!response.ok) {
      throw new FogError(`FOG returned HTTP ${response.status}`, {
        status: response.status,
        code: 'FOG_HTTP_ERROR',
      });
    }
    if (!text.trim()) return null;

    if (options.responseType === 'text') return text.trim();

    const contentType = response.headers.get('content-type') || '';
    if (contentType.includes('json') || /^[\[{]/.test(text.trim())) {
      try {
        return JSON.parse(text);
      } catch (error) {
        throw new FogError('FOG returned invalid JSON', {
          cause: error,
          code: 'FOG_INVALID_RESPONSE',
        });
      }
    }
    if (options.responseType === 'json') {
      throw new FogError('FOG returned a non-JSON response for an API resource', {
        code: 'FOG_INVALID_RESPONSE',
      });
    }
    return text.trim();
  }

  get(path, options = {}) {
    return this.request(path, options);
  }

  put(path, body, options = {}) {
    return this.request(path, { ...options, method: 'PUT', body });
  }

  post(path, body, options = {}) {
    return this.request(path, { ...options, method: 'POST', body });
  }

  postForm(path, formData, options = {}) {
    return this.request(path, { ...options, method: 'POST', rawBody: formData });
  }

  delete(path, options = {}) {
    return this.request(path, { ...options, method: 'DELETE' });
  }
}
