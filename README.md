# Foggy

Foggy is a standalone, server-rendered management frontend for FOG Project
1.5.x. The current application provides operational Dashboard, Computers,
Images, Groups, Snapins, Deploy, Capture, and Tasks workflows. It includes
source-traced host/image/group editing, group membership and lifecycle
management, per-computer Snapin assignments, common host task actions, imaging
history, and guided bulk deploy.
The long-term target covers the complete day-to-day management surface,
delivered in source-traced stages rather than as unsafe generic CRUD.

## Requirements

- Node.js 22 or newer
- A FOG 1.5.x server with its API enabled
- A FOG application API token
- A FOG account for each technician who signs in

## Development

```sh
npm install
cp .env.example .env
npm run dev
```

Foggy binds to `0.0.0.0:3000` by default; Vite binds to `0.0.0.0:5173` and its
asset URLs follow the hostname used by the browser. Without complete FOG
credentials, the application still starts in a clearly marked setup state so
the interface can be developed safely.

On first start, Foggy creates the server-side connection store at
`config/foggy.json` (override with `FOGGY_CONFIG_FILE`). If the file does not
exist and the `FOG_*` variables are configured, that connection is imported as
the initial server. The file contains credentials, is written atomically with
mode `0600`, and is excluded from Git.

After startup, Foggy presents a landing page where the technician selects a
server and signs in with a normal FOG username and password. Foggy validates
that account through FOG's native management login, immediately logs out the
temporary upstream PHP session, and creates an opaque, HttpOnly Foggy session.
Passwords are never written to config or retained after validation. Sessions
use a persistent SameSite-Strict browser cookie and default to one hour. The
matching server-side records survive Foggy restarts in `config/sessions.json`
(override with `FOGGY_SESSION_FILE`) and contain only a hash of the bearer ID,
server ID, username, CSRF token, and timestamps—never FOG credentials. Adjust
the shared cookie/server expiry with `FOGGY_SESSION_TTL_MS`.

Each server configuration contains the global application API token and a FOG
user API token. REST calls run with the stored token owner's FOG permissions;
the signed-in technician remains Foggy's session/audit identity. Use a narrowly
scoped dedicated FOG API account where practical, because FOG 1.5 has only its
coarse admin/mobile authorization boundary.

Use **Manage FOG servers** on the sign-in page or the connection card at the
bottom of the authenticated sidebar to open the server manager. Add and
configure connections from that modal. An installation with no servers
redirects directly to the standalone setup screen. Selecting a different server
ends the old session and requires credentials for the new server. All pages and
operations use the FOG identity from the active request-scoped session.

Every mutation is protected by both session authentication and a session-bound
CSRF token. FOG's own user type remains the upstream authorization boundary.

### Authentication logs

Foggy writes one-line JSON authentication events to stdout/stderr so they are
visible in the development terminal and in a service manager such as systemd's
journal. Failed sign-ins include a correlation reference shown on the login
screen. Log records contain the selected server name/host, username, client
address, duration, upstream HTTP status, and Foggy error code. Passwords, API
tokens, authorization headers, cookies, and upstream response bodies are never
logged.

`FOG_BASE_URL` must be the configured FOG web root, such as
`https://fog.example.test/fog`. Do not append `/api` or `/api/index.php`.

## Production

```sh
npm run build
npm start
```

Express serves Vite's hashed production assets from `public/assets`.
For a service deployment, set an absolute `FOGGY_CONFIG_FILE` path in the
service environment and grant the service account read/write access to its
parent directory. Foggy creates the directory and file when missing; malformed
existing JSON is reported at startup and is never silently replaced.
Set `FOGGY_SESSION_FILE` to another writable, private absolute path if sessions
should not live beside the connection store. Foggy writes it atomically with
mode `0600`; deleting it intentionally signs out every technician after the
service restarts.
The version-3 config schema stores server name, URL, global application token,
user API token, and timeout. Stored tokens remain mode-0600 server secrets and
are never returned to setup forms. Older files migrate atomically; a version-2
server is marked as needing setup until both tokens are re-entered through its
Configure link. Stored usernames and passwords are removed during migration.

## FOG integration

All upstream calls live under `src/fog/`. Routes and views consume only clean,
normalized objects and never receive FOG credentials or raw FOG payloads. The
source-backed call contract and known gaps are recorded in
[`docs/fog-api-1.5.md`](docs/fog-api-1.5.md). Feature coverage, API/extension
decisions, and the delivery order are tracked in
[`docs/feature-matrix.md`](docs/feature-matrix.md).

The linked upstream source at `fogproject` is strictly read-only. See
[`AGENTS.md`](AGENTS.md) before making changes.
