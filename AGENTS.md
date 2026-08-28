# Foggy Contributor Instructions

## Project purpose

Foggy is a new, standalone management frontend for FOG Project. It replaces the
management experience, not the imaging backend. FOG continues to own PXE/FOS,
imaging, storage nodes, task processing, multicast, and client behavior.

The initial target is FOG 1.5.x. Do not assume that behavior or documentation
from newer FOG releases applies.

## FOG source reference

- `fogproject` is a read-only link to the upstream FOG source at
  `../fogproject`.
- Treat `fogproject/**` and its resolved target `../fogproject/**` as strictly
  read-only, regardless of filesystem permissions. Never create, edit, delete,
  rename, move, format, patch, or generate files anywhere in that tree.
- Do not run commands in or against `fogproject` that may write caches, lock
  files, dependencies, build artifacts, test output, formatter changes, or
  other generated state. Inspection commands must be read-only.
- Before any broad or recursive write operation, ensure its target cannot cross
  or follow the `fogproject` symlink.
- Do not commit the linked FOG source to this repository.
- Before implementing FOG behavior, inspect the 1.5 source to trace the existing
  UI operation, API route/controller, required payload, returned data, side
  effects, and authentication/authorization checks.
- Prefer the FOG REST API. Do not directly manipulate the FOG database.
- If FOG 1.5 cannot perform an operation through its API, document the gap. Do
  not add a brittle workaround or modify FOG without an explicit decision.

## Architecture

Use Node.js, Express, EJS, Vite, Tailwind CSS, HTMX, and small, focused uses of
Alpine.js. This is a server-rendered administrative application, not an SPA. Do
not introduce React, Vue, Svelte, or another frontend framework without a
concrete requirement and explicit agreement.

Keep every FOG-specific route, payload, and response shape behind a dedicated
integration layer under `src/fog/`, with clean operations such as:

```js
fog.hosts.list()
fog.hosts.get(id)
fog.images.list()
fog.tasks.listActive()
fog.tasks.deploy(host, image)
fog.tasks.capture(host, image)
fog.hosts.wake(id)
```

Routes, views, and browser code must not depend on FOG's version-specific API
details. The browser communicates only with Foggy; it must never communicate
with FOG using server credentials.

## Implementation order

Work incrementally:

1. Identify the exact linked FOG 1.5 version.
2. Map REST routes and authentication for hosts, images, tasks, and groups.
3. Record API limitations and design the Foggy integration boundary.
4. Establish the Express/EJS/Vite/Tailwind project structure.
5. Implement and verify read-only Dashboard, Computers, and Images workflows.
6. Add task creation and other mutations only after reads are reliable.

Do not attempt to reproduce all legacy FOG features at once. Organize workflows
around technician goals, especially guided deploy and capture operations.

## Feature completeness

- The long-term target is complete day-to-day FOG management coverage,
  including tasks, Active Directory settings, snapins, hardware inventory,
  client login history, imaging/snapin/virus history, printers, client services,
  power management, group membership and bulk group operations, images,
  storage, PXE/boot, users, and settings.
- `docs/feature-matrix.md` is the coverage contract. Update it whenever a
  feature is discovered, implemented, deferred, or found to require an API
  extension.
- Complete scope does not waive the incremental and safety rules. Implement
  read models before mutations, and trace each mutation immediately before it
  is exposed.
- Host and group detail pages must be extensible workspaces with clear sections;
  do not force the full feature set into one oversized form or recreate FOG's
  legacy tab maze.
- Bulk actions must validate all targets, state their side effects, and return
  per-target outcomes. Never hide partial failure behind a single success
  message.
- Never send stored secrets back to a browser form. A modern-client host AD
  update may accept a freshly entered password for a single request because
  the linked `Host::setAD` stores modern `ADPass` as the submitted scalar; it
  must reject FOG mask/default placeholders, omit `ADPassLegacy` and product
  keys, immediately normalize the secret-bearing response, and never retain or
  repopulate the password. FOG default-password substitution may be reproduced
  only by resolving the exact allowlisted setting server-side and exposing a
  boolean masked state to the browser; the actual default must never enter view
  data. Legacy-password and bulk/group AD operations remain blocked until a
  narrow endpoint reproduces their helper semantics.

## Frontend conventions

- Use Vite for browser JavaScript, CSS processing, development reload, and
  hashed production assets. Express serves built assets in production.
- Use Tailwind as the primary styling system and establish shared design tokens
  and reusable EJS components for buttons, forms, tables, cards, badges, alerts,
  modals, progress, pagination, empty/loading states, and page headers.
- Avoid duplicating large Tailwind class strings across templates.
- Use HTMX selectively for server-backed search, filters, pagination, task
  refreshes, modal content, forms, bulk actions, and progress updates.
- Use Alpine.js only for small browser-local state such as dropdowns, modals,
  selection controls, and confirmations. Server state remains authoritative.
- Keep browser code in `src/frontend/`; do not scatter inline scripts through
  EJS templates.
- Keep the UI clean, consistent, desktop-focused, responsive, and information
  dense without recreating the old FOG navigation structure.

## Environment and secrets

- Support local configuration through `.env` (using `dotenv` or an equivalent
  server-side loader) and provide a committed `.env.example` when configuration
  is introduced.
- Never commit `.env` files, API tokens, credentials, session secrets, or real
  server addresses containing credentials.
- Treat the configured `FOGGY_CONFIG_FILE` as a secret store. Never commit,
  render, log, or serve it; preserve restrictive permissions and atomic writes.
- Read secrets only on the server through `process.env`; never serialize them
  into EJS output, browser bundles, logs, error pages, or HTMX responses.
- Validate required environment variables at startup and report missing or
  malformed configuration with clear, secret-free errors.
- Keep Vite-exposed variables (`VITE_*`) non-sensitive. FOG API credentials must
  never use that prefix.

## Quality and safety

- Preserve user changes and keep edits scoped to Foggy.
- Treat deploy, capture, cancellation, wake, reboot, and bulk actions according
  to their real FOG side effects; validate identifiers and require appropriate
  confirmation for consequential operations.
- Never expose a Foggy mutation route without an explicit browser-side access
  boundary and same-origin/CSRF protection. Upstream FOG API authentication does
  not authenticate the technician using Foggy.
- Start with read-only behavior and use representative tests or fixtures for FOG
  response normalization where practical.
- Keep `npm run dev`, `npm run build`, and `npm start` as the intended workflows
  once the application scaffold exists.
- Document discovered FOG 1.5 quirks and API gaps near the integration layer or
  in project documentation rather than leaking them into views.

## FOG API call documentation

- Every FOG API call used by Foggy must be documented in
  `docs/fog-api-1.5.md` in the same change that adds or changes the call.
- Record the HTTP method and path, authentication, request body/query behavior,
  response shape, Foggy normalization, permissions, side effects, error cases,
  and the exact FOG source files used as evidence.
- Mark assumptions and unverified behavior explicitly. Never present behavior
  inferred from newer FOG documentation as verified FOG 1.5 behavior.
- Keep secrets and real credential values out of documentation and fixtures.
- When an operation lacks an adequate FOG 1.5 endpoint, add it to the API gaps
  section before proposing a plugin or extension. Do not silently bypass the
  API or write directly to the FOG database.
