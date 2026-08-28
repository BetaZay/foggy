import { AsyncLocalStorage } from 'node:async_hooks';
import { createFog } from './index.js';
import { parseCookies } from '../lib/cookies.js';
import { FogError } from './errors.js';
import { validateFogWebLogin } from './web-auth.js';

export class FogRegistry {
  constructor(store) {
    this.store = store;
  }

  listPublic() {
    return this.store.listServers().map(({ id, name, baseUrl, configured, setupRequired }) => ({
      id, name, baseUrl, configured, setupRequired,
    }));
  }

  get(id) { return this.store.getServer(id); }

  resolve(id) {
    return this.get(id) || this.store.listServers()[0] || null;
  }

  async authenticate(serverId, username, password) {
    const server = this.get(serverId);
    if (!server) throw new TypeError('Select a configured FOG server.');
    if (!server.userToken) {
      throw new FogError('The selected server needs a FOG user API token', {
        code: 'FOG_SERVER_SETUP_REQUIRED',
      });
    }
    await validateFogWebLogin(server, username, password);
    const fog = createFog({
      ...server,
      userToken: server.userToken,
      username: '',
      password: '',
      configured: true,
    });
    await fog.system.status();
    return { serverId: server.id, username, fog };
  }

  add(input) {
    const server = this.store.addServer(input);
    return server;
  }

  update(id, input) { return this.store.updateServer(id, input); }
}

export function createFogContext(registry, sessions) {
  const storage = new AsyncLocalStorage();
  const resourceCache = new Map();
  const fog = new Proxy({}, {
    get(target, resource) {
      if (!resourceCache.has(resource)) {
        resourceCache.set(resource, new Proxy({}, {
          get(innerTarget, method) {
            return (...args) => {
              const active = storage.getStore();
              if (!active) throw new Error('A FOG operation was attempted outside a request context.');
              return active.fog[resource][method](...args);
            };
          },
        }));
      }
      return resourceCache.get(resource);
    },
  });

  function middleware(request, response, next) {
    const sessionId = parseCookies(request.get('cookie')).foggy_session;
    let session = sessions.get(sessionId);
    let server = session ? registry.get(session.serverId) : null;
    if (session && !server) {
      sessions.destroy(session.id);
      session = null;
    }
    const publicServers = registry.listPublic();
    response.locals.fogServers = publicServers;
    response.locals.currentFogServer = server ? { id: server.id, name: server.name, baseUrl: server.baseUrl } : null;
    response.locals.fogConfigured = Boolean(server);
    response.locals.fogServerName = server?.name || '';
    response.locals.fogServerReturnTo = /^\/(?!\/)/.test(request.originalUrl) ? request.originalUrl : '/';
    response.locals.currentUser = session ? { username: session.username } : null;
    response.locals.csrfToken = session?.csrfToken || '';
    request.session = session;
    request.fogServer = server;
    const activeFog = session?.fog || (server
      ? createFog({ ...server, configured: Boolean(server.configured) })
      : createFog({ configured: false }));
    storage.run({ server, fog: activeFog }, next);
  }

  return { fog, middleware };
}
