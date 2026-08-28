import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import {
  createResources,
  validateGroupDefinition,
  validateHostUpdate,
  validateHostActiveDirectory,
  validateInventoryMetadata,
  validatePasswordResetAccount,
  validateImageCreate,
  validateImageUpdate,
  validateSnapinDefinition,
} from '../src/fog/resources.js';

function rawHost(overrides = {}) {
  return {
    id: '7', name: 'BUILD-07', description: 'Old description', imageID: '3',
    primac: '00:11:22:33:44:55', macs: ['00:11:22:33:44:55'],
    ...overrides,
  };
}

function rawImage(overrides = {}) {
  return {
    id: '4', name: 'Windows 11', description: 'Lab image', path: 'windows-11',
    osID: '5', imageTypeID: '1', imagePartitionTypeID: '1', format: '5', compress: '6',
    protected: '0', isEnabled: '1', toReplicate: '1', storagegroupname: 'default',
    os: { id: '5', name: 'Windows 11' }, imagetype: { id: '1', name: 'Single Disk' },
    imagepartitiontype: { id: '1', name: 'Everything' }, ...overrides,
  };
}

function rawSnapin(overrides = {}) {
  return {
    id: '5', name: 'Agent', description: 'Install agent', file: 'agent.msi', args: '/qn',
    runWith: 'msiexec.exe', runWithArgs: '/i', packtype: '0', timeout: '300',
    protected: '0', isEnabled: '1', toReplicate: '1', hide: '0', reboot: '1', shutdown: '0',
    storagegroupname: 'default', ...overrides,
  };
}

test('active multicast sessions use the current endpoint and return normalized data', async () => {
  const client = {
    async get(path) {
      assert.equal(path, 'multicastsession/current');
      return {
        multicastsessions: [{
          id: '3', name: 'Lab', percent: '42', sessclients: '8',
          image: { id: '4', name: 'Windows 11' },
          state: { id: '3', name: 'In Progress' },
        }],
      };
    },
  };

  const sessions = await createResources(client).multicast.listActive();
  assert.equal(sessions.length, 1);
  assert.equal(sessions[0].progress, 42);
  assert.equal(sessions[0].clientCount, 8);
});

test('Snapin definition validation rejects paths and FOG-reserved filenames', () => {
  assert.deepEqual(validateSnapinDefinition({
    name: 'Agent', file: 'agent.msi', packageType: '0', timeoutSeconds: '300',
    storageGroupId: '1', isEnabled: true, postAction: 'reboot',
  }, { creating: true }), {
    name: 'Agent', description: '', file: 'agent.msi', arguments: '', runWith: '', runWithArguments: '',
    packageType: 0, timeoutSeconds: 300, storageGroupId: 1, isProtected: false,
    isEnabled: true, replicates: false, hidesArguments: false, postAction: 'reboot',
  });
  for (const file of ['folder/agent.msi', '../agent.msi', 'ssl-agent.msi']) {
    assert.throws(
      () => validateSnapinDefinition({ name: 'Agent', file, packageType: 0, timeoutSeconds: 0, storageGroupId: 1 }, { creating: true }),
      (error) => error.code === 'FOG_VALIDATION_ERROR' && Boolean(error.fields.file),
    );
  }
});

test('Snapin create sends a complete metadata definition and storage association', async () => {
  const posts = [];
  const client = {
    async get(path) {
      if (path === 'snapin') return { snapins: [] };
      if (path === 'storagegroup') return { storagegroups: [{ id: '1', name: 'default', ftpPass: 'discard-me' }] };
      throw new Error(`Unexpected GET ${path}`);
    },
    async post(path, body) { posts.push({ path, body }); return rawSnapin(body); },
  };
  const snapin = await createResources(client).snapins.create({
    name: 'Agent', description: 'Install agent', file: 'agent.msi', arguments: '/qn',
    runWith: 'msiexec.exe', runWithArguments: '/i', packageType: '0', timeoutSeconds: '300',
    storageGroupId: '1', isEnabled: true, replicates: true, postAction: 'reboot',
  });
  assert.equal(snapin.name, 'Agent');
  assert.equal(posts[0].path, 'snapin/create');
  assert.deepEqual(posts[0].body.storagegroups, [1]);
  assert.equal(posts[0].body.reboot, 1);
  assert.equal(posts[0].body.shutdown, 0);
  assert.equal(Object.hasOwn(posts[0].body, 'ftpPass'), false);
});

test('Snapin upload/create forwards source-verified multipart field names', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'foggy-snapin-test-'));
  const filePath = path.join(directory, 'upload');
  await fs.writeFile(filePath, 'installer bytes');
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  let observed;
  const client = {
    async get(resource) {
      if (resource === 'snapin') return { snapins: [] };
      if (resource === 'storagegroup') return { storagegroups: [{ id: '1', name: 'default' }] };
      throw new Error(`Unexpected GET ${resource}`);
    },
    async postForm(resource, form, options) {
      observed = { resource, form, options };
      return rawSnapin({ file: 'agent.msi', size: '15', hash: 'hash' });
    },
  };
  const result = await createResources(client).snapins.createWithFile({
    name: 'Agent', description: 'Install agent', arguments: '/qn', runWith: 'msiexec.exe',
    runWithArguments: '/i', packageType: 0, timeoutSeconds: 300, storageGroupId: 1,
    isEnabled: true, replicates: true, hidesArguments: true, postAction: 'reboot',
  }, { path: filePath, originalName: 'agent.msi', mimeType: 'application/octet-stream' }, { timeoutMs: 9000 });
  assert.equal(result.file, 'agent.msi');
  assert.equal(observed.resource, 'snapin/createwithfile');
  assert.equal(observed.form.get('snapin'), 'Agent');
  assert.equal(observed.form.get('storagegroup'), '1');
  assert.equal(observed.form.get('isEnabled'), '1');
  assert.equal(observed.form.get('toReplicate'), '1');
  assert.equal(observed.form.get('isHidden'), '1');
  assert.equal(observed.form.get('action'), 'reboot');
  assert.equal(observed.form.get('snapinfile').name, 'agent.msi');
  assert.equal(observed.options.timeoutMs, 9000);
});

test('Snapin update preserves associations and refuses active Snapin tasks', async () => {
  const puts = [];
  let active = false;
  const client = {
    async get(path) {
      if (path === 'snapin/5') return rawSnapin();
      if (path === 'snapin') return { snapins: [rawSnapin()] };
      if (path === 'snapintask/active') return { snapintasks: active ? [{ id: '9', snapinID: '5' }] : [] };
      throw new Error(`Unexpected GET ${path}`);
    },
    async put(path, body) { puts.push({ path, body }); return rawSnapin(body); },
  };
  const input = {
    name: 'Agent', description: 'Updated', file: 'agent.msi', arguments: '/qn', runWith: 'msiexec.exe',
    runWithArguments: '/i', packageType: 0, timeoutSeconds: 600, isEnabled: true,
    replicates: true, hidesArguments: true, postAction: 'shutdown',
  };
  await createResources(client).snapins.update(5, input);
  assert.equal(puts[0].path, 'snapin/5/edit');
  assert.equal(Object.hasOwn(puts[0].body, 'storagegroups'), false);
  assert.equal(puts[0].body.reboot, 0);
  assert.equal(puts[0].body.shutdown, 1);
  active = true;
  await assert.rejects(
    () => createResources(client).snapins.update(5, input),
    (error) => error.code === 'FOG_CONFLICT' && error.message.includes('queued or running'),
  );
  assert.equal(puts.length, 1);
});

test('host update sends only source-verified scalar fields and never MAC data', async () => {
  const calls = [];
  const client = {
    async get(path) {
      if (path === 'host/7') return rawHost();
      if (path === 'image') return { images: [{ id: '4', name: 'Windows 11' }] };
      if (path === 'task/active') return { tasks: [] };
      throw new Error(`Unexpected GET ${path}`);
    },
    async put(path, body) {
      calls.push({ path, body });
      return rawHost({ name: body.name, description: body.description, imageID: body.imageID });
    },
  };

  const updated = await createResources(client).hosts.update(7, {
    name: 'BUILD-NEW', description: 'Updated', imageId: 4,
    kernel: 'bzImage', kernelArgs: 'nvme_core.default_ps_max_latency_us=0',
    kernelDevice: '/dev/nvme0n1', init: 'init.xz', biosExit: 'sanboot', efiExit: 'refind_efi',
  });

  assert.equal(updated.name, 'BUILD-NEW');
  assert.deepEqual(calls, [{
    path: 'host/7/edit',
    body: {
      name: 'BUILD-NEW', description: 'Updated', imageID: 4,
      kernel: 'bzImage', kernelArgs: 'nvme_core.default_ps_max_latency_us=0',
      kernelDevice: '/dev/nvme0n1', init: 'init.xz', biosexit: 'sanboot', efiexit: 'refind_efi',
    },
  }]);
  assert.equal(Object.hasOwn(calls[0].body, 'macs'), false);
});

test('host update refuses image reassignment while an active task exists', async () => {
  let wrote = false;
  const client = {
    async get(path) {
      if (path === 'host/7') return rawHost();
      if (path === 'image') return { images: [{ id: '4', name: 'Windows 11' }] };
      if (path === 'task/active') return { tasks: [{ id: 2, host: rawHost(), state: {} }] };
      throw new Error(`Unexpected GET ${path}`);
    },
    async put() { wrote = true; },
  };

  await assert.rejects(
    () => createResources(client).hosts.update(7, { name: 'BUILD-07', description: '', imageId: 4 }),
    (error) => error.code === 'FOG_CONFLICT',
  );
  assert.equal(wrote, false);
});

test('host update validation matches the linked FOG hostname length', () => {
  assert.deepEqual(validateHostUpdate({ name: 'BUILD-07', description: ' Desk ', imageId: '0' }), {
    name: 'BUILD-07', description: 'Desk', imageId: 0,
    kernel: '', kernelArgs: '', kernelDevice: '', init: '', biosExit: '', efiExit: '',
  });
  assert.throws(
    () => validateHostUpdate({ name: 'HOSTNAME-IS-TOO-LONG', imageId: 0 }),
    (error) => error.code === 'FOG_VALIDATION_ERROR' && Boolean(error.fields.name),
  );
  assert.throws(
    () => validateHostUpdate({ name: 'BUILD-07', imageId: 0, biosExit: 'arbitrary-script' }),
    (error) => error.code === 'FOG_VALIDATION_ERROR' && Boolean(error.fields.biosExit),
  );
});

test('host Active Directory update sends modern-client fields and strips the returned password', async () => {
  const puts = [];
  const client = {
    async get(path) { assert.equal(path, 'host/7'); return rawHost(); },
    async put(path, body) {
      puts.push({ path, body });
      return rawHost({ ...body, id: '7', ADPass: body.ADPass, ADPassLegacy: 'legacy-secret' });
    },
  };
  const host = await createResources(client).hosts.updateActiveDirectory(7, {
    enabled: true,
    domain: 'example.test',
    organizationalUnit: 'OU=Workstations,DC=example,DC=test',
    username: 'join-account',
    password: 'correct horse battery staple',
    enforce: true,
  });
  assert.deepEqual(puts, [{
    path: 'host/7/edit',
    body: {
      useAD: 1, ADDomain: 'example.test', ADOU: 'OU=Workstations,DC=example,DC=test',
      ADUser: 'join-account', enforce: 1, ADPass: 'correct horse battery staple',
    },
  }]);
  assert.equal(host.activeDirectory.enabled, true);
  assert.equal(Object.hasOwn(host, 'ADPass'), false);
  assert.equal(Object.hasOwn(puts[0].body, 'ADPassLegacy'), false);
  assert.equal(Object.hasOwn(puts[0].body, 'productKey'), false);
});

test('host Active Directory validation rejects FOG mask placeholders and disabling omits passwords', async () => {
  assert.throws(
    () => validateHostActiveDirectory({
      enabled: true, domain: 'example.test', username: 'join', password: '*'.repeat(32),
    }),
    (error) => error.code === 'FOG_VALIDATION_ERROR' && Boolean(error.fields.password),
  );
  const puts = [];
  const client = {
    async get() { return rawHost(); },
    async put(path, body) { puts.push(body); return rawHost({ ...body }); },
  };
  await createResources(client).hosts.updateActiveDirectory(7, {
    enabled: false, domain: '', organizationalUnit: '', username: '', password: '', enforce: false,
  });
  assert.equal(puts[0].useAD, 0);
  assert.equal(Object.hasOwn(puts[0], 'ADPass'), false);
});

test('Active Directory defaults expose only non-secret values and resolve the password server-side', async () => {
  const puts = [];
  const settings = {
    services: [
      { name: 'FOG_AD_DEFAULT_DOMAINNAME', value: 'example.test' },
      { name: 'FOG_AD_DEFAULT_OU', value: 'OU=Other,DC=example,DC=test|;OU=Default,DC=example,DC=test;' },
      { name: 'FOG_AD_DEFAULT_USER', value: 'fog-join' },
      { name: 'FOG_AD_DEFAULT_PASSWORD', value: 'server-side-secret' },
      { name: 'UNRELATED_SECRET', value: 'must-not-leak' },
    ],
  };
  const client = {
    async get(path) {
      if (path === 'service/search/FOG_AD_DEFAULT_') return settings;
      if (path === 'host/7') return rawHost();
      throw new Error(`Unexpected GET ${path}`);
    },
    async put(path, body) { puts.push({ path, body }); return rawHost({ ...body }); },
  };
  const resources = createResources(client);
  const defaults = await resources.hosts.activeDirectoryDefaults();
  assert.deepEqual(defaults, {
    domain: 'example.test',
    organizationalUnit: 'OU=Default,DC=example,DC=test',
    username: 'fog-join',
    hasPassword: true,
  });
  assert.equal(Object.hasOwn(defaults, 'password'), false);
  assert.doesNotMatch(JSON.stringify(defaults), /server-side-secret|must-not-leak/);

  await resources.hosts.updateActiveDirectory(7, {
    enabled: true, domain: defaults.domain, organizationalUnit: defaults.organizationalUnit,
    username: defaults.username, password: '', useDefaultPassword: true, enforce: false,
  });
  assert.equal(puts[0].body.ADPass, 'server-side-secret');
  assert.equal(Object.hasOwn(puts[0].body, 'ADPassLegacy'), false);
});

test('inventory metadata update changes only the three legacy-editable fields', async () => {
  const puts = [];
  const client = {
    async get(path) {
      assert.equal(path, 'host/7');
      return rawHost({ inventory: { id: '12', hostID: '7', primaryUser: 'Old user', other1: 'OLD' } });
    },
    async put(path, body) {
      puts.push({ path, body });
      return { id: '12', hostID: '7', ...body };
    },
  };
  const inventory = await createResources(client).inventory.updateForHost(7, {
    primaryUser: ' Lab Tech ', assetTag: ' PC-007 ', alternateTag: ' West ',
  });
  assert.equal(inventory.primaryUser, 'Lab Tech');
  assert.deepEqual(puts, [{
    path: 'inventory/12/edit',
    body: { primaryUser: 'Lab Tech', other1: 'PC-007', other2: 'West' },
  }]);
  assert.equal(Object.hasOwn(puts[0].body, 'sysserial'), false);
});

test('inventory metadata validation follows the FOG 50-character columns', () => {
  assert.deepEqual(validateInventoryMetadata({ primaryUser: ' Tech ', assetTag: '', alternateTag: '' }), {
    primaryUser: 'Tech', assetTag: '', alternateTag: '',
  });
  assert.throws(
    () => validateInventoryMetadata({ primaryUser: 'x'.repeat(51) }),
    (error) => error.code === 'FOG_VALIDATION_ERROR' && Boolean(error.fields.primaryUser),
  );
});

test('inventory metadata update refuses hosts without a collected inventory row', async () => {
  let wrote = false;
  const client = {
    async get() { return rawHost({ inventory: {} }); },
    async put() { wrote = true; },
  };
  await assert.rejects(
    () => createResources(client).inventory.updateForHost(7, { primaryUser: 'Tech' }),
    (error) => error.code === 'FOG_CONFLICT' && error.message.includes('Collect hardware inventory'),
  );
  assert.equal(wrote, false);
});

test('host relationships join association resources without leaking raw records', async () => {
  const responses = {
    group: { groups: [{ id: '2', name: 'Lab', hostcount: '4' }, { id: '3', name: 'Office' }] },
    groupassociation: { groupassociations: [{ id: '9', hostID: '7', groupID: '2' }, { id: '10', hostID: '8', groupID: '3' }] },
    snapin: { snapins: [{ id: '5', name: 'Agent', isEnabled: '1', file: 'agent.exe' }] },
    snapinassociation: { snapinassociations: [{ id: '1', hostID: '7', snapinID: '5' }] },
    module: { modules: [{ id: '1', name: 'Display Manager', shortName: 'displaymanager' }] },
    moduleassociation: { moduleassociations: [{ id: '11', hostID: '7', moduleID: '1', state: '1' }] },
  };
  const client = { async get(path) { return responses[path]; } };
  const fog = createResources(client);

  assert.deepEqual(await fog.groups.forHost(7), [{
    id: 2, name: 'Lab', description: '', hostCount: 4, building: '', createdAt: '', createdBy: '',
  }]);
  assert.equal((await fog.snapins.forHost(7))[0].name, 'Agent');
  assert.deepEqual((await fog.clientServices.forHost(7)).map((service) => [service.name, service.isEnabled]), [
    ['Display Manager', true],
  ]);
});

test('host Snapin assignment replacement validates and verifies the final set', async () => {
  let updated = false;
  const puts = [];
  const client = {
    async get(path) {
      if (path === 'host/7') return rawHost();
      if (path === 'snapin') return { snapins: [
        { id: '5', name: 'Agent', isEnabled: '1' },
        { id: '6', name: 'Inventory', isEnabled: '1' },
      ] };
      if (path === 'snapinassociation') return {
        snapinassociations: updated
          ? [{ id: '2', hostID: '7', snapinID: '6' }]
          : [{ id: '1', hostID: '7', snapinID: '5' }],
      };
      throw new Error(`Unexpected GET ${path}`);
    },
    async put(path, body) { puts.push({ path, body }); updated = true; return rawHost(); },
  };

  const result = await createResources(client).snapins.updateAssignmentsForHost(7, ['6']);
  assert.deepEqual(puts, [{ path: 'host/7/edit', body: { snapins: [6] } }]);
  assert.deepEqual(result.added, [6]);
  assert.deepEqual(result.removed, [5]);
  assert.deepEqual(result.assignedIds, [6]);
  assert.equal(Object.hasOwn(puts[0].body, 'macs'), false);
  assert.equal(Object.hasOwn(puts[0].body, 'printers'), false);
});

test('printer configuration replaces assignments, management level, and default with verification', async () => {
  const puts = [];
  let managementLevel = 1;
  let associations = [{ id: '20', hostID: '7', printerID: '4', isDefault: '1' }];
  const client = {
    async get(path) {
      if (path === 'host/7') return rawHost({ printerLevel: String(managementLevel) });
      if (path === 'printer') return { printers: [
        { id: '4', name: 'Old Default', model: 'Model A' },
        { id: '5', name: 'Lab Printer', model: 'Model B' },
      ] };
      if (path === 'printerassociation') return { printerassociations: associations.map((item) => ({ ...item })) };
      throw new Error(`Unexpected GET ${path}`);
    },
    async put(path, body) {
      puts.push({ path, body });
      if (path === 'host/7/edit') {
        managementLevel = body.printerLevel;
        associations = [
          associations[0],
          { id: '21', hostID: '7', printerID: '5', isDefault: '0' },
        ];
        return rawHost({ printerLevel: String(managementLevel) });
      }
      const association = associations.find((item) => path === `printerassociation/${item.id}/edit`);
      association.isDefault = String(body.isDefault);
      return association;
    },
  };

  const result = await createResources(client).printers.updateAssignmentsForHost(7, {
    printerIds: ['4', '5'], managementLevel: '2', defaultId: '5',
  });
  assert.equal(result.defaultId, 5);
  assert.deepEqual(result.added, [5]);
  assert.deepEqual(puts, [
    { path: 'host/7/edit', body: { printers: [4, 5], printerLevel: 2 } },
    { path: 'printerassociation/20/edit', body: { isDefault: 0 } },
    { path: 'printerassociation/21/edit', body: { isDefault: 1 } },
  ]);
});

test('printer configuration requires the default printer to be assigned', async () => {
  let read = false;
  const client = { async get() { read = true; } };
  await assert.rejects(
    () => createResources(client).printers.updateAssignmentsForHost(7, {
      printerIds: [4], managementLevel: 1, defaultId: 5,
    }),
    (error) => error.code === 'FOG_VALIDATION_ERROR' && Boolean(error.fields.defaultId),
  );
  assert.equal(read, false);
});

test('client module update uses narrow global settings and preserves globally unavailable assignments', async () => {
  const puts = [];
  let updated = false;
  const globalPath = 'service/ids/name%3DFOG_CLIENT_PRINTERMANAGER_ENABLED%2CFOG_CLIENT_USERTRACKER_ENABLED/value';
  const client = {
    async get(path) {
      if (path === 'module') return { modules: [
        { id: '10', name: 'Printer Manager', shortName: 'printermanager', description: 'Printers' },
        { id: '12', name: 'User Tracker', shortName: 'usertracker', description: 'Logins' },
      ] };
      if (path === 'moduleassociation') return { moduleassociations: updated
        ? [{ id: '1', hostID: '7', moduleID: '10', state: '1' }, { id: '2', hostID: '7', moduleID: '12', state: '1' }]
        : [{ id: '2', hostID: '7', moduleID: '12', state: '1' }] };
      if (path === globalPath) return ['1', '0'];
      throw new Error(`Unexpected GET ${path}`);
    },
    async put(path, body) {
      puts.push({ path, body });
      updated = true;
      return rawHost();
    },
  };

  const result = await createResources(client).clientServices.updateForHost(7, [10]);
  assert.deepEqual(result.added, [10]);
  assert.deepEqual(result.removed, []);
  assert.deepEqual(puts, [{ path: 'host/7/edit', body: { modules: [10, 12] } }]);
});

test('client module update refuses to enable a globally disabled module', async () => {
  let wrote = false;
  const client = {
    async get(path) {
      if (path === 'module') return { modules: [{ id: '12', name: 'User Tracker', shortName: 'usertracker' }] };
      if (path === 'moduleassociation') return { moduleassociations: [] };
      if (path === 'service/ids/name%3DFOG_CLIENT_USERTRACKER_ENABLED/value') return ['0'];
      throw new Error(`Unexpected GET ${path}`);
    },
    async put() { wrote = true; },
  };
  await assert.rejects(
    () => createResources(client).clientServices.updateForHost(7, [12]),
    (error) => error.code === 'FOG_VALIDATION_ERROR' && error.message.includes('Globally disabled'),
  );
  assert.equal(wrote, false);
});

test('client module status falls back to an exact allowlist when filtered ids are broken', async () => {
  const paths = [];
  const client = {
    async get(path) {
      paths.push(path);
      if (path === 'module') return { modules: [{ id: '12', name: 'User Tracker', shortName: 'usertracker' }] };
      if (path === 'moduleassociation') return { moduleassociations: [{ id: '1', hostID: '7', moduleID: '12', state: '1' }] };
      if (path.includes('/ids/')) throw Object.assign(new Error('Broken filter route'), { status: 500 });
      if (path === 'service/search/FOG_CLIENT_') return { services: [
        { id: '1', name: 'FOG_CLIENT_USERTRACKER_ENABLED', value: '1' },
        { id: '2', name: 'FOG_CLIENT_CHECKIN_TIME', value: 'sensitive-unrelated-value' },
      ] };
      throw new Error(`Unexpected GET ${path}`);
    },
  };
  const configuration = await createResources(client).clientServices.configurationForHost(7);
  assert.equal(configuration.globalStatusAvailable, true);
  assert.equal(configuration.all[0].globallyEnabled, true);
  assert.equal(configuration.all[0].isEnabled, true);
  assert.equal(paths.includes('service/search/FOG_CLIENT_'), true);
  assert.equal(Object.hasOwn(configuration.all[0], 'value'), false);
});

test('host Snapin assignment replacement rejects missing Snapins before writing', async () => {
  let wrote = false;
  const client = {
    async get(path) {
      if (path === 'host/7') return rawHost();
      if (path === 'snapin') return { snapins: [{ id: '5', name: 'Agent' }] };
      if (path === 'snapinassociation') return { snapinassociations: [] };
      throw new Error(`Unexpected GET ${path}`);
    },
    async put() { wrote = true; },
  };
  await assert.rejects(
    () => createResources(client).snapins.updateAssignmentsForHost(7, ['99']),
    (error) => error.code === 'FOG_VALIDATION_ERROR' && error.fields.snapins.includes('99'),
  );
  assert.equal(wrote, false);
});

test('group members are joined from host and association resources', async () => {
  const client = {
    async get(path) {
      if (path === 'host') return { hosts: [rawHost(), rawHost({ id: '8', name: 'OTHER' })] };
      if (path === 'groupassociation') return { groupassociations: [
        { id: '1', hostID: '7', groupID: '2' }, { id: '2', hostID: '8', groupID: '3' },
      ] };
      throw new Error(`Unexpected GET ${path}`);
    },
  };

  const members = await createResources(client).groups.members(2);
  assert.deepEqual(members.map((host) => host.name), ['BUILD-07']);
});

test('group membership update validates hosts and verifies the final association set', async () => {
  let updated = false;
  const puts = [];
  const client = {
    async get(path) {
      if (path === 'group/2') return { id: '2', name: 'Lab', description: 'Room 4' };
      if (path === 'host') return { hosts: [rawHost(), rawHost({ id: '8', name: 'OTHER' })] };
      if (path === 'groupassociation') return {
        groupassociations: updated
          ? [{ id: '1', hostID: '8', groupID: '2' }]
          : [{ id: '1', hostID: '7', groupID: '2' }],
      };
      throw new Error(`Unexpected GET ${path}`);
    },
    async put(path, body) { puts.push({ path, body }); updated = true; return { id: '2', name: 'Lab' }; },
  };

  const result = await createResources(client).groups.updateMembers(2, ['8']);
  assert.deepEqual(result.added, [8]);
  assert.deepEqual(result.removed, [7]);
  assert.deepEqual(puts, [{
    path: 'group/2/edit',
    body: { name: 'Lab', description: 'Room 4', hosts: [8], imageID: 0 },
  }]);
});

test('group definitions can be created and renamed without changing membership', async () => {
  const posts = [];
  const puts = [];
  const client = {
    async get(path) {
      if (path === 'group') return { groups: [{ id: '2', name: 'Existing' }] };
      if (path === 'group/3') return { id: '3', name: 'New Lab', description: 'Room 2', hostcount: '4' };
      throw new Error(`Unexpected GET ${path}`);
    },
    async post(path, body) {
      posts.push({ path, body });
      return { id: '3', ...body, hostcount: '0' };
    },
    async put(path, body) {
      puts.push({ path, body });
      return { id: '3', name: body.name, description: body.description, hostcount: '4' };
    },
  };
  const groups = createResources(client).groups;
  const created = await groups.create({ name: 'New Lab', description: 'Room 2' });
  const updated = await groups.update(3, { name: 'Renamed Lab', description: 'Room 3' });

  assert.equal(created.id, 3);
  assert.deepEqual(posts, [{ path: 'group/create', body: { name: 'New Lab', description: 'Room 2' } }]);
  assert.deepEqual(puts, [{
    path: 'group/3/edit',
    body: { name: 'Renamed Lab', description: 'Room 3', imageID: 0 },
  }]);
  assert.equal(Object.hasOwn(puts[0].body, 'hosts'), false);
  assert.equal(updated.hostCount, 4);
});

test('group deletion preserves hosts and verifies group plus membership removal', async () => {
  let deleted = false;
  const deletes = [];
  const client = {
    async get(path) {
      if (path === 'group/2') return { id: '2', name: 'Lab', description: '', hostcount: '1' };
      if (path === 'host') return { hosts: [rawHost()] };
      if (path === 'group') return { groups: deleted ? [] : [{ id: '2', name: 'Lab' }] };
      if (path === 'groupassociation') return {
        groupassociations: deleted ? [] : [{ id: '1', hostID: '7', groupID: '2' }],
      };
      throw new Error(`Unexpected GET ${path}`);
    },
    async delete(path) { deletes.push(path); deleted = true; return null; },
  };
  const result = await createResources(client).groups.remove(2);
  assert.deepEqual(deletes, ['group/2']);
  assert.deepEqual(result.detachedHostIds, [7]);
  assert.equal(result.group.name, 'Lab');
});

test('group validation follows the source-backed name requirement and length', () => {
  assert.deepEqual(validateGroupDefinition({ name: ' Lab ', description: ' Room 2 ' }), {
    name: 'Lab', description: 'Room 2',
  });
  assert.throws(() => validateGroupDefinition({ name: '' }), (error) => Boolean(error.fields.name));
  assert.throws(() => validateGroupDefinition({ name: 'x'.repeat(51) }), (error) => Boolean(error.fields.name));
});

test('host history filters by host and current MACs and joins Snapin tasks to jobs', async () => {
  const responses = {
    usertracking: { usertrackings: [
      { id: '1', hostID: '7', username: 'alice', action: '1', datetime: '2026-08-27 08:00:00', host: { ADPass: 'secret' } },
      { id: '2', hostID: '8', username: 'other', action: '1' },
    ] },
    imaginglog: { imaginglogs: [{ id: '3', hostID: '7', image: 'Windows', start: '2026-08-26 09:00:00', host: { productKey: 'secret' } }] },
    snapinjob: { snapinjobs: [{ id: '4', hostID: '7', createdTime: '2026-08-25 10:00:00', state: { id: '4', name: 'Complete' } }] },
    snapintask: { snapintasks: [
      { id: '5', jobID: '4', snapin: { id: '2', name: 'Agent' }, return: '0', complete: '2026-08-25 10:01:00' },
      { id: '6', jobID: '99', snapin: { id: '3', name: 'Other' } },
    ] },
    virus: { viruss: [
      { id: '7', mac: '00-11-22-33-44-55', name: 'Test', file: 'sample.txt', date: '2026-08-24 10:00:00' },
      { id: '8', mac: 'aa:bb:cc:dd:ee:ff', name: 'Other' },
    ] },
  };
  const client = { async get(path) { return responses[path]; } };
  const history = await createResources(client).history.forHost({
    id: 7, macs: ['00:11:22:33:44:55'],
  });

  assert.equal(history.logins.length, 1);
  assert.equal(history.imaging.length, 1);
  assert.equal(history.snapinTasks.length, 1);
  assert.equal(history.snapinTasks[0].snapin.name, 'Agent');
  assert.equal(history.viruses.length, 1);
  assert.equal(Object.hasOwn(history.logins[0], 'host'), false);
});

test('deploy command uses source-verified task fields and honors no-Snapin mode', async () => {
  const posts = [];
  const client = {
    async get(path) {
      if (path === 'host/7') return rawHost();
      if (path === 'image') return { images: [{ id: '3', name: 'Windows 11', isEnabled: '1', protected: '0' }] };
      if (path === 'task/active') return { tasks: [] };
      throw new Error(`Unexpected GET ${path}`);
    },
    async post(path, body) { posts.push({ path, body }); return null; },
  };

  const result = await createResources(client).tasks.createForHost(7, 'deploy', {
    includeSnapins: false, wake: true, shutdown: false,
  });

  assert.equal(result.taskTypeId, 17);
  assert.deepEqual(posts, [{
    path: 'host/7/task',
    body: { taskTypeID: 17, taskName: 'Foggy Deploy', shutdown: false, wol: true },
  }]);
});

test('capture command refuses protected images before writing', async () => {
  let wrote = false;
  const client = {
    async get(path) {
      if (path === 'host/7') return rawHost();
      if (path === 'image') return { images: [{ id: '3', name: 'Golden', isEnabled: '1', protected: '1' }] };
      if (path === 'task/active') return { tasks: [] };
      throw new Error(`Unexpected GET ${path}`);
    },
    async post() { wrote = true; },
  };

  await assert.rejects(
    () => createResources(client).tasks.createForHost(7, 'capture'),
    (error) => error.code === 'FOG_CONFLICT' && error.message.includes('protected'),
  );
  assert.equal(wrote, false);
});

test('hardware inventory task does not require an assigned image', async () => {
  const gets = [];
  const posts = [];
  const client = {
    async get(path) {
      gets.push(path);
      if (path === 'host/7') return rawHost({ imageID: '0' });
      if (path === 'task/active') return { tasks: [] };
      if (path === 'tasktype') return { tasktypes: [{ id: '10', name: 'Hardware Inventory' }] };
      throw new Error(`Unexpected GET ${path}`);
    },
    async post(path, body) { posts.push({ path, body }); return null; },
  };
  const result = await createResources(client).tasks.createForHost(7, 'inventory', { wake: true });
  assert.equal(result.taskTypeId, 10);
  assert.equal(gets.includes('image'), false);
  assert.deepEqual(posts, [{
    path: 'host/7/task',
    body: { taskTypeID: 10, taskName: 'Foggy Hardware Inventory', wol: true },
  }]);
});

test('FOS debug task sets the source-verified debug flag', async () => {
  const posts = [];
  const client = {
    async get(path) {
      if (path === 'host/7') return rawHost({ imageID: '0' });
      if (path === 'task/active') return { tasks: [] };
      if (path === 'tasktype') return { tasktypes: [{ id: '3', name: 'Debug' }] };
      throw new Error(`Unexpected GET ${path}`);
    },
    async post(path, body) { posts.push({ path, body }); return null; },
  };
  await createResources(client).tasks.createForHost(7, 'debug', { wake: false });
  assert.deepEqual(posts[0], {
    path: 'host/7/task',
    body: { taskTypeID: 3, taskName: 'Foggy FOS Debug', wol: false, debug: true },
  });
});

test('password reset task passes only a validated local account to FOG', async () => {
  const posts = [];
  const client = {
    async get(path) {
      if (path === 'host/7') return rawHost({ imageID: '0' });
      if (path === 'task/active') return { tasks: [] };
      if (path === 'tasktype') return { tasktypes: [{ id: '11', name: 'Password Reset' }] };
      throw new Error(`Unexpected GET ${path}`);
    },
    async post(path, body) { posts.push({ path, body }); return null; },
  };
  await createResources(client).tasks.createForHost(7, 'password-reset', {
    account: 'Administrator', wake: true,
  });
  assert.deepEqual(posts[0], {
    path: 'host/7/task',
    body: { taskTypeID: 11, taskName: 'Foggy Password Reset', wol: true, passreset: 'Administrator' },
  });
});

test('password reset account validation blocks kernel argument injection before API reads', async () => {
  let read = false;
  const client = { async get() { read = true; } };
  assert.equal(validatePasswordResetAccount(' local_admin '), 'local_admin');
  await assert.rejects(
    () => createResources(client).tasks.createForHost(7, 'password-reset', {
      account: 'Administrator init=/bin/sh',
    }),
    (error) => error.code === 'FOG_VALIDATION_ERROR' && Boolean(error.fields.account),
  );
  assert.equal(read, false);
});

test('normal disk wipe requires exact hostname confirmation and uses only type 19', async () => {
  const posts = [];
  const client = {
    async get(path) {
      if (path === 'host/7') return rawHost({ imageID: '0' });
      if (path === 'task/active') return { tasks: [] };
      if (path === 'tasktype') return { tasktypes: [{ id: '19', name: 'Normal Wipe' }] };
      throw new Error(`Unexpected GET ${path}`);
    },
    async post(path, body) { posts.push({ path, body }); return null; },
  };
  const result = await createResources(client).tasks.createForHost(7, 'wipe', {
    wipeMode: 'normal', targetConfirmation: 'BUILD-07', wake: true,
  });
  assert.equal(result.taskTypeId, 19);
  assert.deepEqual(posts, [{
    path: 'host/7/task',
    body: { taskTypeID: 19, taskName: 'Foggy Normal Wipe', wol: true },
  }]);
});

test('disk wipe refuses an incorrect hostname without creating a task', async () => {
  let wrote = false;
  const client = {
    async get(path) {
      if (path === 'host/7') return rawHost();
      if (path === 'task/active') return { tasks: [] };
      if (path === 'tasktype') return { tasktypes: [{ id: '18', name: 'Fast Wipe' }] };
      throw new Error(`Unexpected GET ${path}`);
    },
    async post() { wrote = true; },
  };
  await assert.rejects(
    () => createResources(client).tasks.createForHost(7, 'wipe', {
      wipeMode: 'fast', targetConfirmation: 'BUILD-08',
    }),
    (error) => error.code === 'FOG_VALIDATION_ERROR' && Boolean(error.fields.targetConfirmation),
  );
  assert.equal(wrote, false);
});

test('host task cancellation preflights active state and uses the host cancel route', async () => {
  const deletes = [];
  const client = {
    async get(path) {
      assert.equal(path, 'task/active');
      return { tasks: [{ id: '12', host: rawHost(), state: { id: '1', name: 'Queued' } }] };
    },
    async delete(path) { deletes.push(path); return null; },
  };

  const result = await createResources(client).tasks.cancelForHost(7);
  assert.deepEqual(result.cancelledTaskIds, [12]);
  assert.deepEqual(deletes, ['host/7/cancel']);
});

test('bulk deployment reports active skips and task failures after assignment changes', async () => {
  const puts = [];
  const posts = [];
  const client = {
    async get(path) {
      if (path === 'host') return { hosts: [rawHost(), rawHost({ id: '8', name: 'BUSY', imageID: '4' })] };
      if (path === 'image') return { images: [{ id: '4', name: 'Windows 11', isEnabled: '1' }] };
      if (path === 'task/active') return { tasks: [{ id: '20', host: rawHost({ id: '8', name: 'BUSY' }), state: { id: '1', name: 'Queued' } }] };
      throw new Error(`Unexpected GET ${path}`);
    },
    async put(path, body) { puts.push({ path, body }); return rawHost({ imageID: body.imageID }); },
    async post(path, body) { posts.push({ path, body }); throw Object.assign(new Error('Rejected'), { code: 'FOG_HTTP_ERROR' }); },
  };

  const result = await createResources(client).deployments.create({
    hostIds: ['7', '8'], imageId: '4', includeSnapins: true, wake: true,
  });

  assert.equal(result.queued, 0);
  assert.equal(result.failed, 2);
  assert.equal(result.outcomes[0].status, 'failed');
  assert.equal(result.outcomes[0].stage, 'task-creation');
  assert.equal(result.outcomes[0].imageChanged, true);
  assert.equal(result.outcomes[1].status, 'skipped');
  assert.deepEqual(puts[0], {
    path: 'host/7/edit',
    body: { name: 'BUILD-07', description: 'Old description', imageID: 4 },
  });
  assert.equal(posts[0].body.taskTypeID, 1);
  assert.equal(posts[0].body.deploySnapins, true);
});

test('single Snapin execution validates assignment and uses task type 13', async () => {
  const posts = [];
  const client = {
    async get(path) {
      if (path === 'host/7') return rawHost();
      if (path === 'snapin') return { snapins: [{ id: '5', name: 'Agent', file: 'agent.exe', isEnabled: '1' }] };
      if (path === 'snapinassociation') return { snapinassociations: [{ id: '1', hostID: '7', snapinID: '5' }] };
      if (path === 'task/active') return { tasks: [] };
      throw new Error(`Unexpected GET ${path}`);
    },
    async post(path, body) { posts.push({ path, body }); return null; },
  };

  const result = await createResources(client).tasks.runSnapins(7, '5');
  assert.equal(result.taskTypeId, 13);
  assert.deepEqual(result.snapinNames, ['Agent']);
  assert.deepEqual(posts, [{
    path: 'host/7/task',
    body: { taskTypeID: 13, taskName: 'Foggy Single Snapin', deploySnapins: 5 },
  }]);
});

test('guided capture reports task failure after a successful image reassignment', async () => {
  const puts = [];
  const client = {
    async get(path) {
      if (path === 'host/7') return rawHost();
      if (path === 'image') return { images: [{ id: '4', name: 'Captured Workstation', isEnabled: '1', protected: '0' }] };
      if (path === 'task/active') return { tasks: [] };
      throw new Error(`Unexpected GET ${path}`);
    },
    async put(path, body) { puts.push({ path, body }); return rawHost({ imageID: body.imageID }); },
    async post() { throw new Error('Task rejected'); },
  };

  const result = await createResources(client).captures.create({ hostId: '7', imageId: '4', wake: true });
  assert.equal(result.status, 'failed');
  assert.equal(result.stage, 'task-creation');
  assert.equal(result.imageChanged, true);
  assert.equal(result.message.includes('assignment changed'), true);
  assert.equal(puts.length, 1);
});

test('image definition creation validates lookups and sends the complete source-backed payload', async () => {
  const posts = [];
  const responses = {
    image: { images: [] },
    os: { oss: [{ id: '1', name: 'Windows' }] },
    imagetype: { imagetypes: [{ id: '1', name: 'Single Disk', type: 'n' }] },
    imagepartitiontype: { imagepartitiontypes: [{ id: '1', name: 'Everything', type: 'all' }] },
    storagegroup: { storagegroups: [{ id: '1', name: 'default', enablednodes: ['1'] }] },
  };
  const client = {
    async get(path) { return responses[path]; },
    async post(path, body) {
      posts.push({ path, body });
      return { id: '9', ...body, imagename: body.name, storagegroupname: 'default', isEnabled: '1' };
    },
  };
  const image = await createResources(client).images.create({
    name: 'Lab Windows', description: 'Captured lab image', path: 'lab/windows-11',
    osId: '1', imageTypeId: '1', partitionTypeId: '1', storageGroupId: '1',
    compression: '6', format: '5', replicates: true,
  });

  assert.equal(image.id, 9);
  assert.deepEqual(posts, [{
    path: 'image/create',
    body: {
      name: 'Lab Windows', description: 'Captured lab image', path: 'lab/windows-11',
      osID: 1, imageTypeID: 1, imagePartitionTypeID: 1, storagegroups: [1],
      compress: 6, format: 5, isEnabled: 1, toReplicate: 1,
    },
  }]);
});

test('image definition validation blocks reserved and parent-traversal paths', () => {
  const base = { name: 'Image', osId: 1, imageTypeId: 1, partitionTypeId: 1, storageGroupId: 1, compression: 6, format: 5 };
  assert.throws(() => validateImageCreate({ ...base, path: 'dev' }), (error) => Boolean(error.fields.path));
  assert.throws(() => validateImageCreate({ ...base, path: '../outside' }), (error) => Boolean(error.fields.path));
});

test('image definition update validates and sends only source-backed scalar fields', async () => {
  const puts = [];
  const responses = {
    'image/4': rawImage(),
    image: { images: [rawImage()] },
    os: { oss: [{ id: '5', name: 'Windows 11' }] },
    imagetype: { imagetypes: [{ id: '1', name: 'Single Disk' }] },
    imagepartitiontype: { imagepartitiontypes: [{ id: '1', name: 'Everything' }] },
    'task/active': { tasks: [] },
  };
  const client = {
    async get(path) { return responses[path]; },
    async put(path, body) { puts.push({ path, body }); return rawImage(body); },
  };

  const image = await createResources(client).images.update(4, {
    name: 'Windows 11 24H2', description: 'Updated', path: 'windows-11-24h2',
    osId: '5', imageTypeId: '1', partitionTypeId: '1', format: '5', compression: '9',
    isProtected: true, isEnabled: true, replicates: false,
  });

  assert.equal(image.name, 'Windows 11 24H2');
  assert.deepEqual(puts, [{
    path: 'image/4/edit',
    body: {
      name: 'Windows 11 24H2', description: 'Updated', path: 'windows-11-24h2',
      osID: 5, imageTypeID: 1, imagePartitionTypeID: 1, format: 5,
      protected: 1, compress: 9, isEnabled: 1, toReplicate: 0,
    },
  }]);
  assert.equal(Object.hasOwn(puts[0].body, 'storagegroups'), false);
  assert.equal(Object.hasOwn(puts[0].body, 'hosts'), false);
});

test('image editing is refused while the image has an active task', async () => {
  let wrote = false;
  const client = {
    async get(path) {
      if (path === 'image/4') return rawImage();
      if (path === 'image') return { images: [rawImage()] };
      if (path === 'os') return { oss: [{ id: '5', name: 'Windows 11' }] };
      if (path === 'imagetype') return { imagetypes: [{ id: '1', name: 'Single Disk' }] };
      if (path === 'imagepartitiontype') return { imagepartitiontypes: [{ id: '1', name: 'Everything' }] };
      if (path === 'task/active') return { tasks: [{ id: 2, image: rawImage(), state: { id: 3, name: 'In Progress' } }] };
      throw new Error(`Unexpected GET ${path}`);
    },
    async put() { wrote = true; },
  };
  await assert.rejects(
    () => createResources(client).images.update(4, {
      name: 'Windows 11', path: 'windows-11', osId: 5, imageTypeId: 1,
      partitionTypeId: 1, format: 5, compression: 6, isEnabled: true,
    }),
    (error) => error.code === 'FOG_CONFLICT' && error.message.includes('active task'),
  );
  assert.equal(wrote, false);
});

test('image update validation rejects invalid definition fields', () => {
  assert.throws(
    () => validateImageUpdate({ name: '', path: '../outside', osId: 0, imageTypeId: 1, partitionTypeId: 1, format: 7, compression: 23 }),
    (error) => error.code === 'FOG_VALIDATION_ERROR' && Boolean(error.fields.name) && Boolean(error.fields.path),
  );
});
