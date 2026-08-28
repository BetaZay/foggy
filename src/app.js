import path from 'node:path';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { requireAuthentication } from './auth/security.js';
import { SessionStore } from './auth/session-store.js';
import { ConfigStore } from './config/config-store.js';
import { env } from './config/env.js';
import { createFogContext, FogRegistry } from './fog/registry.js';
import { loadAssets } from './lib/assets.js';
import { formatBytes, formatBytesPerMinute, formatDate } from './lib/format.js';
import { createPageRouter } from './routes/pages.js';
import { createAuthRouter } from './routes/auth.js';
import { createServerRouter } from './routes/servers.js';
import { createUpdateRouter } from './routes/updates.js';
import { UpdateManager } from './updates/manager.js';

const rootDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const packageVersion = JSON.parse(readFileSync(path.join(rootDirectory, 'package.json'), 'utf8')).version;

export function healthCheck(req, res) {
  return res.status(200).json({ status: 'ok' });
}

export function createApp({
  registry = new FogRegistry(new ConfigStore(env.configFile, { seed: env.fog })),
  sessions = new SessionStore({ ttlMs: env.sessionTtlMs, filePath: env.sessionFile }),
  updates = new UpdateManager({
    currentVersion: packageVersion,
    enabled: env.updatesEnabled,
    requestFile: env.updateRequestFile,
    statusFile: env.updateStatusFile,
  }),
} = {}) {
  const app = express();
  const fogContext = createFogContext(registry, sessions);
  const productionAssets = env.isProduction ? loadAssets(env, rootDirectory) : null;

  app.disable('x-powered-by');
  app.set('view engine', 'ejs');
  app.set('views', path.join(rootDirectory, 'src/views'));
  app.locals.formatBytes = formatBytes;
  app.locals.formatBytesPerMinute = formatBytesPerMinute;
  app.locals.formatDate = formatDate;

  app.use((req, res, next) => {
    res.locals.assets = productionAssets || loadAssets(env, rootDirectory, req.hostname);
    next();
  });

  app.use('/assets', express.static(path.join(rootDirectory, 'public/assets'), {
    immutable: env.isProduction,
    maxAge: env.isProduction ? '1y' : 0,
  }));
  app.use('/brand', express.static(path.join(rootDirectory, 'public/brand'), {
    index: false,
    maxAge: env.isProduction ? '7d' : 0,
  }));
  app.get('/healthz', healthCheck);
  app.use(express.urlencoded({ extended: false }));
  app.use(fogContext.middleware);
  app.use(createAuthRouter(registry, sessions));
  app.use(createServerRouter(registry, sessions));
  app.use(requireAuthentication);
  app.use(createUpdateRouter(updates));
  app.use(createPageRouter(fogContext.fog));

  app.use((req, res) => {
    res.status(404).render('pages/error', {
      title: 'Page not found',
      currentPath: req.path,
      status: 404,
      message: 'The page you requested does not exist.',
    });
  });

  app.use((error, req, res, next) => {
    if (res.headersSent) return next(error);
    console.error('Unhandled request error', error);
    return res.status(500).render('pages/error', {
      title: 'Something went wrong',
      currentPath: req.path,
      status: 500,
      message: 'Foggy could not complete this request.',
    });
  });

  return app;
}
