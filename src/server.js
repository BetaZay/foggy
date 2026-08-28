import { createApp } from './app.js';
import { env } from './config/env.js';

const app = createApp();
const server = app.listen(env.port, env.host, () => {
  console.log(`Foggy listening on http://${env.host}:${env.port} (config: ${env.configFile})`);
});

let shuttingDown = false;
function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`${signal} received, closing Foggy`);
  const forcedExit = setTimeout(() => {
    console.error('Foggy shutdown timed out; closing remaining connections');
    server.closeAllConnections?.();
    process.exit(1);
  }, 10_000);
  forcedExit.unref();
  server.close(() => {
    clearTimeout(forcedExit);
    process.exit(0);
  });
  server.closeIdleConnections?.();
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
