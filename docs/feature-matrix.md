# Foggy feature coverage contract

Foggy's target is complete coverage of the day-to-day FOG 1.5 management
surface, not only imaging. Delivery remains incremental because the generic
FOG API does not preserve every safeguard and side effect of the legacy UI.

This matrix is the product contract and the implementation gate. A feature is
not considered supported until its read model, mutation behavior, permissions,
side effects, error handling, and API calls are documented and tested.

Status values:

- **Available**: implemented in Foggy and backed by the documented API.
- **Mapped**: source behavior and likely API path are known, but Foggy does not
  expose it yet.
- **Trace required**: an API resource exists, but its complete behavior still
  needs a source trace or live compatibility check.
- **Extension required**: the stock generic API cannot safely reproduce the
  legacy operation. No database workaround is permitted.

## Platform and access

| Capability | FOG 1.5 path | Status | Notes / gate |
| --- | --- | --- | --- |
| API connectivity and authentication | Token headers or HTTP Basic; `GET /system/info` | Available | Credentials stay server-side. |
| Multiple FOG server connections | Foggy-owned config store and request context | Available | Atomic mode-0600 JSON persistence, a shared sign-in/sidebar connection-manager modal, separate pre-auth CSRF protection for setup, and mandatory re-login when switching. Global/user API tokens remain server-side. |
| Technician authentication | Native FOG management login plus Foggy session | Available with limitation | Native credentials are validated through a temporary FOG PHP session and discarded. One-hour persistent HttpOnly/SameSite cookies reference mode-0600 restart-persistent records containing only hashed bearer IDs and non-credential metadata; logout, throttling, correlation logs, and CSRF are available. REST authorization is the configured API-token owner, not the technician, so Foggy-local roles and durable audit remain future work. |
| Authorization | FOG user type plus Foggy role policy | Mapped | FOG 1.5 has only a coarse admin/mobile distinction. Foggy must deny by default. |
| Foggy audit trail | Foggy-owned persistence | Trace required | Every mutation needs actor, target, intent, result, and correlation data. FOG login history is client-user activity, not an administrator audit log. |
| Compatibility detection | `GET /system/info` is only a status probe | Trace required | Add capability probes/version configuration; never assume all 1.5 installations contain the linked source's patches. |

## Dashboard and task operations

| Capability | FOG 1.5 path | Status | Notes / gate |
| --- | --- | --- | --- |
| Operational dashboard counts and active work | `GET /host`, `/image`, `/task`, `/task/active` | Available | Current dashboard is the initial read model. |
| Running and queued tasks | `GET /task/active` | Available | Shared task categories drive the unified Tasks screen and live refresh. |
| Completed, cancelled, failed, and all task records | `GET /task` | Available with limitation | Stock FOG has no failed imaging state; Foggy shows explicit error/failure states but does not invent failures. Task rows are not guaranteed durable history. |
| Deploy, capture, and wake | `POST /host/{id}/task` | Available | Dedicated confirmed commands validate active state and image requirements; no raw numeric task-type form. |
| Run one/all assigned Snapins | `POST /host/{id}/task` types 13/12 | Available | Validates enabled assignment, refuses active-task merging, and confirms client-side execution. |
| Inventory and diagnostic task types | `POST /host/{id}/task` types 3/4/5/6/10 | Available | Integrated confirmed workflows cover Hardware Inventory, Memtest86+, TestDisk, surface testing, and FOS Debug; each validates active state and live task-type availability. |
| Local Windows password reset | `POST /host/{id}/task` type 11 | Available | Dedicated confirmed workflow validates a local SAM account before sending `passreset`, blocks kernel-argument injection, and warns about offline-reset/EFS consequences. |
| Disk wipe task types | `POST /host/{id}/task` types 18/19/20 | Available with limitation | The computer workspace offers Fast, Normal, and Full modes, verifies live type availability and idle state, and requires irreversible-action plus exact-hostname confirmation. The linked source does not establish Fast's exact overwrite algorithm/pass count. |
| Group tasking and multicast | `POST /group/{id}/task`, multicast resources | Trace required | Must report partial/group outcomes clearly and verify multicast lifecycle. |
| Scheduled tasks | Generic `/scheduledtask` resource | Trace required | Cron semantics, recurrence, cancellation, and timezone handling need tracing. |
| Cancel host task | `DELETE /host/{id}/cancel` | Available | Dedicated warning and confirmation; broader task/job cancellation remains mapped. |
| Progress refresh | `GET /task/active` | Mapped | HTMX polling with backoff, visibility awareness, and terminal-state handling. |

## Computers

| Capability | FOG 1.5 path | Status | Notes / gate |
| --- | --- | --- | --- |
| List, search, overview | `GET /host`, `/host/search/{term}`, `/host/{id}` | Available | Raw host responses contain secrets; only allowlisted normalized fields may leave `src/fog/`. |
| Tabbed host workspace and general editing | `GET /host/{id}`; `PUT /host/{id}/edit` | Available | General is the default in-place edit tab; AD, Tasks, Inventory, Groups, Snapins, Printers, Client services, Power, and History are persistent first-class tabs. Hostname, description, image, kernel, kernel arguments, init, primary disk, and BIOS/EFI exits are editable with validation and active-task image locking. |
| MAC management | Host edit API and association resources | Extension required | Generic edit can accidentally promote a newly added secondary MAC to primary. |
| Kernel, boot-exit, disk and host boot settings | `PUT /host/{id}/edit` | Available | Uses the legacy selector allowlist and linked field limits in an explicitly warned advanced section; product keys and secret-bearing fields are excluded. |
| Active Directory settings | AD defaults via exact Service search; `PUT /host/{id}/edit` | Available with limitation | Checking Join Domain fills FOG's default domain/OU/user and selects a masked default password. The real default is resolved only server-side; the browser receives only `hasPassword`. Manual fresh passwords are supported, responses are secret-stripped, and legacy password/product-key fields are omitted. Legacy-client encrypted passwords still require an extension. |
| Hardware inventory | Nested inventory plus `PUT /inventory/{id}/edit` | Available | Full hardware is shown read-only; primary user and two asset tags are editable in place using the legacy-supported fields. Hosts need a collected inventory record first. |
| Group memberships | `GET /groupassociation` joined to groups | Available (read) | Mutations remain mapped; use explicit add/remove commands and verify final membership. |
| Snapin assignments | Snapins plus `GET /snapinassociation`; `PUT /host/{id}/edit` | Available | The host Snapins tab is directly editable: its visible complete-list checklist validates every ID, omits unrelated host fields, and verifies all additions/removals. Assigned enabled packages have Run actions; assignment remains separate from execution. |
| Printer assignments/default | Host edit plus printer associations | Available | Integrated complete-list editor covers levels 0/1/2, membership, and default selection; verifies final state and reports partial failure. Level 2 warns that non-FOG local printers may be removed. |
| Client service modules | Module associations plus host edit | Available | Integrated complete-list editor honors exact global enable flags, preserves already-assigned globally unavailable modules, verifies final associations, and never exposes unrelated global settings. |
| Display manager / auto-logoff | Host screen and auto-logout resources | Trace required | Legacy methods use dedicated host helpers, not only scalar host fields. |
| Power schedules | `GET /powermanagement` | Available (read) | Scheduled mutations remain gated because generic writes bypass `FOGCron` validation. Generic create also assumes every resource has a `name` field, which PowerManagement lacks. |
| Wake | Type-14 host task with `wol: true` | Available | FOG sends WOL immediately and removes the temporary task. |
| On-demand reboot / shutdown | PowerManagement record consumed by FOG Client | API extension required | Legacy UI saves an on-demand record and the client consumes then deletes it. Stock generic create is not a reliable endpoint for this nameless model. |

## History and inventory

| Capability | FOG 1.5 path | Status | Notes / gate |
| --- | --- | --- | --- |
| Client login/logout history | `GET /usertracking` | Available (events) | Foggy filters safe normalized rows by host. Pairing events into durable sessions remains an enhancement. |
| Image/deployment history | `GET /imaginglog` | Available | Shows start/finish, image, type, and creator. |
| Snapin history and return details | `GET /snapinjob`, `/snapintask` | Available | Jobs and tasks are joined into per-host results with return details. |
| Virus history | `GET /virus` | Available | Correlated against current host MACs; historical MAC changes remain a known limitation. |
| Inventory reporting/export | `/inventory` plus host/group associations | Trace required | First-class filtering/export belongs in Foggy; avoid loading unbounded raw secret-bearing host objects into browser responses. |

## Groups and bulk management

| Capability | FOG 1.5 path | Status | Notes / gate |
| --- | --- | --- | --- |
| List and view groups | `GET /group`, hosts, and associations | Available | Group workspace includes members, hardware/image summaries, network state, and active tasks. |
| Create, rename, describe, and delete groups | Generic group CRUD | Available | Metadata editing is integrated into the group workspace and never propagates host settings. Deletion requires typed confirmation, preserves member hosts, and verifies association cleanup. |
| Add/remove members | Group `hosts` edit plus association verification | Available | Complete-list update validates host IDs, confirms intent, and reports any failed addition/removal instead of hiding partial failure. |
| Arbitrary multi-host deploy and image assignment | Per-host image update plus task creation | Available | Guided workflow validates once, processes sequentially, and reports every host including assignment-changed/task-failed partial states. |
| Group-wide image-only assignment | Group image behavior / host updates | Trace required | Legacy group operation mutates member hosts; it is not merely group metadata. |
| Bulk AD | Legacy `Group::setAD` | Extension required | Per-host modern AD is available, but bulk updates need explicit per-target outcomes and safe legacy/default-password semantics rather than one secret-bearing generic group response. |
| Bulk snapins, printers, services and power | Group helpers and association resources | Trace required | Legacy operations have distinct add/remove/default/override semantics. Implement as explicit workflows, not one oversized generic edit. |
| Bulk inventory view | Hosts plus nested inventory | Mapped | Read-only aggregation first. |

## Images, snapins, and storage

| Capability | FOG 1.5 path | Status | Notes / gate |
| --- | --- | --- | --- |
| Image list/search/detail and host usage | `GET /image`, search, individual image, hosts, active tasks | Available | Detail shows normalized definition metadata, assigned hosts derived from current host assignments, active imaging work, and direct deploy/capture actions. |
| Create image definitions | Generic image create | Available | Validated definition-only workflow includes storage, OS/type/partition, compression, format, and replication. |
| Edit image definitions | `PUT /image/{id}/edit` | Available | Validated scalar-only update omits hosts/storage associations, refuses active-task races, and never moves or deletes stored files. |
| Delete image definitions | Generic image delete | Mapped | Definition deletion is distinct from deleting image files and requires a dedicated consequence trace. |
| Guided deploy | Host assignment plus task creation | Available | Supports one or many computers with reviewed options and per-host outcomes. |
| Guided capture into existing image | Host assignment plus type-2 task | Available | Selects source and destination, enforces enabled/unprotected/idle checks, and reports assignment/task split outcomes. |
| Create image during capture | Image create plus capture composition | Available | Creates validated metadata/storage association, then returns to Capture with the new destination selected. |
| Storage group assignment/replication | Image and storage-group resources | Trace required | Storage API objects can expose FTP credentials; use strict normalizers and admin-only operations. |
| Snapin library and definition create/edit | `GET /snapin`; `POST /snapin/create`; `PUT /snapin/{id}/edit`; active Snapin-task preflight | Available (metadata) | Library links to validated create/edit forms. Create associates one storage group and references an existing basename; edit preserves storage/host associations and refuses active-task races. Neither operation changes storage files. Delete remains gated. |
| Snapin file upload | `POST /snapin/createwithfile` multipart backport | Available when detected | Foggy accepts one bounded temporary upload, proxies it with server-only tokens, and cleans it afterward. A 404/405 reports the server capability gap. FOG replaces same-named storage files before saving metadata, so late failures explicitly warn about partial application. |
| Run one/all Snapins | Host tasking plus snapin jobs/tasks | Available | Execution is separate from assignment; results remain visible in host Snapin history. |
| Storage nodes and replication health | `/storagegroup`, `/storagenode` | Trace required | Never expose node FTP credentials; normalize health and capacity only. |

## Administration

| Capability | FOG 1.5 path | Status | Notes / gate |
| --- | --- | --- | --- |
| FOG users and roles | User is intentionally absent from generic API allowlist | Extension required | Foggy account management and FOG account management are separate concerns. |
| PXE/iPXE and boot menu | `/ipxe`, `/pxemenuoptions`, settings | Trace required | Admin-only and high impact; use narrow schemas rather than arbitrary setting writes. |
| Global settings and client services | `/service` maps the global settings table | Trace required | Generic access is too broad for direct UI exposure. Build named, validated settings operations. |
| Printers | `/printer` and associations | Mapped | CRUD plus host/group assignment and default semantics. |
| Database export | Linked source exposes `/system/export` | Out of initial core | Sensitive and possibly patch-specific; no import or direct database manipulation. |
| Plugins and plugin-defined features | Plugin-dependent | Out of core | Discoverable extensions can be added later; complete core coverage does not imply emulating every third-party plugin. |

## Delivery sequence

1. **Foundation and safety** — normalized client, capability detection, named
   Foggy users/sessions/roles, CSRF, audit events, shared validation and command
   result types.
2. **Read-complete computer workspace** — computer sections for inventory,
   memberships, snapins, printers, services, power schedules, login history,
   image history, snapin history, and virus history.
3. **Unified tasks** — running/queued/history states, progress, cancellation,
   and explicit low-risk commands; then guided deploy and capture.
4. **Groups and bulk operations** — group detail/membership followed by
   image, task, snapin, printer, service, power, and inventory workflows with
   per-host outcomes.
5. **Images, snapins, and storage** — full libraries, safe definition CRUD,
   file/capture workflows, storage health, replication, and multicast.
6. **Administration and extensions** — legacy/bulk AD support, users, PXE/boot, and
   narrowly modeled global settings.

Current work has completed the read-oriented computer workspace, common host
task commands including diagnostics, password reset, and disk wipes, guided deployment and capture, image creation/detail/editing,
per-host Snapin assignment/execution, unified task views, and verified group
lifecycle/membership. The next slices are image deletion safeguards, Snapin
file deletion safeguards, group bulk settings, and Foggy's durable
named-user/session/audit foundation.

## Source evidence

- API routing, authorization, generic CRUD/tasking, and formatters:
  `fogproject/packages/web/lib/router/route.class.php`
- Host legacy sections and mutations:
  `fogproject/packages/web/lib/pages/hostmanagementpage.class.php`
- Group legacy sections and bulk behavior:
  `fogproject/packages/web/lib/pages/groupmanagementpage.class.php`
- Host/group association and AD helpers:
  `fogproject/packages/web/lib/fog/host.class.php`,
  `fogproject/packages/web/lib/fog/group.class.php`
- Inventory/history models: `inventory.class.php`, `usertracking.class.php`,
  `imaginglog.class.php`, `virus.class.php`, `snapinjob.class.php`, and
  `snapintask.class.php` under `fogproject/packages/web/lib/fog/`
- Association and settings models: `groupassociation.class.php`,
  `snapinassociation.class.php`, `printerassociation.class.php`,
  `moduleassociation.class.php`, and `powermanagement.class.php` in the same
  directory.
