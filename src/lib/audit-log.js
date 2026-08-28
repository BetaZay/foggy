function text(value, maxLength = 120) {
  return String(value ?? '').replace(/[\r\n\t]/g, ' ').slice(0, maxLength);
}

export function serverHost(server) {
  try { return new URL(server?.baseUrl).host; } catch { return ''; }
}

export function authLog(level, event, details = {}) {
  const entry = {
    timestamp: new Date().toISOString(),
    level,
    scope: 'authentication',
    event: text(event, 60),
    requestId: text(details.requestId, 80),
    serverId: text(details.serverId, 80),
    serverName: text(details.serverName, 80),
    serverHost: text(details.serverHost, 160),
    username: text(details.username, 80),
    remoteAddress: text(details.remoteAddress, 80),
  };
  if (Number.isFinite(details.durationMs)) entry.durationMs = Math.max(0, Math.round(details.durationMs));
  if (Number.isInteger(details.status)) entry.upstreamStatus = details.status;
  if (details.code) entry.code = text(details.code, 80);
  if (Array.isArray(details.fields) && details.fields.length) {
    entry.fields = details.fields.map((field) => text(field, 80));
  }
  const output = JSON.stringify(entry);
  if (level === 'error') console.error(output);
  else if (level === 'warn') console.warn(output);
  else console.info(output);
}
