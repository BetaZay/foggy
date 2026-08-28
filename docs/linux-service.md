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

## Build a release

From a clean Foggy checkout:

```sh
npm run release
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

## Install

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
- installs `/usr/local/sbin/foggy-update`.

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

The unit runs without root privileges or Linux capabilities. It uses a private
temporary directory, a read-only system/application view, a writable allowlist
for `/var/lib/foggy`, kernel/control-group protections, and a restrictive umask.
FOG API and user tokens remain in the mode-restricted state file and are never
placed in the unit or command line.

All four requested distributions use systemd, but distribution packaging is a
separate future layer. Native `.deb`, `.rpm`, and Arch packages can call the same
installer layout without changing Foggy's runtime or state contract.
