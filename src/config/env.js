import path from 'node:path';
import 'dotenv/config';

function parsePositiveInteger(name, fallback) {
  const value = process.env[name];
  if (!value) return fallback;

  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return parsed;
}

function parsePort(name, fallback) {
  const port = parsePositiveInteger(name, fallback);
  if (port > 65535) throw new Error(`${name} must be between 1 and 65535`);
  return port;
}

function parseBoolean(name, fallback = false) {
  const value = process.env[name]?.trim().toLowerCase();
  if (!value) return fallback;
  if (['1', 'true', 'yes', 'on'].includes(value)) return true;
  if (['0', 'false', 'no', 'off'].includes(value)) return false;
  throw new Error(`${name} must be true or false`);
}

function parseFogConfig() {
  const name = process.env.FOG_SERVER_NAME?.trim();
  const baseUrl = process.env.FOG_BASE_URL?.trim();
  const apiToken = process.env.FOG_API_TOKEN?.trim();
  const anyFogValue = Boolean(baseUrl || apiToken);

  if (!anyFogValue) {
    return { configured: false };
  }
  if (!baseUrl) {
    throw new Error('FOG_BASE_URL is required when FOG credentials are configured');
  }

  let url;
  try {
    url = new URL(baseUrl);
  } catch {
    throw new Error('FOG_BASE_URL must be a valid absolute URL');
  }
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new Error('FOG_BASE_URL must use http or https');
  }
  if (/\/api(?:\/index\.php)?\/?$/i.test(url.pathname)) {
    throw new Error('FOG_BASE_URL must be the FOG web root, without /api or /api/index.php');
  }

  const normalizedBaseUrl = baseUrl.replace(/\/+$/, '');
  if (!apiToken) {
    return {
      configured: false,
      setupRequired: true,
      baseUrl: normalizedBaseUrl,
    };
  }

  return {
    configured: true,
    name,
    baseUrl: normalizedBaseUrl,
    apiToken,
    timeoutMs: parsePositiveInteger('FOG_REQUEST_TIMEOUT_MS', 10_000),
  };
}

const nodeEnv = process.env.NODE_ENV?.trim() || 'development';
const fog = Object.freeze(parseFogConfig());
const configFile = path.resolve(process.env.FOGGY_CONFIG_FILE?.trim() || 'config/foggy.json');
const stateDirectory = path.dirname(configFile);

export const env = Object.freeze({
  nodeEnv,
  isProduction: nodeEnv === 'production',
  host: process.env.HOST?.trim() || '0.0.0.0',
  port: parsePort('PORT', 7400),
  viteDevServer: process.env.VITE_DEV_SERVER?.trim() || '',
  configFile,
  sessionFile: path.resolve(process.env.FOGGY_SESSION_FILE?.trim() || 'config/sessions.json'),
  sessionTtlMs: parsePositiveInteger('FOGGY_SESSION_TTL_MS', 60 * 60 * 1000),
  snapinUploadMaxBytes: parsePositiveInteger('FOGGY_SNAPIN_UPLOAD_MAX_BYTES', 2 * 1024 * 1024 * 1024),
  snapinUploadTimeoutMs: parsePositiveInteger('FOGGY_SNAPIN_UPLOAD_TIMEOUT_MS', 30 * 60 * 1000),
  updatesEnabled: parseBoolean('FOGGY_UPDATES_ENABLED'),
  updateRequestFile: path.resolve(process.env.FOGGY_UPDATE_REQUEST_FILE?.trim() || path.join(stateDirectory, 'update-request.json')),
  updateStatusFile: path.resolve(process.env.FOGGY_UPDATE_STATUS_FILE?.trim() || path.join(stateDirectory, 'update-status.json')),
  fog,
});
