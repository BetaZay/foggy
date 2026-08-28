import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ejs from 'ejs';
import { formatBytes, formatDate } from '../src/lib/format.js';

const host = {
  id: 1,
  name: 'BUILD-01',
  description: 'Build room workstation',
  primaryMac: '00:11:22:33:44:55',
  macs: ['00:11:22:33:44:55'],
  imageName: 'Windows 11',
  manufacturer: 'Dell Inc.',
  model: 'OptiPlex',
  serialNumber: 'ABC123',
  status: 'Success',
  lastDeployedAt: '',
  createdAt: '',
  kernel: '', kernelArgs: '', kernelDevice: '', init: '', biosExit: '', efiExit: '',
  activeDirectory: { enabled: true, domain: 'example.test', organizationalUnit: 'OU=Computers,DC=example,DC=test', username: 'join-account', enforce: true },
  screen: { width: null, height: null, refresh: null, orientation: null },
  autoLogoffMinutes: null,
  inventory: {
    id: 1, primaryUser: 'Technician', assetTag: 'ASSET-01', alternateTag: '', collectedAt: '',
    system: { manufacturer: 'Dell Inc.', product: 'OptiPlex', version: '', serial: 'ABC123', uuid: '', type: '' },
    bios: { vendor: '', version: '', date: '' },
    motherboard: { manufacturer: '', product: '', version: '', serial: '', assetTag: '' },
    processor: { manufacturer: '', version: '', currentMhz: null, maxMhz: null },
    memory: '16 GB', disk: { model: '', serial: '', firmware: '' },
    chassis: { manufacturer: '', version: '', serial: '', assetTag: '' },
    graphics: { vendors: '', products: '' },
  },
};

const image = {
  id: 3, name: 'Windows 11', description: 'Lab image', path: 'windows-11',
  osId: 5, imageTypeId: 1, partitionTypeId: 1, operatingSystem: 'Windows 11',
  imageType: 'Single Disk', partitionType: 'Everything', storageGroup: 'default',
  size: 1024, clientSize: 2048, compression: 6, format: 5,
  isProtected: false, isEnabled: true, replicates: true,
  createdAt: '2026-08-01 10:00:00', createdBy: 'fog', lastDeployedAt: '',
};

const group = { id: 2, name: 'Lab', description: 'Room 2', building: '', hostCount: 1 };
const snapin = {
  id: 5, name: 'Agent', description: 'Install agent', file: 'agent.msi', arguments: '/qn',
  runWith: 'msiexec.exe', runWithArguments: '/i', packageType: 0, timeoutSeconds: 300,
  storageGroup: 'default', isProtected: false, isEnabled: true, replicates: true,
  hidesArguments: false, reboot: true, shutdown: false,
};

const views = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../src/views');
const common = {
  assets: { scripts: ['/main.js'], styles: ['/main.css'] },
  formatBytes,
  formatDate,
  csrfToken: 'test-csrf-token',
};

async function render(template, data) {
  return ejs.renderFile(path.join(views, template), { ...common, ...data });
}

test('read-only pages and HTMX partials render with normalized resource data', async () => {
  const pages = [
    ['pages/dashboard/index.ejs', { title: 'Dashboard', currentPath: '/', errors: [], stats: { computers: 1, images: 0, active: 0, queued: 0 }, activeTasks: [], recentTasks: [] }],
    ['pages/computers/index.ejs', { title: 'Computers', currentPath: '/computers', computers: [host], search: '', error: null }],
    ['pages/computers/show.ejs', {
      title: host.name, currentPath: '/computers', computer: host,
      groups: [], snapins: [{ id: 5, name: 'Agent', description: '', file: 'agent.exe', isEnabled: true }], printers: [], clientServices: [{ id: 10, name: 'Printer Manager', shortName: 'printermanager', description: 'Manage printers', isDefault: true, isEnabled: true, globallyEnabled: true }], powerSchedules: [], activeTasks: [],
      selectedClientServiceIds: new Set([10]), clientServiceGlobalStatusAvailable: true, clientServiceConfigError: '',
      allPrinters: [{ id: 9, name: 'Lab Printer', description: '', model: 'Universal', ip: '192.0.2.9', port: '9100', isDefault: false }], selectedPrinterIds: new Set(), printerManagementLevel: 1, printerDefaultId: 0, printerAssignmentError: '',
      images: [], hasActiveTask: false,
      computerTabs: [{ id: 'general', label: 'General' }, { id: 'active-directory', label: 'Active Directory' }, { id: 'tasks', label: 'Tasks & actions' }, { id: 'inventory', label: 'Inventory' }, { id: 'groups', label: 'Groups' }, { id: 'snapins', label: 'Snapins' }, { id: 'printers', label: 'Printers' }, { id: 'services', label: 'Client services' }, { id: 'power', label: 'Power' }, { id: 'history', label: 'History' }], activeTab: 'general',
      values: { name: host.name, description: host.description, imageId: 0, kernel: '', kernelArgs: '', kernelDevice: '', init: '', biosExit: '', efiExit: '' }, errors: {}, formError: '',
      inventoryValues: { primaryUser: 'Technician', assetTag: 'ASSET-01', alternateTag: '' }, inventoryErrors: {}, inventoryFormError: '',
      allSnapins: [{ id: 5, name: 'Agent', description: '', file: 'agent.exe', isEnabled: true }],
      selectedSnapinIds: new Set([5]), snapinAssignmentError: '', snapinsUpdated: false,
      adValues: { enabled: true, domain: 'example.test', organizationalUnit: 'OU=Computers,DC=example,DC=test', username: 'join-account', enforce: true }, adErrors: {}, adFormError: '',
      adDefaults: { domain: 'default.test', organizationalUnit: 'OU=Default,DC=default,DC=test', username: 'default-join', hasPassword: true }, adDefaultsError: null,
      history: { logins: [], imaging: [], snapinJobs: [], snapinTasks: [], viruses: [] },
      sectionErrors: { groups: null, snapins: null, printers: null, services: null, power: null, history: null, tasks: null, images: null },
    }],
    ['pages/computers/task-action.ejs', { title: `Deploy · ${host.name}`, currentPath: '/computers', computer: host, action: 'deploy', actionDetails: { title: 'Deploy image', description: 'Queue deployment.', consequence: 'The target disk will be overwritten.', button: 'Queue deployment' }, activeTasks: [], formError: '' }],
    ['pages/computers/task-action.ejs', { title: `Inventory · ${host.name}`, currentPath: '/computers', computer: host, action: 'inventory', actionDetails: { title: 'Refresh hardware inventory', description: 'Collect hardware.', consequence: 'The computer will PXE boot into FOS.', button: 'Queue inventory task', wakeOption: true, warning: true }, activeTasks: [], formError: '' }],
    ['pages/computers/task-action.ejs', { title: `Password reset · ${host.name}`, currentPath: '/computers', computer: host, action: 'password-reset', actionDetails: { title: 'Reset local password', description: 'Blank a local account password.', consequence: 'Offline reset can affect protected data.', button: 'Queue password reset', wakeOption: true, warning: true, accountInput: true }, values: { account: 'Administrator', wipeMode: 'fast', targetConfirmation: '' }, activeTasks: [], formError: '' }],
    ['pages/computers/task-action.ejs', { title: `Wipe · ${host.name}`, currentPath: '/computers', computer: host, action: 'wipe', actionDetails: { title: 'Permanently wipe disks', description: 'Erase disks.', consequence: 'All target-disk data will be destroyed.', button: 'Permanently wipe disks', wakeOption: true, danger: true, wipeInput: true }, values: { account: 'Administrator', wipeMode: 'fast', targetConfirmation: '' }, activeTasks: [], formError: '' }],
    ['pages/images/index.ejs', { title: 'Images', currentPath: '/images', images: [], search: '', error: null }],
    ['pages/images/show.ejs', { title: image.name, currentPath: '/images', image, assignedHosts: [host], activeTasks: [], updated: false, lookups: { operatingSystems: [{ id: 5, name: 'Windows 11' }], imageTypes: [{ id: 1, name: 'Single Disk' }], partitionTypes: [{ id: 1, name: 'Everything' }], storageGroups: [{ id: 1, name: 'default' }] }, values: { name: image.name, description: image.description, path: image.path, osId: 5, imageTypeId: 1, partitionTypeId: 1, compression: 6, format: 5, isProtected: false, isEnabled: true, replicates: true }, errors: {}, formError: '' }],
    ['pages/images/new.ejs', { title: 'Create image definition', currentPath: '/images', lookups: { operatingSystems: [{ id: 1, name: 'Windows' }], imageTypes: [{ id: 1, name: 'Single Disk' }], partitionTypes: [{ id: 1, name: 'Everything' }], storageGroups: [{ id: 1, name: 'default' }] }, values: { name: '', description: '', path: '', osId: 1, imageTypeId: 1, partitionTypeId: 1, storageGroupId: 1, compression: 6, format: 5, replicates: true }, errors: {}, formError: '' }],
    ['pages/servers/new.ejs', { title: 'Add FOG server', heading: 'Add a FOG server', description: 'Store both tokens.', action: '/servers', submitLabel: 'Add server', values: { name: '', baseUrl: '', timeoutMs: '10000' }, errors: {}, formError: '', cancelHref: '/login', preAuthCsrfToken: 'setup-csrf-token' }],
    ['pages/auth/login.ejs', { title: 'Sign in', servers: [{ id: 'primary', name: 'Primary FOG', baseUrl: 'http://fog.test/fog', configured: true, setupRequired: false }], values: { serverId: 'primary', username: '', returnTo: '/' }, error: '', referenceId: '', serverAdded: false, loginCsrfToken: 'login-csrf-token' }],
    ['pages/snapins/index.ejs', { title: 'Snapins', currentPath: '/snapins', snapins: [snapin], error: null }],
    ['pages/snapins/new.ejs', { title: 'Create Snapin definition', currentPath: '/snapins', lookups: { storageGroups: [{ id: 1, name: 'default' }] }, values: { name: '', description: '', file: '', arguments: '', runWith: '', runWithArguments: '', packageType: '0', timeoutSeconds: '0', storageGroupId: '1', isProtected: false, isEnabled: true, replicates: true, hidesArguments: false, postAction: 'none' }, errors: {}, formError: '' }],
    ['pages/snapins/edit.ejs', { title: 'Edit Agent', currentPath: '/snapins', snapin, created: false, updated: false, values: { ...snapin, packageType: '0', timeoutSeconds: '300', postAction: 'reboot' }, errors: {}, formError: '' }],
    ['pages/computers/run-snapins.ejs', { title: 'Run Snapins', currentPath: '/computers', computer: host, requestedSnapin: 'all', selectedSnapin: null, snapins: [{ id: 5, name: 'Agent', description: '', file: 'agent.exe', isEnabled: true, reboot: false, shutdown: false }], activeTasks: [], formError: '' }],
    ['pages/groups/index.ejs', { title: 'Groups', currentPath: '/groups', groups: [], error: null, created: false, deletedName: '' }],
    ['pages/groups/new.ejs', { title: 'Create group', currentPath: '/groups', values: { name: '', description: '' }, errors: {}, formError: '' }],
    ['pages/groups/delete.ejs', { title: 'Delete Lab', currentPath: '/groups', group, members: [host], formError: '' }],
    ['pages/groups/show.ejs', { title: 'Lab', currentPath: '/groups', group, members: [host], activeTasks: [], taskError: null, membersUpdated: false, created: false, updated: false, values: { name: 'Lab', description: 'Room 2' }, errors: {}, formError: '' }],
    ['pages/groups/edit-members.ejs', { title: 'Manage Lab membership', currentPath: '/groups', group: { id: 2, name: 'Lab' }, computers: [host], selectedIds: new Set([host.id]), formError: '' }],
    ['pages/tasks/index.ejs', { title: 'Tasks', currentPath: '/tasks', tasks: [], status: 'active', error: null }],
    ['pages/deploy/index.ejs', { title: 'Deploy', currentPath: '/deploy', computers: [host], images: [{ id: 3, name: 'Windows 11', description: '', operatingSystem: 'Windows', imageType: 'Resizable', storageGroup: 'default' }], values: { hostIds: [host.id], imageId: '3', includeSnapins: true, wake: true, shutdown: false }, formError: '' }],
    ['pages/deploy/results.ejs', { title: 'Deployment results', currentPath: '/deploy', result: { image: { name: 'Windows 11' }, queued: 1, failed: 0, outcomes: [{ host, status: 'queued', imageChanged: false, message: 'Deployment queued.' }] } }],
    ['pages/capture/index.ejs', { title: 'Capture', currentPath: '/capture', computers: [host], images: [{ id: 3, name: 'Windows 11', description: '', operatingSystem: 'Windows', imageType: 'Resizable', storageGroup: 'default', isEnabled: true, isProtected: false }], values: { hostId: host.id, imageId: 3, wake: true, shutdown: false }, formError: '' }],
    ['pages/capture/results.ejs', { title: 'Capture result', currentPath: '/capture', result: { host, image: { name: 'Windows 11' }, status: 'queued', stage: 'complete', imageChanged: false, message: 'Capture queued.' } }],
    ['pages/error.ejs', { title: 'Not found', currentPath: '/missing', status: 404, message: 'Missing' }],
  ];

  for (const [template, data] of pages) {
    const html = await render(template, data);
    assert.match(html, /<!doctype html>/i, `${template} should render a full page`);
    if (template === 'pages/computers/show.ejs') {
      assert.match(html, /aria-current="page">General</);
      assert.match(html, /\?tab=tasks/);
      assert.match(html, /id="computer-settings"/);
      assert.match(html, /action="\/computers\/1"/);
      assert.doesNotMatch(html, /href="\/computers\/1\/edit"/);
      assert.match(html, /name="kernelArgs"/);
      assert.match(html, /name="biosExit"/);
      assert.doesNotMatch(html, /action="\/computers\/1\/printers"/);
    }
  }

  const computerBase = pages.find(([template]) => template === 'pages/computers/show.ejs')[1];
  const tasksTab = await render('pages/computers/show.ejs', { ...computerBase, activeTab: 'tasks' });
  assert.match(tasksTab, /tasks\/new\?action=inventory/);
  assert.match(tasksTab, /tasks\/new\?action=wipe/);
  assert.doesNotMatch(tasksTab, /id="computer-settings"/);
  const printersTab = await render('pages/computers/show.ejs', { ...computerBase, activeTab: 'printers' });
  assert.match(printersTab, /action="\/computers\/1\/printers"/);
  assert.match(printersTab, /Only assigned printers/);
  const snapinsTab = await render('pages/computers/show.ejs', { ...computerBase, activeTab: 'snapins' });
  assert.match(snapinsTab, /action="\/computers\/1\/snapins"/);
  assert.match(snapinsTab, /Edit assignments/);
  assert.match(snapinsTab, /Run all assigned/);
  assert.doesNotMatch(snapinsTab, /<details id="snapin-assignments"/);
  const servicesTab = await render('pages/computers/show.ejs', { ...computerBase, activeTab: 'services' });
  assert.match(servicesTab, /action="\/computers\/1\/services"/);
  const adTab = await render('pages/computers/show.ejs', { ...computerBase, activeTab: 'active-directory' });
  assert.match(adTab, /example\.test/);
  assert.match(adTab, /name="password"/i);
  assert.match(adTab, /name="password"[^>]*value=""/i);
  assert.match(adTab, /name="useDefaultPassword"/i);
  assert.match(adTab, /Fill FOG defaults/);
  assert.doesNotMatch(adTab, /decrypted-password|legacy-secret/);

  const partial = await render('pages/computers/table.ejs', {
    computers: [host], search: 'BUILD', error: null,
  });
  assert.match(partial, /BUILD-01/);
  assert.doesNotMatch(partial, /<!doctype html>/i);

  const manager = await render('pages/servers/manager.ejs', {
    servers: [{ id: 'primary', name: 'Primary FOG', baseUrl: 'http://fog.test/fog', setupRequired: false }],
    currentServerId: 'primary', signedIn: true, returnTo: '/computers',
  });
  assert.match(manager, /FOG servers/);
  assert.match(manager, /Configure/);
  assert.doesNotMatch(manager, /<!doctype html>/i);

  const newSnapin = await render('pages/snapins/new.ejs', pages.find(([template]) => template === 'pages/snapins/new.ejs')[1]);
  assert.match(newSnapin, /enctype="multipart\/form-data"/);
  assert.match(newSnapin, /type="file"/);
  assert.match(newSnapin, /name="installer"/);

  const modalForm = await render('pages/servers/form.ejs', {
    heading: 'Add a FOG server', description: 'Store both tokens.', action: '/servers',
    submitLabel: 'Add server', values: { name: '', baseUrl: '', timeoutMs: '10000' },
    errors: {}, formError: '', cancelHref: '/login', preAuthCsrfToken: 'setup-csrf-token', modal: true,
  });
  assert.match(modalForm, /hx-post="\/servers"/);
  assert.doesNotMatch(modalForm, /<!doctype html>/i);
});
