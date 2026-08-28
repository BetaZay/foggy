# Linux service installation and updates

Foggy ships as a distro-neutral release archive and a hardened systemd service.
The same release layout supports current Debian, Ubuntu, Fedora, and Arch Linux
without putting credentials or mutable state inside the application directory.

## Requirements

- A 64-bit or otherwise Node-supported Linux installation using systemd
- Node.js 22 or newer and npm (installed automatically when needed)
- `tar`, `sha256sum`, and standard GNU user/file utilities
- `curl` or `wget` only when updating directly from an HTTPS URL
- Root access for installation and service management

The service installer detects Debian/Ubuntu, Fedora/RHEL-family, and Arch and
installs the required certificate, download, archive, and checksum utilities
with that distribution's package manager. If Node.js 22+ and npm are not
already available, it downloads the latest official Node 22 Linux archive,
verifies it against Node.js's published `SHASUMS256.txt`, installs it under
`/opt/nodejs/releases`, and exposes it through `/usr/local/bin`.

You can verify the result with:

```sh
node --version
npm --version
```

Pass `--skip-dependencies` only when dependencies are managed separately:

```sh
sudo ./foggy-0.1.0/scripts/install-service.sh --skip-dependencies
```

The installer still validates Node 22+, npm, systemd, and the required system
utilities before changing the service.

## Install the latest release

On a supported systemd distribution, install the latest published Foggy
release with:

```sh
curl -fsSL https://github.com/BetaZay/foggy/releases/latest/download/install-foggy.sh | sudo bash
```

The release-hosted bootstrap discovers the latest GitHub Release, downloads its
versioned archive and checksum over HTTPS, validates the checksum and archive
paths, and delegates to the service installer described below. It accepts the
same options as `install-service.sh`; for example:

```sh
curl -fsSL https://github.com/BetaZay/foggy/releases/latest/download/install-foggy.sh | sudo bash -s -- --no-start
```

Review the script before piping it to a privileged shell when required by local
policy. The fully manual verified installation remains available below.

## Publish or build a release

Each push to `main` runs `.github/workflows/release.yml`. After the service
checks and tested production build succeed, the workflow publishes the archive,
checksum, installer, generated notes, and tag using
`year.month.GitHub-Actions-run-number`, such as `2026.8.14`. Failed runs publish
nothing.

To build the same archive locally, use a clean Foggy checkout:

```sh
FOGGY_RELEASE_VERSION=2026.8.14 npm run release
```

The release command performs a locked `npm ci`, runs all tests, builds hashed
Vite assets, and writes these files:

```text
dist/foggy-<version>.tar.gz
dist/foggy-<version>.tar.gz.sha256
```

The archive contains application source, production assets, the dependency lock
file, service templates, documentation, and installation/update scripts. It
does not contain `.env`, configured FOG servers, sessions, the linked FOG source,
development caches, or `node_modules`.

## Manual install

Copy the archive to the server, verify it, extract it, and run the installer:

```sh
sha256sum --check foggy-0.1.0.tar.gz.sha256
tar -xzf foggy-0.1.0.tar.gz
sudo ./foggy-0.1.0/scripts/install-service.sh
```

The installer:

- creates an unprivileged `foggy` system account;
- installs an immutable versioned release under `/opt/foggy/releases/`;
- installs locked production dependencies with lifecycle scripts disabled;
- points `/opt/foggy/current` at that release;
- creates `/var/lib/foggy` mode `0700` for connection data and sessions;
- creates `/etc/foggy/foggy.env` mode `0640`, readable by the service group;
- installs and enables `/etc/systemd/system/foggy.service`; and
- installs `/usr/local/sbin/foggy-update`; and
- enables the root-owned `foggy-update.path` handler for authenticated update
  requests from the application.

The default service listens on `0.0.0.0:7400`. Open
`http://<server-address>:7400/` to add the first FOG server. For an exposed or
multi-user installation, place Foggy behind an HTTPS reverse proxy and restrict
port 7400 with the host firewall.

Use `--no-start` when preparing an image or when configuration must be reviewed
before the first start:

```sh
sudo ./foggy-0.1.0/scripts/install-service.sh --no-start
sudo systemctl enable --now foggy.service
```

## Configuration and state

Service settings live in `/etc/foggy/foggy.env`. The generated defaults point
mutable data at:

```text
/var/lib/foggy/foggy.json
/var/lib/foggy/sessions.json
/var/lib/foggy/update-request.json
/var/lib/foggy/update-status.json
```

Back up `/etc/foggy` and `/var/lib/foggy`. Never place API tokens in the release
directory. Upgrades preserve both directories and existing authenticated
sessions.

After changing the environment file:

```sh
sudo systemctl restart foggy.service
```

Useful diagnostics:

```sh
systemctl status foggy.service
journalctl -u foggy.service -n 200 --no-pager
curl --fail http://127.0.0.1:7400/healthz
```

The health endpoint reports only application readiness and does not expose FOG
credentials or test the upstream FOG server.

## Update

The normal update workflow is **Administration → Updates** inside Foggy. The
page checks the latest GitHub Release and requires the signed-in technician to
enter `UPDATE`. The unprivileged web process atomically creates a private fixed
request marker. It cannot choose a URL or run a command.

`foggy-update.path` starts a root-owned oneshot handler when that marker exists.
The handler ignores marker contents, resolves only the latest release from
`github.com/BetaZay/foggy`, validates its published SHA-256, and calls the same
health-checked updater used for manual updates. Progress and the final result
are written back as a sanitized mode-0600 status record. Relevant diagnostics:

```sh
systemctl status foggy-update.path foggy-update.service
journalctl -u foggy-update.service -n 200 --no-pager
```

Manual updates remain available for controlled or offline environments.

`v0.1.1` and earlier installations need one transition using the one-command or
manual installer because those releases predate `foggy-update.path`. Existing
configuration, server tokens, and sessions remain in the external state paths
and are preserved. Later releases can be installed entirely from the Updates
page.

Download and verify a new release, then pass the local archive to the updater:

```sh
sha256sum --check foggy-0.2.0.tar.gz.sha256
sudo foggy-update ./foggy-0.2.0.tar.gz
```

For a direct HTTPS update, supply the published SHA-256 value explicitly:

```sh
sudo foggy-update \
  https://downloads.example.test/foggy/foggy-0.2.0.tar.gz \
  <64-character-sha256>
```

Remote updates without a checksum are refused. The updater rejects unsafe
archive paths, installs dependencies into a new versioned directory, validates
the server entry point, updates the service definition, atomically switches the
`current` link, and restarts Foggy. It waits for both systemd and `/healthz`.
If the new release fails the health check, the application link and service unit
are rolled back and the prior service is restarted.

Old releases are intentionally retained rather than deleted automatically. This
keeps rollback recoverable and lets the administrator apply local retention
policy after confirming a release is healthy.

## Service security boundary

The web unit runs without root privileges or Linux capabilities. It uses a private
temporary directory, a read-only system/application view, a writable allowlist
for `/var/lib/foggy`, kernel/control-group protections, and a restrictive umask.
FOG API and user tokens remain in the mode-restricted state file and are never
placed in the unit or command line.

The update agent is root-owned because installing and rolling back releases
requires service and filesystem changes. Its input is deliberately constrained:
the web process can create only a trigger marker, while the agent has a fixed
repository, fixed release-asset naming, mandatory HTTPS and checksum
verification, and no request-controlled command or URL.

All four requested distributions use systemd, but distribution packaging is a
separate future layer. Native `.deb`, `.rpm`, and Arch packages can call the same
installer layout without changing Foggy's runtime or state contract.
