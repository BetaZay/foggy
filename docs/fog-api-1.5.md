# FOG 1.5 API contract used by Foggy

This is the source-backed contract for calls made by Foggy. Update it whenever
an integration call is added or changed.

## Inspected version

- Runtime version constant: `FOG_VERSION = 1.5.10.2254`
- Git branch and commit: `stable` at
  `9f3b5a8960aa840bda9876a2bda3ddb03d71328e`
- The commit is tagged/described as `1.5.10.2253`; the checked-in runtime
  constant is one revision ahead. Foggy targets compatible FOG 1.5.x behavior,
  while this document describes the linked source exactly.

Evidence:

- `fogproject/packages/web/lib/fog/system.class.php`
- Read-only Git metadata in `fogproject/.git`

## Routing

FOG's API is implemented by one generic router. The API base is the configured
FOG web root, commonly `https://fog.example.test/fog`. Apache rewrites matching
requests to `api/index.php`; callers do not include `/api/index.php` in normal
resource URLs.

The resource router supports these generic shapes for allowlisted classes:

| Method | Path | Meaning |
| --- | --- | --- |
| `GET` | `/{class}` or `/{class}/list` | List objects |
| `GET` | `/{class}/{id}` | Get one object |
| `GET` | `/{class}/search/{term}` | Search objects |
| `GET` | `/{class}/active` | List queued/in-progress task-like objects |
| `PUT` | `/{class}/{id}` | Edit an object |
| `POST` | `/{class}` | Create an object |
| `POST` | `/{tasking-class}/{id}/task` | Create task package(s) |
| `DELETE` | `/{tasking-class}/{id}/cancel` | Cancel task(s) |
| `DELETE` | `/{class}/{id}` | Delete an object |

Evidence:

- `fogproject/packages/web/api/index.php`
- `fogproject/packages/web/lib/router/route.class.php` (`defineRoutes`)
- `fogproject/lib/common/functions.sh` (Apache rewrite generation)

## Authentication and authorization

The FOG API must be enabled (`FOG_API_ENABLED`) and every headless request must
send the header-ready application token copied from the FOG UI:

```text
fog-api-token: <value shown in FOG Configuration → FOG Settings → API System>
```

It must also authenticate a user by one of these mechanisms:

```text
fog-user-token: <value shown in Users → user → API Settings>
```

or HTTP Basic authentication. Foggy REST calls use the application and user
tokens stored in its mode-0600 server config. Interactive technician credentials
are validated separately through FOG's native management login and are never
used as REST credentials or persisted. Token values shown by the UI are already
encoded for use as header values; Foggy sends them verbatim.

In the inspected source, read routes for hosts, images, groups, associations,
and task-related classes are available to the mobile/non-admin user type.
Object creation/edit/deletion requires an administrator. Task creation and
cancellation remain available to the mobile user type. This authorization
hardening may not exist in older 1.5.x installations, so Foggy must still avoid
requesting or exposing privileged fields.

Evidence: `fogproject/packages/web/lib/router/route.class.php`
(`_testToken`, `_testAuth`, `_requireAuthorized`).

UI locations:

- Enable API and copy global token: **FOG Configuration → FOG Settings → API
  System**. The API System category has its own **Update** button; checking the
  box without submitting that category does not persist the change.
- Enable/copy user token: **Users → List All Users → user → API Settings**.

## Calls currently used by Foggy

### List hosts

- Call: `GET /host`
- Request body: none. Although the generic handler reads a JSON body for
  filters, browser-standard `GET` requests cannot reliably send one; Foggy uses
  the dedicated search route for text search.
- Response: `{ "count": number, "hosts": Host[] }`
- Foggy retains only operational fields: id, name, description, primary and
  additional MACs, assigned image id/name, inventory summary, last deployment,
  creation time, ping status, non-secret kernel/boot overrides, and the AD
  enabled/domain/OU/username values needed for a safe status view.
- FOG's `pingstatus` is presentation HTML (`<i class="icon-ping-…">`), not a
  status string. Foggy never forwards it. The normalizer derives a plain label
  and semantic tone from `pingstatuscode`, using the markup's restricted title
  only to distinguish Linux from FOS for code `111`.
- Security: the upstream host formatter can return decrypted `ADPass` and
  `productKey`, along with client security tokens. Foggy uses an allowlist
  normalizer and discards all such fields before returning data to routes. The
  normalized Active Directory object never contains a password property.
- Side effects: none expected, though upstream formatting performs a live ping
  status lookup.
- Evidence: `Route::listem`, `Route::getter('host')`, and
  `fogproject/packages/web/lib/fog/host.class.php`.

### Search hosts

- Call: `GET /host/search/{URL-encoded term}`
- Response: `{ "count": number, "hosts": Host[] }`
- Normalization and security are identical to list hosts.
- Side effects: none expected, with the same ping-status caveat.
- Evidence: `Route::search` and `Route::getter('host')`.

### Get host

- Call: `GET /host/{positive integer id}`
- Response: one Host object, not wrapped in a collection.
- Errors: invalid or missing ids produce `404`.
- Normalization and security are identical to list hosts.
- Evidence: `Route::indiv` and `Route::getter('host')`.

### List images

- Call: `GET /image`
- Response: `{ "count": number, "images": Image[] }`
- Foggy retains id, name, description, path, size fields, type, partition type,
  OS, storage group name, timestamps, deployment time, format, compression,
  protection, enablement, and replication state.
- Side effects: none.
- Evidence: `Route::listem`, `Route::getter('image')`, and
  `fogproject/packages/web/lib/fog/image.class.php`.

### Get an image and derive current usage

- Calls: `GET /image/{positive integer id}`, `GET /host`, and
  `GET /task/active`.
- Individual response: one raw Image object, not a collection. The configured
  FOG 1.5 server was probed read-only on 2026-08-27 and returned the scalar
  database fields plus nested OS, image type, and partition type objects and
  their display names. It did not return usable `hosts` or `storagegroups`
  arrays, even though those are lazy model fields.
- Foggy normalization: retains the same allowlisted image fields as the list,
  plus numeric OS/image-type/partition-type IDs and creation actor. Current
  assigned hosts are derived from normalized hosts whose `imageID` equals the
  requested image. Active tasks are similarly filtered by normalized nested
  image ID. Raw host and task objects never reach the view.
- Permissions: individual images, hosts, and active tasks are readable by the
  mobile/non-admin type in the inspected source.
- Side effects: none expected, with the host live-ping formatting caveat.
- Errors: a missing image returns `404`; invalid IDs are rejected inside Foggy
  before an upstream request.
- Evidence: `Route::indiv`, `Route::getter('image')`, `image.class.php`,
  `host.class.php`, and `task.class.php`.

### List image-definition lookup values

- Calls: `GET /os`, `GET /imagetype`, `GET /imagepartitiontype`, and
  `GET /storagegroup`.
- Responses use the generic collections `oss`, `imagetypes`,
  `imagepartitiontypes`, and `storagegroups`.
- Foggy retains only ID/name/description/type for the first three. Storage
  groups retain ID/name/description, enabled-node IDs, and supported-client
  count. Raw storage nodes are never requested, so their FTP credentials cannot
  enter this workflow.
- Permissions: OS/image type/partition type are readable by the mobile type;
  storage groups require an administrator in the inspected source.
- Side effects: none.
- Evidence: `Route::$nonAdminClasses`, `os.class.php`, `imagetype.class.php`,
  `imagepartitiontype.class.php`, and `storagegroup.class.php`.

### Search images

- Call: `GET /image/search/{URL-encoded term}`
- Response and normalization are identical to list images.
- Side effects: none.
- Evidence: `Route::search` and `Route::getter('image')`.

### List groups

- Call: `GET /group`
- Response: `{ "count": number, "groups": Group[] }`
- Foggy retains id, name, description, creation metadata, building, and
  computed host count.
- Side effects: none.
- Evidence: `Route::listem`, `Route::getter('group')`, and
  `fogproject/packages/web/lib/fog/group.class.php`.

### List all tasks

- Call: `GET /task`
- Response: `{ "count": number, "tasks": Task[] }`
- Foggy retains the task id/name, host summary, image summary, task type/state,
  timestamps, progress, transfer rate, elapsed/remaining time, copied/total
  data, shutdown/debug/WOL flags, and storage node/group names.
- Security: nested hosts pass through the same allowlist normalizer.
- Side effects: none expected; nested host formatting has the ping caveat.
- Evidence: `Route::listem`, `Route::getter('task')`, and
  `fogproject/packages/web/lib/fog/task.class.php`.
- Foggy categorizes the stock task states as queued (1/2), running (3),
  completed (4), and cancelled (5). State names containing explicit failure or
  error terms are categorized as failed for patched/plugin installations.
  Stock FOG 1.5 does not define a failed imaging task state.

### List active tasks

- Call: `GET /task/active`
- Response: `{ "count": number, "tasks": Task[] }`
- Meaning: tasks whose state is in FOG's queued or in-progress state sets.
- Normalization is identical to list all tasks.
- Side effects: none expected; nested host formatting has the ping caveat.
- Evidence: `Route::active` and `Route::getter('task')`.

### API status

- Call: `GET /system/info` (`GET /system/status` is routed identically)
- Response: plain text `success` with HTTP 200, rather than JSON.
- Live 1.5 server quirk: the response declares `Content-Type:
  application/json` even though bare `success` is not valid JSON. Foggy requests
  and validates this endpoint explicitly as text.
- Use: after native technician validation, Foggy calls this once with the
  server's stored application and user tokens to verify that the REST identity
  is usable. Normal pages then infer availability from their resource reads.
- Side effects: none.
- Evidence: `Route::status`.
- Foggy disables automatic redirect following. A redirect to the management UI
  is treated as `FOG_API_REDIRECT`, because the inspected router performs that
  redirect when `FOG_API_ENABLED` is off. Resource calls additionally require
  JSON so a login page can never be normalized into a false empty result.

### Validate a technician through the native management login

- Calls:
  - `GET /management/index.php` to establish a temporary PHP session cookie.
  - `POST /management/index.php` with URL-encoded `uname`, `upass`, and
    `login=1`, carrying that cookie.
  - `GET /management/index.php?node=home` with the cookie to distinguish the
    authenticated page from the returned login form.
  - `GET /management/index.php?node=logout` to destroy the temporary upstream
    session whether validation succeeds or fails.
- Authentication: this is FOG's native login, not REST authentication. No API
  token is sent. The submitted password exists only for the request and is not
  retained in the Foggy session, config, rendered response, or logs.
- Response behavior: login POST redirects to `index.php` in both success and
  failure paths. Foggy therefore verifies the follow-up page: a response with
  `uname`/`upass` fields is rejected, while an authenticated page must contain
  FOG's logout action. Foggy never forwards or stores the returned HTML.
- Permissions: any FOG user accepted by `User::passwordValidate`, including
  authentication-plugin hooks, may establish a Foggy session. Subsequent REST
  permissions belong to the configured API user-token owner.
- Side effects: FOG creates then destroys a PHP session, writes its native
  accepted/failed login log, and fires the normal login hooks. Plugin-defined
  login hooks may have their own side effects.
- Errors: unreachable/timeout and HTTP errors are distinct from an invalid
  username/password. Redirect destinations are never followed to another host.
- Evidence:
  `fogproject/packages/web/management/index.php`,
  `fogproject/packages/web/lib/pages/processlogin.class.php`,
  `fogproject/packages/web/lib/fog/user.class.php`, and
  `fogproject/packages/web/lib/fog/page.class.php`.

### List host group memberships

- Calls: `GET /group` and `GET /groupassociation`
- Responses: `{ count, groups: Group[] }` and
  `{ count, groupassociations: [{ id, hostID, groupID }] }`.
- Foggy joins the allowlisted association identifiers to normalized groups and
  returns only groups for the requested host. Filtering happens server-side in
  Foggy because the generic GET-body filter is not portable.
- Permissions: both resources are readable by the mobile/non-admin type in the
  inspected source. Side effects: none.
- Evidence: `Route::listem`, `Route::$nonAdminClasses`,
  `groupassociation.class.php`, and `group.class.php`.

### List Snapins and host assignments

- Calls: `GET /snapin` and `GET /snapinassociation`
- Responses: `{ count, snapins: Snapin[] }` and
  `{ count, snapinassociations: [{ id, hostID, snapinID }] }`.
- Foggy retains Snapin identity, description, file name, execution arguments,
  package type, timeout, size, storage-group name, enabled state, and requested
  reboot/shutdown flags. It joins assignments by numeric identifiers.
- Permissions: both resources are readable by the mobile/non-admin type in the
  inspected source. Side effects: none.
- Evidence: `Route::getter('snapin')`, `Route::$nonAdminClasses`,
  `snapin.class.php`, and `snapinassociation.class.php`.

### Create a Snapin definition from an existing stored file

- Foggy status: available at `GET /snapins/new`; the authenticated Foggy form
  posts through CSRF protection and requires an explicit consequence checkbox.
- Preflight calls: `GET /snapin` for case-insensitive name uniqueness and
  `GET /storagegroup` for a current positive storage-group ID. The storage
  response can contain node/FTP-adjacent fields in FOG 1.5; Foggy immediately
  normalizes it to `{ id, name, description, enabledNodeIds,
  totalSupportedClients }` and never serializes the raw object to a view.
- Mutation: `POST /snapin/create`, authenticated with the configured
  `fog-api-token` and acting user's `fog-user-token` (or server-side Basic
  credentials where configured). The inspected hardened router requires an
  administrator for create routes.
- Body fields: `name`, `description`, `file`, `args`, `runWith`,
  `runWithArgs`, `packtype` (`0` normal or `1` pack), `timeout`, `protected`,
  `isEnabled`, `toReplicate`, `hide`, mutually exclusive `reboot`/`shutdown`,
  `createdTime`, `createdBy: "Foggy"`, and
  `storagegroups: [positiveIntegerId]`.
- Validation: name is required, unique, and at most 200 characters. The file is
  a basename only and follows the linked `Snapin::sanitizeSnapinFileName`
  safety boundary: no path separators, `.`/`..`, control/unsupported
  characters, or names containing FOG's reserved `ssl` substring. Timeout is a
  non-negative signed database integer. The selected storage group must still
  exist.
- Response: the standard individual Snapin object. Foggy normalizes identity,
  execution settings, safe storage-group name, size/hash metadata, and state.
- Side effects: creates the Snapin row and a Snapin-to-storage-group
  association. It does **not** upload, hash, inspect, move, overwrite, or verify
  the named file. A missing file is therefore possible and is stated in the UI.
  No host assignment or Snapin task is created.
- Errors: 403 for insufficient upstream authorization; 404/validation races for
  missing lookup values; 417/500 or other upstream failures from required
  fields, uniqueness, association, or save behavior. Foggy never falls back to
  direct storage or database access.
- Evidence: generic route registration and `Route::create` in
  `router/route.class.php`; fields/required fields, association behavior, and
  filename rules in `fog/snapin.class.php`; schema width in
  `commons/schema.php`; equivalent legacy inputs and save behavior in
  `pages/snapinmanagementpage.class.php`.

### Upload an installer and create its Snapin definition

- Foggy status: available as the primary option on `GET /snapins/new`, with
  runtime capability detection. This endpoint is present in the linked FOG
  tree but appears to be a local/backported addition rather than a universal
  FOG 1.5 route. HTTP 404/405 is converted into a documented capability gap;
  Foggy does not attempt FTP or database access.
- Browser boundary: authenticated browser multipart data is accepted only on
  the same origin, parsed as one `installer` file with bounded part/field
  counts and `FOGGY_SNAPIN_UPLOAD_MAX_BYTES`, then written under the operating
  system temporary directory. The temporary file is removed after the Foggy
  response closes. API tokens never enter the browser.
- Preflight calls: `GET /snapin` and `GET /storagegroup`, with the same strict
  name, filename, and storage-ID validation used by metadata-only creation.
- Mutation: `POST /snapin/createwithfile` using server-side multipart/form-data
  and the configured API/user-token headers. Upload requests use
  `FOGGY_SNAPIN_UPLOAD_TIMEOUT_MS` rather than the short polling timeout.
- Multipart fields: uploaded file `snapinfile`; text fields `snapin` (name),
  `description`, `packtype`, `rw`, `rwa`, `storagegroup`, `args`, `timeout`, and
  `action` (`none`, `reboot`, or `shutdown`). Boolean fields `isEnabled`,
  `toReplicate`, and `isHidden` are included only when true because the FOG
  handler uses PHP `isset()` semantics.
- Deliberate omission: `protected` is not accepted by the linked combined
  handler. Newly uploaded Snapins begin unprotected and can be protected in a
  separately confirmed edit after creation.
- Response: HTTP 201 plus the standard individual Snapin shape; Foggy retains
  normalized definition fields including FOG-calculated SHA-512 hash and size.
- Permissions: the inspected hardened router requires an administrator for the
  upload/create route. Authentication uses the normal FOG application and
  acting-user token headers.
- Side effects: FOG validates the storage group and master node, connects to
  that node using FOG-owned FTP credentials, deletes a same-named destination,
  uploads and chmods the replacement, calculates hash/size, creates the Snapin
  record/storage association, and makes that group primary. It creates no host
  assignment or task.
- Partial-failure boundary: storage replacement occurs before the Snapin row is
  saved. A transport failure can leave earlier storage work applied, and a
  database-save failure can leave the uploaded file without a definition. The
  Foggy error page explicitly requires checking FOG storage before retrying.
- Errors: Foggy rejects oversized/malformed/multiple uploads before contacting
  FOG; 400 covers endpoint validation; 403 authorization; 404/405 unsupported
  endpoint; and 500 storage transport or post-upload save failure. Upstream
  response bodies are not exposed to the browser.
- Evidence: route registration and `Route::createSnapinWithFile` in
  `router/route.class.php`; `Snapin::uploadAndCreate`,
  `Snapin::sanitizeSnapinFileName`, and storage association helpers in
  `fog/snapin.class.php`; equivalent legacy multipart fields and behavior in
  `pages/snapinmanagementpage.class.php`.

### Edit a Snapin definition

- Foggy status: available from each Snapin library card. The form is protected
  by the Foggy session, same-origin CSRF token, and explicit confirmation.
- Preflight calls: `GET /snapin/{id}`, `GET /snapin`, and
  `GET /snapintask/active`. The active response is
  `{ count, snapintasks: SnapinTask[] }`; Foggy checks either `snapinID` or the
  nested Snapin ID and refuses the edit while a queued/running task refers to
  this definition.
- Mutation: `PUT /snapin/{positive integer id}/edit`, with the same normalized
  scalar execution fields used by create. `storagegroups`, `hosts`, size, hash,
  created metadata, and all unrelated fields are deliberately omitted.
- Response: the updated individual Snapin object, immediately normalized.
- Permissions: individual/list/active reads are available to the mobile user in
  the inspected hardened source; the edit route requires an administrator.
- Side effects: updates definition metadata read by future FOG Client Snapin
  execution. It preserves storage associations and host assignments and does
  not create/cancel jobs. Changing `file` changes only the requested filename;
  it never renames, uploads, replaces, moves, or deletes the stored file.
- Errors: 404 invalid/stale ID, 403 insufficient upstream authorization, 409
  when active Snapin tasks exist, 422 Foggy field/name validation, and surfaced
  upstream save failures. No direct database or FTP workaround is attempted.
- Evidence: `Route::edit`, `Route::active`, and route authorization tables in
  `router/route.class.php`; `snapin.class.php`, `snapintask.class.php`, and
  `SnapinManagementPage::snapinGeneralPost`.

### Replace a host's Snapin assignments

- Foggy status: exposed as a complete-list editor inside the authenticated
  computer workspace. This operation assigns packages only; it never runs a
  Snapin.
- Preflight calls: `GET /host/{id}`, `GET /snapin`, and
  `GET /snapinassociation`.
- Mutation call: `PUT /host/{positive integer id}/edit`.
- Foggy body: `{ "snapins": [5, 8] }`. The array is the complete desired
  assignment set; an empty array intentionally removes every Snapin assignment.
- Deliberate omissions: name, description, image, MACs, printers, modules,
  groups, Active Directory fields, product keys, and all other host fields are
  absent. The generic edit handler retains omitted scalar database values and
  only enters its Snapin association branch because `snapins` is present. In
  particular, omitting `macs` avoids the generic route's primary-MAC hazard.
- Validation: every submitted value must be a unique positive integer matching
  a current Snapin. Disabled Snapins may remain assigned, matching the legacy
  association screen, but Foggy still refuses to execute a disabled Snapin.
- Handler behavior: `Route::edit` diffs the requested IDs against
  `Host::get('snapins')`, then calls `removeSnapin` and `addSnapin` before
  saving. `Host::addSnapin` applies FOG's configured Snapin-limit helper.
- Verification: Foggy re-reads `GET /snapinassociation` and compares every
  requested addition and removal. Any mismatch becomes a conflict naming the
  failed IDs rather than a false success.
- Response: the generic route returns a raw Host object. Foggy deliberately
  discards it because host responses can contain decrypted AD/product-key and
  client-token fields; the browser receives only the already-normalized
  workspace reload.
- Permissions: host edit requires an administrator in the inspected source;
  association reads are available to the mobile/non-admin type.
- Side effects: creates/removes `SnapinAssociation` rows for this host only. It
  does not create a Snapin job/task and does not modify an already-created job.
- Known upstream limitation: the linked `Host::addSnapin` limit check compares
  current and newly added counts separately rather than their sum. Foggy cannot
  read `FOG_SNAPIN_LIMIT` through a narrow stock endpoint, so it documents and
  surfaces upstream rejection but cannot independently guarantee that policy.
- Evidence: `Route::edit` host branch, `Host::loadSnapins/addSnapin/
  removeSnapin`, `HostManagementPage::hostSnapins/hostSnapinPost`, and
  `snapinassociation.class.php`.

### List printers and host assignments

- Calls: `GET /host/{id}`, `GET /printer`, and `GET /printerassociation`
- Responses: `{ count, printers: Printer[] }` and
  `{ count, printerassociations: [{ id, hostID, printerID, isDefault, ... }] }`.
- Foggy retains only printer identity, description, model, IP/port, and the
  per-host default flag. The normalized host supplies printer management level
  0, 1, or 2. Configuration blobs, association anonymous fields, and unrelated
  host fields are dropped.
- Permissions: administrator required in the inspected source. Side effects:
  none.
- Evidence: `Route::$validClasses`, `Route::$nonAdminClasses`,
  `printer.class.php`, and `printerassociation.class.php`.

### List client modules and per-host state

- Calls: `GET /module`, `GET /moduleassociation`, and a narrow global-status
  lookup. Foggy first attempts
  `GET /service/ids/name={comma-separated exact setting keys}/value`.
  Installations where that filtered route returns an error use
  `GET /service/search/FOG_CLIENT_` as a capability fallback.
- Responses: `{ count, modules: Module[] }` and
  `{ count, moduleassociations: [{ id, hostID, moduleID, state }] }`.
- Foggy joins each host association to every module definition and retains
  identity, names, description, default state, per-host enabled state, and a
  boolean global availability flag. The search fallback immediately filters
  raw rows through the exact 13-key module-setting allowlist; unrelated client
  settings and values are discarded and never enter route/view models.
- Permissions: administrator required in the inspected source. Side effects:
  none.
- Evidence: `Route::$validClasses`, `Route::$nonAdminClasses`,
  `module.class.php`, and `moduleassociation.class.php`.

### List host power schedules

- Call: `GET /powermanagement`
- Response: `{ count, powermanagements: PowerManagement[] }`; fields used are
  id, hostID, five cron components, onDemand, and action.
- Foggy filters schedules to the requested host and treats the cron values as
  display-only strings. This read does not imply that generic writes are safe.
- Permissions: administrator required. Side effects: none.
- Evidence: `Route::$validClasses`, `Route::$nonAdminClasses`, and
  `powermanagement.class.php`.

### List client login history

- Call: `GET /usertracking`
- Response: `{ count, usertrackings: UserTracking[] }`; each raw item includes
  id, hostID, username, action, datetime/date, description, and a nested host.
- Foggy discards the nested host completely, maps positive actions to Login and
  other values to Logout, filters by host ID, and sorts newest-first.
- Permissions: administrator required. Side effects: none.
- Evidence: `Route::getter('usertracking')`, `usertracking.class.php`, and the
  legacy `HostManagementPage::hostlogins` pairing logic.

### List imaging history

- Call: `GET /imaginglog`
- Response: `{ count, imaginglogs: ImagingLog[] }`; fields used are id, hostID,
  start, finish, image name, type, and createdBy. The raw nested host is dropped.
- Foggy filters by host ID and sorts newest-first.
- Permissions: administrator required. Side effects: none.
- Evidence: `Route::getter('imaginglog')` and `imaginglog.class.php`.

### List Snapin execution history

- Calls: `GET /snapinjob` and `GET /snapintask`
- Responses: `{ count, snapinjobs: SnapinJob[] }` and
  `{ count, snapintasks: SnapinTask[] }`.
- Foggy filters jobs by host ID, joins tasks through jobID, and retains only job
  state/time plus task Snapin identity, state, check-in/completion, return code,
  and return details. Nested job hosts and unused Snapin fields are discarded.
- Permissions: both resources are readable by the mobile/non-admin type in the
  inspected source. Side effects: none.
- Evidence: `Route::getter` cases for both classes, `snapinjob.class.php`, and
  `snapintask.class.php`.

### List virus history

- Call: `GET /virus`
- Response: `{ count, viruss: Virus[] }`. The double-s collection key is the
  generic router's literal output for this class. Fields used are id, name, MAC,
  file, date, and mode.
- Foggy canonicalizes MAC formatting and retains only events matching one of
  the host's current MAC addresses. Historical MAC changes remain a known gap.
- Permissions: administrator required. Side effects: none.
- Evidence: `Route::listem` collection naming and `virus.class.php`.

## Mutation calls

Mutation routes require additional care because the generic API omits some of
the safeguards present in the legacy UI. Each subsection states whether Foggy
currently exposes the call.

### Edit host general fields

- Foggy status: exposed as the default General tab of the authenticated
  computer workspace. The page is the edit form rather than a separate
  read-only overview followed by an edit screen.
- Call: `PUT /host/{positive integer id}/edit` (`PUT /host/{id}` also matches
  the generic route).
- Foggy body contains only `{ name, description, imageID, kernel, kernelArgs,
  kernelDevice, init, biosexit, efiexit }`. These map to the fields saved by
  `HostManagementPage::hostGeneralPost`. Omitted database fields are retained
  by the generic handler.
- Response: the updated raw Host object; it must pass through Foggy's host
  allowlist before use. Foggy retains the six non-secret boot fields for the
  form but discards product keys, AD passwords, client security tokens, and all
  other unapproved raw values.
- Permissions: administrator required in the inspected source.
- Side effects: changes the host record, assigned image, and per-host PXE/FOS
  boot overrides. It does not create a task, change image data, or modify global
  boot defaults. Invalid overrides can prevent this host from booting FOS or
  returning to its installed operating system, so they are grouped under an
  explicit advanced warning in the UI.
- Legacy/API safeguard gap: the legacy host form refuses an image change when
  the host has a valid task. `Route::edit` does not perform that check. Foggy
  reads `/task/active` immediately before the PUT and refuses an assignment
  change when the host is active. This reduces but cannot eliminate the small
  time-of-check/time-of-use race in FOG 1.5.
- Validation: Foggy applies the linked host model's 1–15 character hostname
  rule and verifies that a non-zero image id still exists before sending the
  update. Kernel, argument, disk, and init inputs use a conservative
  250-character Foggy cap and reject control characters; the first three match
  the linked `VARCHAR(250)` storage while the later `hostInit` migration uses
  `LONGTEXT`. BIOS/EFI exits use
  the exact `Service::buildExitSelector` allowlist: blank/global default,
  `sanboot`, `grub`, `grub_first_hdd`, `grub_first_cdrom`,
  `grub_first_found_windows`, `refind_efi`, `exit`, or `reboot`.
- MAC limitation: Foggy deliberately omits `macs`. The generic host edit branch
  computes newly added MACs, then shifts the first new value into the primary
  position. When the existing primary remains in the submitted array, it is not
  in that difference set, so adding a secondary MAC can promote the new address
  unexpectedly. MAC editing remains read-only until a safe API extension or a
  verified alternative exists.
- Secret limitation: Foggy omits `productKey`, `ADPass`, `ADPassLegacy`, and
  every client security field. Product-key and AD editing cannot safely
  round-trip the raw host object and remain blocked pending a narrow endpoint
  using the same helpers as the legacy form.
- Live read-only verification: the configured FOG 1.5 server returned string
  fields named `kernel`, `kernelArgs`, `kernelDevice`, `init`, `biosexit`, and
  `efiexit` from `GET /host/{id}`. No mutation was made during this check.
- Evidence: `Route::defineRoutes`, `Route::edit` and its host branch,
  `Host::$databaseFields`, `HostManagementPage::hostGeneral/hostGeneralPost`,
  `Service::buildExitSelector`, and the host schema migrations in
  `fogproject/packages/web/commons/schema.php`.

### Update a host's modern Active Directory join settings

- Foggy status: exposed as an authenticated, same-origin form in the host's
  Active Directory tab. The technician must review the client/reboot effect and
  re-enter the join password whenever enabled settings are saved.
- Preflight calls:
  - `GET /host/{positive integer id}` verifies the host still exists. The
    existing raw password is discarded by the host normalizer and is never used
    to populate the form.
  - `GET /service/search/FOG_AD_DEFAULT_` loads only rows whose names exactly
    match `FOG_AD_DEFAULT_DOMAINNAME`, `FOG_AD_DEFAULT_OU`,
    `FOG_AD_DEFAULT_USER`, or `FOG_AD_DEFAULT_PASSWORD`. Service/global settings
    require an administrator. The raw response contains the default password,
    but the public Foggy result returns only domain, selected OU, username, and
    `hasPassword`; unrelated matching/plugin settings are discarded.
- Default-fill behavior mirrors `FOGPage::adInfo` and the legacy JavaScript:
  checking Join Domain fills blank domain/OU/user inputs. A semicolon-marked OU
  is selected from a pipe-separated list. When a default password exists, the
  browser receives only a checked “Use FOG default password” state and masked
  dots—not the secret or the legacy page's 32-hash marker.
- The Service defaults call has no expected side effects. A missing/forbidden
  response disables automatic defaults but leaves manual modern-client entry
  available; choosing a missing default during submission produces a validation
  error instead of writing an empty password.
- Mutation call: `PUT /host/{positive integer id}/edit`.
- Enabled body: `{ "useAD": 1, "ADDomain": "example.test", "ADOU":
  "OU=Workstations,DC=example,DC=test", "ADUser": "join-account",
  "ADPass": "<freshly entered value>", "enforce": 1 }`.
- Disabled body sends `useAD: 0` plus the reviewed non-secret fields and
  `enforce`; it omits `ADPass`, causing `Route::edit` to retain the stored value
  rather than returning it through the browser.
- When “Use FOG default password” is selected, Foggy performs the same exact
  allowlisted Service read again inside the mutation boundary, resolves the
  actual value server-side, and sends it as `ADPass`. The password is never
  added to the page model, session, redirect, or response.
- Why this stock API use is valid for the modern client: the linked
  `Host::setAD` does not encrypt a newly submitted modern `ADPass`; after its
  placeholder/default substitution and preservation logic, it assigns the
  resulting scalar and the legacy form calls `save()`. With a real freshly
  entered password (not a placeholder), the generic edit route assigns and
  saves the same database fields. Foggy therefore rejects the legacy form's
  32-asterisk preservation marker and 32-hash global-default marker rather than
  allowing the generic route to store either marker literally. Foggy resolves
  the global default itself when that explicit option is selected.
- Deliberate omissions: `ADPassLegacy` is a separately pre-encrypted value for
  the old client and is never accepted; `productKey`, host identity, MACs,
  image, modules, printers, groups, and every other host field are absent.
- Response: FOG returns a raw Host object and its formatter may include a
  decrypted/plain modern `ADPass`. Foggy immediately passes that response
  through `normalizeHost`, verifies the host ID, and retains only enabled,
  domain, OU, username, and enforce. The password is not logged, persisted in a
  Foggy session, rendered after success, or repopulated after validation
  failure.
- Validation: enabled updates require domain, join username, and either a new
  password or an existing server-side FOG default.
  Domain/user/password follow the linked 250-character storage limit; OU uses a
  conservative 1024-character cap and rejects semicolons because the legacy UI
  and client strip them. Password control characters and mask/default markers
  are rejected.
- Permissions: generic host editing requires an administrator in the inspected
  route authorization.
- Side effects: the FOG Client Hostname Changer can rename and join the computer
  on a later check-in. `enforce` can force name/domain changes and a reboot.
  Invalid credentials, domain, or OU cause client-side join failure. No imaging
  task is created.
- Transport limitation: if the configured FOG URL uses HTTP, the newly entered
  password travels from Foggy to FOG without TLS. Foggy displays that warning;
  HTTPS is strongly preferred.
- Compatibility limitation: this supports the modern `ADPass` path only.
  Legacy-client password encryption and bulk/group AD remain extension work.
- Verification: source-traced and covered by request-body/secret-stripping
  regression tests. A read-only check of the configured live server confirmed
  all four exact defaults are present and that Foggy's public result contains no
  password property. The PUT has not been live-tested because doing so would
  change a real host's domain behavior.
- Evidence: `Route::edit`, `Route::getter('host')`,
  `HostManagementPage::hostADPost/editPost`, `FOGPage::adFieldsToDisplay/adInfo`,
  `Host::setAD`, `HostnameChanger::json/send`, and host AD columns in
  `fogproject/packages/web/commons/schema.php`.

### Update host inventory metadata

- Foggy status: exposed in the Hardware inventory section of the authenticated
  computer workspace.
- Preflight call: `GET /host/{positive integer id}`. Foggy uses the nested,
  normalized inventory ID and refuses the mutation when the host has not yet
  collected an inventory record.
- Mutation call: `PUT /inventory/{positive integer inventory id}/edit`.
- Foggy body: `{ "primaryUser": "...", "other1": "...", "other2": "..." }`.
  These correspond exactly to the three inputs updated by the legacy host
  inventory form. Every collected hardware field is omitted, and the generic
  edit handler retains omitted database fields.
- Response: the updated raw Inventory object. Foggy normalizes it and verifies
  that its `hostID` still matches the requested host before reporting success.
- Validation: each submitted value is trimmed and limited to 50 characters,
  matching `iPrimaryUser`, `iOtherTag`, and `iOtherTag1` in the linked schema.
- Permissions: administrator required because `inventory` is not in
  `Route::$nonAdminClasses`.
- Side effects: updates only ownership/asset metadata on an existing inventory
  row. It does not recollect hardware, modify the host, or create a task.
- Limitation: the stock generic create route is not used for hosts without an
  inventory record; hardware inventory must first be collected through FOS.
- Evidence: `HostManagementPage::hostInventory` and its
  `host-hardware-inventory` branch in `editPost`, `Inventory::$databaseFields`,
  inventory table creation in `commons/schema.php`, `Route::edit`, and
  `Route::$nonAdminClasses`.

### Replace host printer configuration

- Foggy status: exposed as a complete-list editor in the authenticated
  computer workspace, with explicit confirmation of FOG Client side effects.
- Preflight calls: `GET /host/{id}`, `GET /printer`, and
  `GET /printerassociation`.
- Assignment/level call: `PUT /host/{id}/edit` with
  `{ "printers": [ids], "printerLevel": 0|1|2 }`. `printers` is the complete
  desired set; the host edit branch computes additions/removals through
  `Host::addPrinter` and `Host::removePrinter`. Other host fields are omitted
  and retained by the generic edit handler.
- Default calls: after re-reading associations, Foggy sends
  `PUT /printerassociation/{associationId}/edit` with `{ "isDefault": 0 }`
  for stale defaults, followed by `{ "isDefault": 1 }` for the selected
  assigned printer. A default of zero clears all defaults.
- Validation: every printer ID must be a unique positive ID present in the
  current printer list; the level must be 0, 1, or 2; and the default must be
  zero or one of the selected printers. Browser-supplied association IDs are
  never accepted.
- Management semantics: level 0 disables FOG printer management; level 1 adds
  assigned FOG printers and removes unassigned FOG-managed printers; level 2
  allows only assigned printers and can remove locally configured printers
  that do not exist in FOG. The level-2 consequence is displayed before the
  required confirmation.
- Verification and partial failure: Foggy verifies assignment membership
  before touching defaults, clears old defaults before setting the new one,
  then re-reads both host and association resources. Any mismatched additions,
  removals, default, or management level is reported as partial failure; Foggy
  does not claim success or attempt a racing rollback.
- Permissions: all mutations require an administrator in the inspected route
  authorization. Side effects: changes host/association rows; the FOG Client
  printer module subsequently reconciles the workstation according to the
  selected level when that module is enabled and the client checks in.
- Evidence: `HostManagementPage::hostPrinters/hostPrinterPost`,
  `Host::loadPrinters/addPrinter/removePrinter/updateDefault`, the host branch
  of `Route::edit`, `PrinterAssociation::$databaseFields`, and
  `Route::$nonAdminRoutes`.

### Replace per-host FOG Client modules

- Foggy status: exposed as a complete-list editor in the authenticated
  computer workspace.
- Preflight calls: the module, association, and global-status calls documented
  above. If neither global-status capability works, state remains readable but
  mutation is disabled rather than guessing.
- Mutation call: `PUT /host/{id}/edit` with `{ "modules": [ids] }`.
  The host edit branch compares the complete list to current associations and
  uses `Host::addModule`/`removeModule`; inserted associations receive
  `state: 1` through `FOGController::assocSetter`.
- Validation: IDs must be unique positive IDs from the current Module list.
  A module can be newly enabled only when its exact global setting is enabled.
  Unknown/plugin modules without a verified global-setting mapping cannot be
  newly enabled.
- Preservation rule: associations already enabled on the host but currently
  unavailable globally are retained unchanged. Their disabled controls are not
  interpreted as removal. This avoids an unrelated association change while
  still matching the effective FOG Client behavior, where global disablement
  takes precedence.
- Verification and partial failure: Foggy re-reads `/moduleassociation` and
  compares every intended addition/removal. A mismatch is surfaced as partial
  failure; no success is claimed and no racing rollback is attempted.
- Permissions: administrator required for host mutation and for Module,
  ModuleAssociation, and Service reads in the inspected authorization rules.
- Side effects: changes which FOG Client modules are eligible to run for this
  host. Effective behavior changes on a subsequent client check-in and still
  depends on the global module setting.
- Evidence: `HostManagementPage::hostService/hostServicePost`,
  `FOGBase::getGlobalModuleStatus`, `FOGClient` and `ServiceModule` global/host
  checks, `Host::loadModules/addModule/removeModule`, `Route::edit`,
  `FOGController::assocSetter`, and the Module/ModuleAssociation models.

### Create a host task

- Foggy status: exposed through authenticated, same-origin confirmation
  workflows for Deploy, Capture, Wake-Up, Hardware Inventory, Memtest86+,
  TestDisk, Disk Surface Test, FOS Debug, Local Password Reset, and disk wipes.
  Arbitrary task type IDs are not accepted from browser input.
- Call: `POST /host/{positive integer id}/task`
- Inspected 1.5.10 body for a basic deploy: `{ "taskTypeID": 1 }`
- Inspected 1.5.10 body for a basic capture: `{ "taskTypeID": 2 }`
- Important discrepancy: older/general API examples use `{ "taskType": "1" }`,
  but the linked handler reads `$task->taskTypeID`. Foggy must use
  `taskTypeID` for this target and must not implement the older spelling unless
  a live compatibility test proves that installation requires it.
- Optional inspected fields: `taskName`, `shutdown`, `debug`, `deploySnapins`,
  `passreset`, `sessionjoin`, and `wol`.
- Foggy Deploy uses task type 1 with `deploySnapins: true`, or task type 17
  when the technician explicitly disables post-deploy Snapins. Capture uses
  type 2. Wake uses type 14 with `wol: true`; `Host::createImagePackage`
  immediately destroys the temporary type-14 task after calling `wakeOnLAN`.
- Foggy "Run all Snapins" uses type 12 with `deploySnapins: true`, which the
  route converts to `-1` before `Host::_createSnapinTasking` expands the host's
  assigned Snapins. "Run one" uses type 13 with the assigned Snapin's numeric
  ID. Foggy verifies that each requested Snapin is both assigned and enabled,
  and refuses to merge with or replace an existing active task.
- Diagnostic preflight calls are `GET /host/{id}`, `GET /task/active`, and
  `GET /tasktype`. Foggy verifies that the allowlisted seeded type still exists
  before sending type 3 (Debug), 4 (Memtest86+), 5 (Test Disk), 6 (Disk Surface
  Test), or 10 (Hardware Inventory). The configured live server returned all
  five with the expected IDs/access on the read-only capability check.
- Diagnostic bodies include a reviewed `wol` boolean. Debug additionally sends
  `debug: true`, matching `TaskManagementPage::_tasking`. These types do not
  require an image in `Host::createImagePackage`, so Foggy permits them on an
  otherwise valid unassigned host.
- Password Reset uses allowlisted type 11 and adds
  `"passreset": "LocalAccount"`; `Route::task` forwards that value to
  `Host::createImagePackage`, `_createTasking` stores it on the task, and the
  boot menu emits it as `winuser={value}` for `mode=winpassreset`. Foggy verifies
  type 11 through `GET /tasktype`, and the configured live server returned the
  expected ID, host/group access, and kernel mode.
- Account validation is deliberately stricter than legacy FOG's nonempty-only
  check because the value is embedded in a kernel command line. Foggy accepts
  1–20 ASCII letters, numbers, periods, underscores, `@`, `$`, or hyphens with
  no whitespace. This targets local Windows SAM names and blocks additional
  kernel-argument injection. Domain-qualified and Microsoft-account identifiers
  are not accepted.
- Disk wipes use an explicit Foggy mode allowlist: Fast is type 18, Normal is
  type 19, and Full is type 20. The corresponding bodies contain the selected
  `taskTypeID`, a Foggy task name, and the reviewed `wol` boolean; no image ID
  is required or sent. Before mutation, Foggy reads `GET /host/{id}`,
  `GET /task/active`, and `GET /tasktype`, verifies that the chosen seeded type
  exists, rejects a busy host, and requires a case-sensitive, exact hostname
  confirmation at the resource boundary. The browser cannot submit a numeric
  task-type ID.
- The seeded type definitions set `mode=wipe` with `wipemode=fast`, `normal`,
  or `full`. The linked schema describes Normal as one zero pass and Full as
  several random passes. Its Fast Wipe description incorrectly duplicates the
  Full Wipe description, and the linked management-source tree does not contain
  the FOS wipe implementation. Foggy therefore describes Fast only as the
  quickest FOS-controlled method and does not invent an overwrite algorithm or
  pass count. `FOG_WIPE_TIMEOUT` defaults to 60 seconds and is supplied by the
  FOG boot-menu layer, not by Foggy's task request.
- Response: normally an empty JSON response on success.
- Permissions: tasking is allowed for the mobile/non-admin user type in the
  inspected source.
- Side effects: calls `createImagePackage`. Foggy refuses these actions when
  the host already has an active task rather than allowing upstream logic to
  cancel or replace non-imaging work. Deploy/capture require an assigned,
  enabled image; capture additionally refuses a protected image, matching the
  legacy quick-task path. Requested shutdown and Wake-on-LAN options are passed
  explicitly. Every diagnostic interrupts the installed operating system and
  requires a PXE boot. Memtest, TestDisk, and Debug may require the technician
  to cancel the task when finished; Debug provides a privileged FOS shell.
  Password Reset blanks a local account password offline and can make
  EFS-encrypted data, saved credentials, or protected keys inaccessible; its
  confirmation states those consequences and does not imply domain-account
  recovery. Every wipe mode permanently destroys partitions, operating
  systems, applications, and user data on the target disk. Foggy presents the
  operation as irreversible and requires both a confirmation control and the
  exact target hostname.
- Evidence: `Route::task`, `Host::createImagePackage`,
  `TaskManagementPage::_tasking`, `FOGPage::deploy/deployPost`,
  `TaskType::isImagingTask/isCapture/
  isInitNeededTasking/isDebug`, and
  seeded task types/taskPassreset column in
  `fogproject/packages/web/commons/schema.php`.

### Guided multi-host deployment composition

- Foggy status: exposed at `/deploy` behind technician authentication,
  same-origin enforcement, and an explicit destructive-action confirmation.
- Preflight calls: `GET /host`, `GET /image`, and `GET /task/active`.
- Per-host mutation calls: when necessary,
  `PUT /host/{id}/edit` with the existing normalized name/description and the
  selected imageID; then `POST /host/{id}/task` using task type 1 or 17 and the
  reviewed Snapin/WOL/shutdown options.
- Validation: at least one unique, existing host; one existing enabled image;
  and no active task on each target. Busy targets are reported as skipped and
  are never mutated.
- Execution: hosts are processed sequentially so results remain attributable
  and FOG is not hit by an uncontrolled request burst.
- Partial results: every host receives a queued/skipped/failed outcome with the
  failing stage and whether its image assignment changed. If task creation
  fails after assignment, Foggy reports that state explicitly and does not
  attempt a potentially racing rollback. The overall page never turns partial
  success into a single success message.
- Side effects are the composition of the documented host image assignment and
  task creation calls. No group, temporary group, or database operation is
  used.

### Guided existing-image capture composition

- Foggy status: exposed at `/capture` behind technician authentication,
  same-origin enforcement, and explicit confirmation that stored image data
  may be replaced.
- Preflight calls: `GET /host/{id}`, `GET /image`, and `GET /task/active`.
- Mutation calls: when needed, `PUT /host/{id}/edit` preserves the normalized
  host name/description and assigns the selected image; then
  `POST /host/{id}/task` uses task type 2 with reviewed WOL/shutdown options.
- Validation: the source host and destination image must still exist, the image
  must be enabled and unprotected, and the host must not have an active task.
  These reproduce the relevant legacy quick-capture checks before mutation.
- Partial result: assignment rejection creates no task. If assignment succeeds
  but task creation fails, Foggy reports that the association changed and does
  not attempt a racing rollback.
- Scope: this workflow captures into an existing image definition. Creating a
  new definition within Capture remains a separate, documented mutation slice.
- Evidence: `TaskManagementPage::_tasking`, `TaskType::isCapture`,
  `Host::createImagePackage`, `Route::edit`, and `Route::task`.

### Cancel a host task

- Foggy status: exposed through an authenticated, same-origin confirmation
  workflow when a host has an active task.
- Call: `DELETE /host/{positive integer id}/cancel`
- Request body: none. Response: normally empty JSON.
- Foggy first reads `GET /task/active`, requires at least one matching host task,
  and records the task identifiers it expected to cancel in the command result.
- Permissions: cancellation is allowed for the mobile/non-admin user type in
  the inspected source.
- Side effects: calls `Task::cancel()` for the host's current task. Cancelling
  an in-progress imaging task can leave the client disk incomplete, so the UI
  presents a dedicated warning and requires confirmation.
- Evidence: `Route::cancel` host branch and `Task::cancel`.

### Replace group membership

- Foggy status: exposed through an authenticated, same-origin form with an
  explicit confirmation checkbox and final-state verification.
- Call: `PUT /group/{positive integer id}/edit`
- Foggy body: `{ name, description, hosts: [positive host ids], imageID: 0 }`.
  `name` and `description` preserve existing group metadata. `imageID: 0` is
  explicit because the inspected group edit branch reads that property even
  when only membership is changing; zero prevents image-assignment side effects.
- Response: the updated raw Group object. Foggy does not trust it as proof of
  association success: it re-reads `GET /groupassociation` and compares every
  requested addition and removal.
- Validation: Foggy loads `GET /host` first and rejects any submitted ID that no
  longer identifies a host. An empty hosts array intentionally removes every
  member. Duplicate IDs are collapsed.
- Permissions: administrator required in the inspected source.
- Side effects: `Route::edit` computes additions/removals against
  `Group::get('hosts')`, calls `removeHost`/`addHost`, then saves association
  changes. This workflow changes membership only; it does not copy group
  settings, assign images, or create tasks.
- Partial failure: if the verified association set differs, Foggy returns a
  conflict with the failed host IDs and never presents a single success message.
- Evidence: `Route::edit` group branch, `Group::addHost`,
  `Group::removeHost`, and the legacy membership behavior in
  `groupmanagementpage.class.php`.

### Create a group

- Foggy status: exposed through the authenticated group workspace.
- Preflight call: `GET /group` to enforce a case-insensitive unique name before
  mutation.
- Mutation call: `POST /group/create`.
- Foggy body: `{ "name": "Lab", "description": "Room 2" }`. Foggy does not
  submit hosts, images, boot fields, Snapins, printers, modules, or AD fields.
- Validation: name is required, unique, and at most 50 characters, matching the
  linked `groupName VARCHAR(50)` schema. Description is trimmed.
- Response: the created raw Group object, immediately normalized.
- Permissions: administrator required in the inspected source.
- Side effects: creates an empty group record. `FOGController::save` supplies
  the standard creation actor/time when absent. No host settings or membership
  associations are created.
- Errors: duplicate names are rejected by Foggy before the POST and by the
  generic router if raced; missing required fields or save failures are
  upstream errors. Foggy performs no direct database fallback.
- Evidence: `Route::create`, `GroupManagementPage::add/addPost`,
  `group.class.php`, `fogcontroller.class.php`, and `commons/schema.php`.

### Edit group metadata

- Foggy status: the name/description form is integrated into the standard
  group workspace and protected by the authenticated same-origin CSRF boundary
  plus explicit confirmation.
- Preflight calls: `GET /group/{id}` and `GET /group`.
- Mutation call: `PUT /group/{positive integer id}/edit`.
- Foggy body: `{ "name": "Lab", "description": "Room 3", "imageID": 0 }`.
  `imageID: 0` is included because the generic group branch reads that property
  and zero guarantees no bulk image-assignment side effect. Foggy deliberately
  omits `hosts`, Snapins, printers, modules, boot fields, product keys, and AD
  values.
- Important legacy distinction: the legacy `group-general` form can propagate
  kernel, disk, boot-exit, and product-key values to every member host. This
  Foggy operation updates group metadata only and never calls those bulk host
  helpers.
- Association safety: `Route::edit` only performs the hosts add/remove branch
  when `hosts` is present. The linked `Group::save`/`assocSetter` additionally
  ignores untouched lazy associations. Existing membership is therefore
  preserved.
- Validation: required unique name with the 50-character schema limit.
- Response: normalized updated Group. Permissions: administrator required.
- Side effects: group record name/description only.
- Evidence: `Route::edit` group branch,
  `GroupManagementPage::groupGeneral/editPost`, `group.class.php`, and
  `fogcontroller.class.php`.

### Delete a group without deleting hosts

- Foggy status: exposed through a dedicated destructive confirmation requiring
  both a checkbox and the exact group name.
- Preflight calls: `GET /group/{id}`, `GET /host`, and
  `GET /groupassociation` to show the affected membership count.
- Mutation call: `DELETE /group/{positive integer id}`. Request body: none;
  normal success response is empty.
- Verification calls: `GET /group` and `GET /groupassociation`. Foggy reports a
  conflict unless both the group row and every association for that group are
  absent.
- Permissions: administrator required in the inspected source.
- Side effects: `Group::destroy` deletes `GroupAssociation` rows for the group,
  then deletes the group row. It does not delete any Host object and does not
  roll back image, printer, Snapin, AD, boot, or other settings previously
  applied to those hosts.
- Legacy distinction: the management UI can optionally submit `massDelHosts`,
  which deletes every member host before deleting the group. The generic API
  DELETE route never supplies that option, and Foggy intentionally offers no
  combined group-and-host deletion action. The legacy
  `FOG_REAUTH_ON_DELETE` password prompt is UI-specific; Foggy instead relies
  on its technician session, CSRF boundary, typed confirmation, and the stored
  API identity's administrator permission.
- Errors: missing group (`404`), unauthorized (`403`), upstream failure, or a
  post-delete verification conflict. No database cleanup workaround is used.
- Evidence: `Route::delete`, `Group::destroy`, and
  `FOGPage::deletePost`'s optional Group mass-delete branch.

### Create an image definition

- Foggy status: exposed through an authenticated, same-origin form with an
  explicit confirmation. Successful creation returns to guided Capture with
  the new definition selected.
- Call: `POST /image/create` (`POST /image` also matches the generic route).
- Required by the inspected image model: `name`, `path`, `imageTypeID`, and
  `osID`. General examples that list only the first three are incomplete for
  this source.
- Foggy body additionally supplies description, imagePartitionTypeID,
  storagegroups (one selected group), compression, format, enabled state, and
  replication state. This matches the meaningful legacy creation fields rather
  than relying on database defaults.
- Response: the created raw Image object, immediately passed through the image
  allowlist normalizer.
- Permissions: administrator required in the inspected source.
- Validation: unique case-insensitive name and path; non-reserved, relative,
  traversal-free path; existing lookup IDs; compression 0–22; and format 0–6.
- Side effect: creates only the FOG image definition and storage-group
  association; it does not capture or overwrite disk image data. The generic
  image getter falls back to the lowest associated group if no association is
  yet marked primary, matching `Image::getStorageGroup` behavior.
- Evidence: `Route::create`, `ImageManagementPage::add/addPost`, and
  `fogproject/packages/web/lib/fog/image.class.php`.

### Edit an image definition

- Foggy status: exposed through an authenticated, same-origin form with an
  explicit confirmation and a warning that changing the path does not move
  files on storage nodes.
- Preflight calls: `GET /image/{id}`, `GET /image`, `GET /os`,
  `GET /imagetype`, `GET /imagepartitiontype`, and `GET /task/active`.
- Mutation call: `PUT /image/{positive integer id}/edit`.
- Foggy body: `name`, `description`, `path`, `osID`, `imageTypeID`,
  `imagePartitionTypeID`, `format`, `protected`, `compress`, `isEnabled`, and
  `toReplicate`. Boolean values are sent as integer `0`/`1`.
- Deliberate omissions: Foggy never supplies `hosts` or `storagegroups` from
  this form. In the generic image edit branch, supplying either property
  computes association additions and removals. Omitting them preserves current
  host assignments and storage-group associations. Primary storage-group
  changes remain a separate, unimplemented workflow.
- Validation: unique case-insensitive name and path excluding the current
  image; non-reserved relative path without traversal; existing OS/type/
  partition lookup IDs; compression 0–22; and format 0–6. Foggy refuses the
  update if an active task references the image, reducing the risk of changing
  imaging parameters during deployment or capture.
- Response: the updated raw Image object, immediately normalized through the
  image allowlist.
- Permissions: administrator required in the inspected source.
- Side effects: updates definition metadata used by future imaging operations.
  It does not rename/move/delete storage files and does not alter host or
  storage associations. Consequently, changing `path` can make existing data
  unavailable until storage contents match the new metadata.
- Error cases: missing image (`404`), unauthorized (`403`), duplicate name
  (generic API reports an error), validation/conflict in Foggy, and generic
  upstream save failure. Foggy performs no direct database or FTP fallback.
- Evidence: `Route::edit` and its image branch,
  `ImageManagementPage::imageGeneral/editPost`, and
  `fogproject/packages/web/lib/fog/image.class.php`.

## Known API gaps and risks

- The configured development server was successfully reached with API
  authentication on 2026-08-27. No address or credential values are recorded
  here; live connectivity is environment-specific and is not a compatibility
  guarantee.
- No pagination is implemented by the generic list routes. Foggy must initially
  filter/paginate normalized results locally or introduce a separately reviewed
  extension for large installations.
- No dedicated completed/failed task-history endpoint was identified. `/task`
  represents rows still in the tasks table. Foggy exposes queued, running,
  completed, cancelled, explicit failed/error, and all-record views from those
  rows, but this is not guaranteed to be a durable audit history. Stock FOG
  1.5 defines no failed imaging state; do not infer failure from missing finish
  timestamps.
- Host list formatting may expose highly sensitive decrypted fields upstream.
  Foggy must never forward raw host or nested-task-host objects.
- Last client check-in is not a clear field in the host API response. Do not
  label another timestamp as “last seen” without further evidence.
- Image “last capture” is not clearly exposed as a distinct API field.
- The linked schema's Fast Wipe description is demonstrably unreliable and the
  actual FOS erase implementation is outside the linked management-source
  tree. Foggy can safely select seeded type 18 but cannot promise its precise
  overwrite algorithm or pass count from this evidence. Normal/type 19 and
  Full/type 20 retain the schema-backed descriptions documented above.
- Image host usage is derived from current normalized host `imageID` values.
  This is a current-assignment count, not historical deployment usage.
- The generic API accepts JSON request bodies on `GET` for filters, which is not
  portable with standard Fetch/HTTP clients. Foggy does not depend on it.
- The generic host edit route does not implement `Host::setAD`'s 32-character
  mask preservation or global-default substitution. Foggy's single-host modern
  AD workflow rejects both placeholders, accepts a real freshly entered
  password, or resolves the exact allowlisted global default server-side before
  the PUT. Legacy encrypted passwords and bulk/group AD still require a narrow
  extension. Raw Host and Service responses remain secret-bearing and must
  always pass through dedicated allowlists.
- Group legacy screens apply many settings to member hosts. Generic group CRUD
  is not a complete substitute for bulk AD, printers, client services, display,
  auto-logoff, power schedules, or inventory behavior. Each needs a dedicated
  trace and per-host outcome handling.
- Generic list routes have no portable query filtering because their filter is
  read from a GET body. Login, imaging, snapin, inventory, and virus history
  reads may initially require server-side filtering of full normalized lists;
  an extension will be needed for scalable installations.
- `Virus` rows identify computers by MAC address rather than host ID, so host
  history correlation cannot be perfect after MAC changes.
- Generic `/powermanagement` create/edit accepts cron strings without the
  `FOGCron` sanitization used by repaired legacy UI paths. Foggy must apply a
  strict cron-field allowlist before exposing these writes.
- On-demand reboot and shutdown are not FOS task types. The legacy host power
  form creates a `PowerManagement` row with `onDemand: 1`; the FOG Client
  `powermanagement` module returns `shutdown` or maps `reboot` to `restart`,
  then destroys all on-demand rows for that host. Although the generic router
  advertises `POST /powermanagement/create`, its create handler unconditionally
  performs a uniqueness lookup through `$vars->name`, while the
  `PowerManagement` model has no `name` field and is not listed among the
  non-unique-name classes. Foggy therefore treats on-demand reboot/shutdown as
  requiring a narrow API extension rather than depending on this defective
  generic route. Evidence: `HostManagementPage::hostPMPost`,
  `PowerManagement`, `PowerManagementManager`, `PM::json`, and
  `Route::create`/`Route::$nonUniqueNameClasses`.
- The linked source contains special multipart snapin upload and database export
  routes that may be local backports or patches rather than universal FOG 1.5
  behavior. Snapin creation now detects its combined upload route at use time
  and reports 404/405 as unsupported; database export remains unused.
- The configured live FOG server returned HTTP 500 for the filtered
  `/service/ids/{where}/value` form even though that route is repaired in the
  linked reference tree. Foggy capability-tests it once per connection, then
  caches use of the exact-allowlisted `/service/search/FOG_CLIENT_` fallback.
- Unimplemented mutation routes remain intentionally unwired until their
  payloads and side effects are traced and documented immediately before use.
