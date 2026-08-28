import crypto from 'node:crypto';
import path from 'node:path';
import { promises as fs } from 'node:fs';

const RELEASES_URL = 'https://api.github.com/repos/BetaZay/foggy/releases/latest';
const MAX_STATUS_BYTES = 16 * 1024;

export class UpdateError extends Error {
  constructor(message, code, cause) {
    super(message, { cause });
    this.name = 'UpdateError';
    this.code = code;
  }
}

function versionParts(value) {
  const match = String(value || '').replace(/^v/, '').match(/^(\d+)\.(\d+)\.(\d+)$/);
  return match ? match.slice(1).map(Number) : null;
}

export function compareVersions(left, right) {
  const leftParts = versionParts(left);
  const rightParts = versionParts(right);
  if (!leftParts || !rightParts) return null;
  for (let index = 0; index < leftParts.length; index += 1) {
    if (leftParts[index] !== rightParts[index]) return leftParts[index] - rightParts[index];
  }
  return 0;
}

function publicAgentStatus(value) {
  if (!value || typeof value !== 'object') return null;
  const states = new Set(['checking', 'downloading', 'installing', 'current', 'succeeded', 'failed']);
  if (!states.has(value.state)) return null;
  return {
    state: value.state,
    version: String(value.version || '').slice(0, 40),
    message: String(value.message || '').slice(0, 240),
    updatedAt: String(value.updatedAt || '').slice(0, 40),
  };
}

async function safeJsonFile(filePath) {
  try {
    const stat = await fs.lstat(filePath);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_STATUS_BYTES) return null;
    return JSON.parse(await fs.readFile(filePath, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

export class UpdateManager {
  constructor({
    currentVersion,
    enabled = false,
    requestFile,
    statusFile,
    fetchImpl = globalThis.fetch,
    now = () => new Date(),
  }) {
    this.currentVersion = currentVersion;
    this.enabled = enabled;
    this.requestFile = requestFile;
    this.statusFile = statusFile;
    this.fetch = fetchImpl;
    this.now = now;
  }

  async latestRelease() {
    let response;
    try {
      response = await this.fetch(RELEASES_URL, {
        headers: {
          accept: 'application/vnd.github+json',
          'user-agent': `Foggy/${this.currentVersion}`,
        },
        signal: AbortSignal.timeout(10_000),
      });
    } catch (error) {
      throw new UpdateError('GitHub could not be reached to check for updates.', 'UPDATE_CHECK_UNREACHABLE', error);
    }
    if (!response.ok) {
      throw new UpdateError(`GitHub returned HTTP ${response.status} while checking for updates.`, 'UPDATE_CHECK_HTTP');
    }
    const value = await response.json();
    const version = String(value.tag_name || '').replace(/^v/, '');
    if (!versionParts(version)) {
      throw new UpdateError('GitHub returned an unsupported release version.', 'UPDATE_VERSION_INVALID');
    }
    const expectedArchive = `foggy-${version}.tar.gz`;
    const assets = new Set((value.assets || []).map((asset) => asset?.name));
    if (!assets.has(expectedArchive) || !assets.has(`${expectedArchive}.sha256`)) {
      throw new UpdateError('The latest GitHub release is missing its verified installation assets.', 'UPDATE_ASSETS_MISSING');
    }
    return {
      version,
      url: /^https:\/\/github[.]com\/BetaZay\/foggy\/releases\/tag\//.test(value.html_url || '')
        ? value.html_url
        : `https://github.com/BetaZay/foggy/releases/tag/${encodeURIComponent(value.tag_name)}`,
      publishedAt: String(value.published_at || ''),
    };
  }

  async status() {
    const agentStatus = publicAgentStatus(await safeJsonFile(this.statusFile));
    let latest = null;
    let checkError = '';
    try {
      latest = await this.latestRelease();
    } catch (error) {
      checkError = error instanceof UpdateError ? error.message : 'Foggy could not check for updates.';
    }
    const comparison = latest ? compareVersions(latest.version, this.currentVersion) : null;
    return {
      enabled: this.enabled,
      currentVersion: this.currentVersion,
      latest,
      updateAvailable: comparison !== null && comparison > 0,
      agentStatus,
      checkError,
    };
  }

  async requestUpdate(username) {
    if (!this.enabled) {
      throw new UpdateError('Built-in updates are unavailable in this installation.', 'UPDATES_DISABLED');
    }
    const latest = await this.latestRelease();
    const comparison = compareVersions(latest.version, this.currentVersion);
    if (comparison === null || comparison <= 0) {
      throw new UpdateError('Foggy is already running the latest release.', 'UPDATE_NOT_AVAILABLE');
    }

    try {
      const existing = await fs.lstat(this.requestFile);
      if (existing.isSymbolicLink()) {
        throw new UpdateError('The update request path is unsafe.', 'UPDATE_PATH_UNSAFE');
      }
      throw new UpdateError('An update request is already queued.', 'UPDATE_ALREADY_QUEUED');
    } catch (error) {
      if (error instanceof UpdateError) throw error;
      if (error.code !== 'ENOENT') throw error;
    }

    const temporary = path.join(
      path.dirname(this.requestFile),
      `.${path.basename(this.requestFile)}.${process.pid}.${crypto.randomUUID()}.tmp`,
    );
    const payload = `${JSON.stringify({
      requestedAt: this.now().toISOString(),
      requestedBy: String(username || '').slice(0, 80),
      version: latest.version,
    }, null, 2)}\n`;
    try {
      await fs.writeFile(temporary, payload, { mode: 0o600, flag: 'wx' });
      try {
        await fs.link(temporary, this.requestFile);
      } catch (error) {
        if (error.code === 'EEXIST') {
          throw new UpdateError('An update request is already queued.', 'UPDATE_ALREADY_QUEUED', error);
        }
        throw error;
      }
    } finally {
      await fs.unlink(temporary).catch(() => {});
    }
    return latest;
  }
}
