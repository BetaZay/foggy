import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const FILE_VERSION = 1;

function sessionKey(id) {
  return crypto.createHash('sha256').update(String(id || '')).digest('hex');
}

function validRecord(record) {
  return record
    && /^[a-f0-9]{64}$/.test(record.key)
    && typeof record.serverId === 'string'
    && typeof record.username === 'string'
    && /^[A-Za-z0-9_-]{32,}$/.test(record.csrfToken)
    && Number.isFinite(record.createdAt)
    && Number.isFinite(record.expiresAt);
}

export class SessionStore {
  constructor({ ttlMs = 60 * 60 * 1000, filePath = '' } = {}) {
    this.ttlMs = ttlMs;
    this.filePath = filePath ? path.resolve(filePath) : '';
    this.sessions = new Map();
    this.#load();
  }

  create({ serverId, username, fog }) {
    this.#purgeExpired();
    const id = crypto.randomBytes(32).toString('base64url');
    const now = Date.now();
    const session = {
      key: sessionKey(id),
      serverId,
      username,
      fog,
      csrfToken: crypto.randomBytes(32).toString('base64url'),
      createdAt: now,
      expiresAt: now + this.ttlMs,
    };
    this.sessions.set(session.key, session);
    this.#write();
    return { ...session, id };
  }

  get(id) {
    if (!id) return null;
    const key = sessionKey(id);
    const session = this.sessions.get(key);
    if (!session) return null;
    if (session.expiresAt <= Date.now()) {
      this.sessions.delete(key);
      this.#write();
      return null;
    }
    return { ...session, id };
  }

  destroy(id) {
    if (!id) return;
    if (this.sessions.delete(sessionKey(id))) this.#write();
  }

  #purgeExpired() {
    const now = Date.now();
    let changed = false;
    for (const [key, session] of this.sessions) {
      if (session.expiresAt <= now) {
        this.sessions.delete(key);
        changed = true;
      }
    }
    if (changed) this.#write();
  }

  #load() {
    if (!this.filePath || !fs.existsSync(this.filePath)) return;
    const stat = fs.lstatSync(this.filePath);
    if (stat.isSymbolicLink() || !stat.isFile()) {
      throw new Error('FOGGY_SESSION_FILE must refer to a regular file, not a symlink.');
    }
    let parsed;
    try {
      parsed = JSON.parse(fs.readFileSync(this.filePath, 'utf8'));
    } catch {
      throw new Error('Foggy could not parse its session file. Remove it to invalidate all sessions.');
    }
    if (parsed?.version !== FILE_VERSION || !Array.isArray(parsed.sessions)) {
      throw new Error('Foggy session file has an unsupported format.');
    }
    const now = Date.now();
    for (const record of parsed.sessions) {
      if (!validRecord(record) || record.expiresAt <= now) continue;
      this.sessions.set(record.key, { ...record, fog: null });
    }
  }

  #write() {
    if (!this.filePath) return;
    const directory = path.dirname(this.filePath);
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
    if (fs.existsSync(this.filePath) && fs.lstatSync(this.filePath).isSymbolicLink()) {
      throw new Error('FOGGY_SESSION_FILE must not be a symlink.');
    }
    const temporary = path.join(directory, `.${path.basename(this.filePath)}.${crypto.randomUUID()}.tmp`);
    const sessions = [...this.sessions.values()].map(({ key, serverId, username, csrfToken, createdAt, expiresAt }) => ({
      key, serverId, username, csrfToken, createdAt, expiresAt,
    }));
    const data = `${JSON.stringify({ version: FILE_VERSION, sessions }, null, 2)}\n`;
    try {
      fs.writeFileSync(temporary, data, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
      fs.renameSync(temporary, this.filePath);
      fs.chmodSync(this.filePath, 0o600);
    } finally {
      if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
    }
  }
}
