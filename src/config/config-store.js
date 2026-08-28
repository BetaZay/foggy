import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const VERSION = 3;

export class ConfigValidationError extends Error {
  constructor(message, fields = {}) {
    super(message);
    this.name = 'ConfigValidationError';
    this.code = 'CONFIG_VALIDATION_ERROR';
    this.fields = fields;
  }
}

function normalizedUrl(value, fields) {
  const input = String(value || '').trim().replace(/\/+$/, '');
  let url;
  try {
    url = new URL(input);
  } catch {
    fields.baseUrl = 'Enter a valid absolute URL.';
    return input;
  }
  if (!['http:', 'https:'].includes(url.protocol)) {
    fields.baseUrl = 'The server URL must use HTTP or HTTPS.';
  } else if (/\/api(?:\/index\.php)?\/?$/i.test(url.pathname)) {
    fields.baseUrl = 'Use the FOG web root without /api or /api/index.php.';
  }
  return input;
}

export function normalizeServer(input, { requireId = false, allowMissingUserToken = false } = {}) {
  const fields = {};
  const id = String(input?.id || '').trim();
  const name = String(input?.name || '').trim();
  const baseUrl = normalizedUrl(input?.baseUrl, fields);
  const apiToken = String(input?.apiToken || '').trim();
  const userToken = String(input?.userToken || '').trim();
  const timeoutMs = Number.parseInt(input?.timeoutMs ?? 10_000, 10);

  if (requireId && !/^[a-zA-Z0-9_-]{1,80}$/.test(id)) fields.id = 'The stored server ID is invalid.';
  if (!name || name.length > 80) fields.name = 'Enter a name between 1 and 80 characters.';
  if (!apiToken) fields.apiToken = 'The FOG application API token is required.';
  if (!userToken && !allowMissingUserToken) fields.userToken = 'The FOG user API token is required.';
  if (!Number.isInteger(timeoutMs) || timeoutMs < 250 || timeoutMs > 120_000) {
    fields.timeoutMs = 'Use a timeout from 250 to 120000 milliseconds.';
  }
  if (Object.keys(fields).length) {
    throw new ConfigValidationError('The FOG server configuration is invalid.', fields);
  }

  return {
    id: id || crypto.randomUUID(),
    name,
    baseUrl,
    apiToken,
    userToken,
    timeoutMs,
    configured: Boolean(apiToken && userToken),
    setupRequired: !userToken,
  };
}

function persistedServer(server) {
  const { configured, setupRequired, ...stored } = server;
  return stored;
}

function seedServer(seed) {
  if (!seed?.configured) return null;
  let host = 'FOG server';
  try { host = new URL(seed.baseUrl).host; } catch { /* env validation reports this first */ }
  return normalizeServer({ ...seed, name: seed.name || host }, { allowMissingUserToken: true });
}

export class ConfigStore {
  constructor(filePath, { seed } = {}) {
    this.filePath = path.resolve(filePath);
    this.seed = seedServer(seed);
    this.config = this.#loadOrCreate();
  }

  listServers() {
    return this.config.servers.map((server) => ({ ...server }));
  }

  getServer(id) {
    const server = this.config.servers.find((item) => item.id === id);
    return server ? { ...server } : null;
  }

  addServer(input) {
    const server = normalizeServer(input);
    if (this.config.servers.some((item) => item.name.toLowerCase() === server.name.toLowerCase())) {
      throw new ConfigValidationError('A server with this name already exists.', { name: 'Choose a unique server name.' });
    }
    if (this.config.servers.some((item) => item.baseUrl.toLowerCase() === server.baseUrl.toLowerCase())) {
      throw new ConfigValidationError('This FOG server is already configured.', { baseUrl: 'This server URL is already configured.' });
    }
    this.config = { ...this.config, servers: [...this.config.servers, server] };
    this.#write();
    return { ...server };
  }

  updateServer(id, input) {
    const current = this.config.servers.find((server) => server.id === id);
    if (!current) throw new ConfigValidationError('The selected server no longer exists.');
    const server = normalizeServer({ ...input, id }, { requireId: true });
    if (this.config.servers.some((item) => item.id !== id && item.name.toLowerCase() === server.name.toLowerCase())) {
      throw new ConfigValidationError('A server with this name already exists.', { name: 'Choose a unique server name.' });
    }
    if (this.config.servers.some((item) => item.id !== id && item.baseUrl.toLowerCase() === server.baseUrl.toLowerCase())) {
      throw new ConfigValidationError('This FOG server is already configured.', { baseUrl: 'This server URL is already configured.' });
    }
    this.config = {
      ...this.config,
      servers: this.config.servers.map((item) => item.id === id ? server : item),
    };
    this.#write();
    return { ...server };
  }

  #loadOrCreate() {
    if (!fs.existsSync(this.filePath)) {
      const config = { version: VERSION, servers: this.seed ? [this.seed] : [] };
      this.config = config;
      this.#write();
      return config;
    }
    const stat = fs.lstatSync(this.filePath);
    if (stat.isSymbolicLink() || !stat.isFile()) throw new Error('FOGGY_CONFIG_FILE must refer to a regular file, not a symlink.');
    let parsed;
    try {
      parsed = JSON.parse(fs.readFileSync(this.filePath, 'utf8'));
    } catch {
      throw new Error('Foggy could not parse its config file. Fix the JSON instead of replacing the file silently.');
    }
    if (![1, 2, VERSION].includes(parsed?.version) || !Array.isArray(parsed.servers)) {
      throw new Error(`Foggy config must use a supported version and contain a servers array.`);
    }
    const servers = parsed.servers.map((server) => normalizeServer(server, {
      requireId: true,
      // Incomplete entries must remain loadable so the public configuration
      // screen can add a missing user token without hand-editing JSON.
      allowMissingUserToken: true,
    }));
    const ids = new Set(servers.map((server) => server.id));
    if (ids.size !== servers.length) throw new Error('Foggy config contains duplicate server IDs.');
    const config = { version: VERSION, servers };
    if (parsed.version !== VERSION) {
      this.config = config;
      this.#write();
    }
    return config;
  }

  #write() {
    const directory = path.dirname(this.filePath);
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
    if (fs.existsSync(this.filePath) && fs.lstatSync(this.filePath).isSymbolicLink()) {
      throw new Error('FOGGY_CONFIG_FILE must not be a symlink.');
    }
    const temporary = path.join(directory, `.${path.basename(this.filePath)}.${crypto.randomUUID()}.tmp`);
    const data = `${JSON.stringify({
      version: VERSION,
      servers: this.config.servers.map(persistedServer),
    }, null, 2)}\n`;
    try {
      fs.writeFileSync(temporary, data, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
      fs.renameSync(temporary, this.filePath);
      fs.chmodSync(this.filePath, 0o600);
    } finally {
      if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
    }
  }
}
