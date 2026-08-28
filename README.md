<p align="center"><img src="public/brand/foggy-mark.svg" width="96" height="96" alt="Foggy logo"></p>

# Foggy

[![CI](https://github.com/BetaZay/foggy/actions/workflows/ci.yml/badge.svg)](https://github.com/BetaZay/foggy/actions/workflows/ci.yml)

Foggy is a modern, standalone management frontend for FOG Project 1.5.x. It
keeps FOG as the imaging engine—PXE, FOS, storage nodes, Partclone, multicast,
task processing, and FOG Client—and replaces the day-to-day management
experience with a focused server-rendered web application.

Foggy uses Express, EJS, Vite, Tailwind CSS, HTMX, and small Alpine.js
interactions. It is intentionally not a single-page application.

## Current status

Foggy is suitable for a controlled technician pilot covering basic imaging and
single-host management. Mutating workflows are traced against the linked FOG
1.5 source and kept behind Foggy's authenticated, CSRF-protected server routes.

Available workflows include:

- operational dashboard with active, queued, recent, and failed work;
- searchable computer and image libraries;
- in-place host settings and Active Directory configuration with FOG defaults;
- hardware inventory display and editable ownership/asset metadata;
- guided single-host and bulk deployment;
- guided capture into existing or newly created image definitions;
- active, queued, completed, and failed task views with cancellation;
- Wake-on-LAN, diagnostics, password reset, and confirmed disk-wipe tasks;
- group lifecycle and computer membership management;
- host Snapin assignment, individual/all execution, history, definition
  creation/editing, and installer upload where the FOG endpoint is available;
- host printer and FOG Client service assignment;
- login, imaging, Snapin, and virus history; and
- multiple FOG server connections with authentication required when switching.

Important remaining work includes group-level bulk settings, image/Snapin
deletion safeguards, storage and replication administration, PXE/boot settings,
FOG user/global-settings management, and broader mutation audit logging. See
[`docs/feature-matrix.md`](docs/feature-matrix.md) for the exact coverage
contract.

## Architecture

```text
Browser
  │  EJS + Tailwind + HTMX + Alpine
  ▼
Foggy / Express
  │  normalized Foggy service operations
  ▼
src/fog integration layer
  │  server-side FOG API tokens
  ▼
FOG 1.5
```

The browser never receives FOG API credentials and never calls FOG directly.
FOG-specific paths, payloads, response shapes, and version quirks remain under
`src/fog/`.

## Requirements

- Node.js 22 or newer for development and release builds
- A FOG 1.5.x server with its REST API enabled
- A FOG global application API token
- A FOG user API token stored with each Foggy server connection
- A normal FOG username and password for each technician signing in

Enable the API in **FOG Configuration → FOG Settings → API System**. Configure
Foggy with the FOG web root, for example `https://fog.example.test/fog`; do not
append `/api` or `/api/index.php`.

## Development

```sh
npm install
cp .env.example .env
npm run dev
```

Open `http://localhost:7400`. Express listens on `0.0.0.0:7400` by default;
Vite listens on `0.0.0.0:5173` for development assets and hot reload.

An empty installation redirects to the Add Server screen. Add the server URL,
global application token, and FOG user token, then sign in with a normal FOG
username and password. Foggy validates the password through FOG's management
login and immediately discards it.

Useful commands:

```sh
npm run dev             # Express and Vite development servers
npm test                # Node test suite
npm run build           # Production Vite assets
npm start               # Production Express process
npm run service:check   # Validate deployment shell syntax
npm run release         # Tested, checksummed release archive
```

## Continuous integration

GitHub Actions runs the locked dependency install, complete test suite,
production asset build, and deployment shell validation on Node.js 22 and 24.
The workflow runs for pushes to `main`, pull requests, and manual dispatches.
See [`.github/workflows/ci.yml`](.github/workflows/ci.yml) for the exact quality
gates.

## Configuration

Local settings are loaded from `.env`. The committed `.env.example` documents
all supported values.

| Variable | Default | Purpose |
| --- | --- | --- |
| `HOST` | `0.0.0.0` | Express bind address |
| `PORT` | `7400` | Foggy HTTP port |
| `FOGGY_CONFIG_FILE` | `./config/foggy.json` | Server connection store |
| `FOGGY_SESSION_FILE` | `./config/sessions.json` | Restart-persistent session metadata |
| `FOGGY_SESSION_TTL_MS` | `3600000` | Cookie and server-side session lifetime |
| `FOGGY_UPDATES_ENABLED` | `false` | Enables the systemd-backed update request UI |
| `FOGGY_UPDATE_REQUEST_FILE` | Beside config | Fixed update-agent request marker |
| `FOGGY_UPDATE_STATUS_FILE` | Beside config | Sanitized update-agent status |
| `FOGGY_SNAPIN_UPLOAD_MAX_BYTES` | `2147483648` | Maximum proxied installer size |
| `FOGGY_SNAPIN_UPLOAD_TIMEOUT_MS` | `1800000` | Upstream installer upload timeout |
| `FOG_REQUEST_TIMEOUT_MS` | `10000` | Optional seeded server request timeout |

`FOG_SERVER_NAME`, `FOG_BASE_URL`, and `FOG_API_TOKEN` can seed the first
connection when the JSON store does not exist. After first run, manage servers
through Foggy's server manager.

Connection and session files are created atomically with mode `0600`. Passwords
are never persisted. Session files contain only hashed bearer identifiers,
server/user identity, CSRF data, and timestamps—not FOG tokens or passwords.

## Production release

Install the latest published release on a supported systemd Linux distribution
with one command:

```sh
curl -fsSL https://github.com/BetaZay/foggy/releases/latest/download/install-foggy.sh | sudo bash
```

The bootstrap downloads the latest versioned archive and its checksum from the
same GitHub release, verifies the archive, rejects unsafe paths, and then runs
the normal distro-aware service installer. Review the downloaded script before
running it when required by local policy.

Every successful push to `main` publishes a release automatically after the
release workflow repeats the tests, production build, and service checks.
Release versions and tags use:

```text
year.month.GitHub-Actions-run-number
```

For example, `2026.8.14` is the fourteenth run of the release workflow. The
workflow injects that version into the packaged `package.json`, lockfile, and
release manifest, then publishes the matching tag, archive, checksum, generated
notes, and bootstrap installer. A failed check creates no GitHub Release.

### Local release build

Create a production archive from a checkout:

```sh
npm run release
```

Set `FOGGY_RELEASE_VERSION=2026.8.14` to produce a CalVer-named local archive;
without it, local builds use the source package version.

This performs a locked dependency installation, runs the complete test suite,
builds hashed Vite assets, and creates:

```text
dist/foggy-<version>.tar.gz
dist/foggy-<version>.tar.gz.sha256
```

The archive excludes `.env`, runtime configuration, sessions, `node_modules`,
and the linked FOG source.

## Linux service installation

Foggy provides a distro-neutral, hardened systemd installer for Debian, Ubuntu,
Fedora/RHEL-family distributions, and Arch Linux.

```sh
sha256sum --check foggy-0.1.0.tar.gz.sha256
tar -xzf foggy-0.1.0.tar.gz
sudo ./foggy-0.1.0/scripts/install-service.sh
```

The installer automatically installs the required distribution packages. When
Node.js 22+ is unavailable, it downloads the latest official Node 22 Linux
archive, verifies it against Node.js's published `SHASUMS256.txt`, and installs
it under `/opt/nodejs`. Pass `--skip-dependencies` when the operating system is
managed separately.

Re-running the installer updates the Foggy and update-handler units, reloads
systemd, and explicitly restarts the web service and update path watcher.

The service installation uses:

```text
/opt/foggy/releases/     immutable versioned releases
/opt/foggy/current       active release symlink
/etc/foggy/foggy.env     service environment
/var/lib/foggy/          connection data and sessions
```

Foggy runs as an unprivileged `foggy` system user with a private temporary
directory, read-only application/system view, restricted capabilities, and a
writable allowlist for its state directory.

Check the service with:

```sh
systemctl status foggy.service
journalctl -u foggy.service -n 200 --no-pager
curl --fail http://127.0.0.1:7400/healthz
```

The health endpoint reports Foggy process readiness only and exposes no FOG
configuration or credentials.

## Updating

Service installations expose **Administration → Updates**. An authenticated
technician can check the latest verified release and type `UPDATE` to queue it.
Foggy writes only a fixed mode-0600 marker; a root-owned systemd path handler
resolves the trusted GitHub release itself, verifies its checksum, invokes the
rollback-capable updater, and reports sanitized status back to Foggy. Express
cannot supply an update URL or execute arbitrary privileged commands.

Installations on `v0.1.1` or earlier do not yet have the systemd update bridge;
run the one-command installer once to move onto the first CalVer release.
Configuration and sessions remain in `/etc/foggy` and `/var/lib/foggy`.

Install a verified local release:

```sh
sha256sum --check foggy-0.2.0.tar.gz.sha256
sudo foggy-update ./foggy-0.2.0.tar.gz
```

Remote HTTPS updates require the published SHA-256 value:

```sh
sudo foggy-update \
  https://downloads.example.test/foggy/foggy-0.2.0.tar.gz \
  <64-character-sha256>
```

The updater installs into a new versioned directory, atomically changes the
active release, updates the service definition, performs an explicit stop/start,
and verifies systemd plus `/healthz` at the configured address. A failed health
check prints focused service diagnostics, restores the previous application and
service unit, restarts it, and verifies rollback health. Configuration,
credentials, and sessions remain outside the release and survive upgrades.

Full installation, update, rollback, and operating notes are in
[`docs/linux-service.md`](docs/linux-service.md).

## Security and authentication

- Every mutation requires an authenticated Foggy session, same-origin request,
  session CSRF token, validation, and explicit confirmation where consequential.
- Pre-authentication sign-in and server-setup forms use separate ten-minute,
  purpose-bound signed CSRF challenges and do not depend on browser cookies.
- API tokens remain server-side and are never serialized into EJS or browser
  bundles.
- Technician passwords are used only for native FOG login validation and are
  immediately discarded.
- Persistent cookies are HttpOnly, SameSite Strict, and expire with the
  server-side session—one hour by default.
- Authentication events use structured, secret-free logs suitable for the
  systemd journal.
- FOG 1.5's admin/mobile user type remains the upstream authorization boundary.

## Source evidence and contributing

Every FOG API call used by Foggy is documented with method, payload, response,
permissions, side effects, errors, normalization, and linked-source evidence in
[`docs/fog-api-1.5.md`](docs/fog-api-1.5.md).

The `fogproject` link points to the upstream reference source and is strictly
read-only. Do not modify it or run commands that generate files inside it. Read
[`AGENTS.md`](AGENTS.md) before contributing.
