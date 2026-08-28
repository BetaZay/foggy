import { createApp } from './app.js';
import { env } from './config/env.js';

const app = createApp();
const server = app.listen(env.port, env.host, () => {
  console.log(`Foggy listening on http://${env.host}:${env.port} (config: ${env.configFile})`);
});

function shutdown(signal) {
  console.log(`${signal} received, closing Foggy`);
  server.close(() => process.exit(0));
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
