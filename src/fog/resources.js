import { openAsBlob } from 'node:fs';
import {
  normalizeCollection,
  normalizeClientModule,
  normalizeGroup,
  normalizeHost,
  normalizeImage,
  normalizeInventory,
  normalizeImagingLog,
  normalizeLoginEvent,
  normalizeLookup,
  normalizeMulticastSession,
  normalizePowerSchedule,
  normalizePrinter,
  normalizeSnapin,
  normalizeSnapinJob,
  normalizeSnapinTask,
  normalizeStorageGroup,
  normalizeTask,
  normalizeVirusEvent,
} from './normalizers.js';
import { FogConflictError, FogValidationError } from './errors.js';

function assertPositiveId(id, label) {
  const parsed = Number(id);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new TypeError(`${label} id must be a positive integer`);
  }
  return parsed;
}

function searchPath(resource, term) {
  const value = String(term || '').trim();
  return value ? `${resource}/search/${encodeURIComponent(value)}` : resource;
}

function getJson(client, path) {
  return client.get(path, { responseType: 'json' });
}

function rawCollection(payload, key) {
  return Array.isArray(payload?.[key]) ? payload[key] : [];
}

function sameId(left, right) {
  return Number(left) === Number(right);
}

function newestFirst(values, field) {
  return values.sort((left, right) => {
    const leftTime = Date.parse(left[field]) || 0;
    const rightTime = Date.parse(right[field]) || 0;
    return rightTime - leftTime || (right.id ?? 0) - (left.id ?? 0);
  });
}

function canonicalMac(value) {
  return String(value || '').toLowerCase().replace(/[^a-f0-9]/g, '');
}

function positiveIdList(values, label) {
  const input = Array.isArray(values) ? values : [values];
  const parsed = [];
  for (const value of input) {
    if (value === '' || value === null || value === undefined) continue;
    const id = Number(value);
    if (!Number.isInteger(id) || id <= 0) {
      throw new FogValidationError(`Check the selected ${label}.`, {
        [label]: `Invalid ${label} identifier.`,
      });
    }
    parsed.push(id);
  }
  return [...new Set(parsed)];
}

const HOST_TASK_TYPES = Object.freeze({
  deploy: 1,
  capture: 2,
  debug: 3,
  memtest: 4,
  'disk-test': 5,
  'surface-test': 6,
  inventory: 10,
  'password-reset': 11,
  wake: 14,
  deployWithoutSnapins: 17,
});
const DIAGNOSTIC_TASK_ACTIONS = new Set(['debug', 'memtest', 'disk-test', 'surface-test', 'inventory', 'password-reset']);
const WIPE_TASK_TYPES = Object.freeze({ fast: 18, normal: 19, full: 20 });
const HOST_TASK_NAMES = Object.freeze({
  deploy: 'Deploy',
  capture: 'Capture',
  debug: 'FOS Debug',
  memtest: 'Memory Test',
  'disk-test': 'Test Disk',
  'surface-test': 'Disk Surface Test',
  inventory: 'Hardware Inventory',
  'password-reset': 'Password Reset',
  wake: 'Wake',
});

const MODULE_GLOBAL_SETTINGS = Object.freeze({
  autologout: 'FOG_CLIENT_AUTOLOGOFF_ENABLED',
  clientupdater: 'FOG_CLIENT_CLIENTUPDATER_ENABLED',
  dircleanup: 'FOG_CLIENT_DIRECTORYCLEANER_ENABLED',
  displaymanager: 'FOG_CLIENT_DISPLAYMANAGER_ENABLED',
  greenfog: 'FOG_CLIENT_GREENFOG_ENABLED',
  hostnamechanger: 'FOG_CLIENT_HOSTNAMECHANGER_ENABLED',
  hostregister: 'FOG_CLIENT_HOSTREGISTER_ENABLED',
  powermanagement: 'FOG_CLIENT_POWERMANAGEMENT_ENABLED',
  printermanager: 'FOG_CLIENT_PRINTERMANAGER_ENABLED',
  snapin: 'FOG_CLIENT_SNAPIN_ENABLED',
  snapinclient: 'FOG_CLIENT_SNAPIN_ENABLED',
  taskreboot: 'FOG_CLIENT_TASKREBOOT_ENABLED',
  usercleanup: 'FOG_CLIENT_USERCLEANUP_ENABLED',
  usertracker: 'FOG_CLIENT_USERTRACKER_ENABLED',
});
const moduleStatusStrategies = new WeakMap();
const AD_DEFAULT_SETTINGS = Object.freeze({
  domain: 'FOG_AD_DEFAULT_DOMAINNAME',
  organizationalUnit: 'FOG_AD_DEFAULT_OU',
  username: 'FOG_AD_DEFAULT_USER',
  password: 'FOG_AD_DEFAULT_PASSWORD',
});

function settingBoolean(value) {
  return value === true || value === 1 || ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase());
}

async function globalModuleStatuses(client, modules) {
  const settingNames = [...new Set(modules
    .map((module) => MODULE_GLOBAL_SETTINGS[module.shortName])
    .filter(Boolean))].sort();
  if (!settingNames.length) return new Map();
  if (moduleStatusStrategies.get(client) !== 'search') {
    try {
      const filter = encodeURIComponent(`name=${settingNames.join(',')}`);
      const values = await getJson(client, `service/ids/${filter}/value`);
      if (!Array.isArray(values) || values.length !== settingNames.length) {
        throw new Error('FOG did not return the requested global module settings.');
      }
      moduleStatusStrategies.set(client, 'filtered-ids');
      return new Map(settingNames.map((name, index) => [name, settingBoolean(values[index])]));
    } catch {
      moduleStatusStrategies.set(client, 'search');
    }
  }
  const payload = await getJson(client, 'service/search/FOG_CLIENT_');
  const allowed = new Set(settingNames);
  const exactRows = rawCollection(payload, 'services')
    .filter((setting) => allowed.has(setting.name));
  const byName = new Map(exactRows.map((setting) => [setting.name, settingBoolean(setting.value)]));
  if (settingNames.some((name) => !byName.has(name))) {
    throw new Error('FOG did not return every required global module setting.');
  }
  return byName;
}

function selectDefaultOrganizationalUnit(value) {
  const choices = [...new Set(String(value || '').split('|').map((item) => item.trim()).filter(Boolean))];
  if (choices.length === 1) return choices[0].replaceAll(';', '');
  return (choices.find((item) => item.includes(';')) || '').replaceAll(';', '');
}

async function getActiveDirectoryDefaults(client, { includePassword = false } = {}) {
  const payload = await getJson(client, 'service/search/FOG_AD_DEFAULT_');
  const allowed = new Set(Object.values(AD_DEFAULT_SETTINGS));
  const rows = rawCollection(payload, 'services').filter((setting) => allowed.has(setting.name));
  const byName = new Map(rows.map((setting) => [setting.name, String(setting.value ?? '')]));
  const result = {
    domain: (byName.get(AD_DEFAULT_SETTINGS.domain) || '').trim(),
    organizationalUnit: selectDefaultOrganizationalUnit(byName.get(AD_DEFAULT_SETTINGS.organizationalUnit)),
    username: (byName.get(AD_DEFAULT_SETTINGS.username) || '').trim(),
    hasPassword: Boolean((byName.get(AD_DEFAULT_SETTINGS.password) || '').trim()),
  };
  if (includePassword) result.password = (byName.get(AD_DEFAULT_SETTINGS.password) || '').trim();
  return result;
}

export function validateImageCreate(input = {}) {
  const values = {
    name: String(input.name || '').trim(),
    description: String(input.description || '').trim(),
    path: String(input.path || '').trim(),
    osId: Number(input.osId),
    imageTypeId: Number(input.imageTypeId),
    partitionTypeId: Number(input.partitionTypeId),
    storageGroupId: Number(input.storageGroupId),
    compression: Number(input.compression),
    format: Number(input.format),
    replicates: input.replicates !== false,
  };
  const fields = {};
  if (!values.name) fields.name = 'Enter an image name.';
  if (!values.path) fields.path = 'Enter a relative image storage path.';
  else if (['dev', 'postdownloadscripts'].includes(values.path.toLowerCase())) fields.path = 'This path is reserved by FOG.';
  else if (values.path.length > 255 || !/^[a-z0-9._-]+(?:\/[a-z0-9._-]+)*$/i.test(values.path)
    || values.path.split('/').some((part) => part === '.' || part === '..')) {
    fields.path = 'Use a relative path containing letters, numbers, dots, underscores, hyphens, or safe subfolders.';
  }
  for (const [field, label] of [['osId', 'operating system'], ['imageTypeId', 'image type'], ['partitionTypeId', 'partition type'], ['storageGroupId', 'storage group']]) {
    if (!Number.isInteger(values[field]) || values[field] <= 0) fields[field] = `Select a valid ${label}.`;
  }
  if (!Number.isInteger(values.compression) || values.compression < 0 || values.compression > 22) {
    fields.compression = 'Compression must be between 0 and 22.';
  }
  if (!Number.isInteger(values.format) || values.format < 0 || values.format > 6) {
    fields.format = 'Select a valid image format.';
  }
  if (Object.keys(fields).length) throw new FogValidationError('Check the image definition fields.', fields);
  return values;
}

export function validateImageUpdate(input = {}) {
  const values = {
    name: String(input.name || '').trim(),
    description: String(input.description || '').trim(),
    path: String(input.path || '').trim(),
    osId: Number(input.osId),
    imageTypeId: Number(input.imageTypeId),
    partitionTypeId: Number(input.partitionTypeId),
    compression: Number(input.compression),
    format: Number(input.format),
    isProtected: input.isProtected === true,
    isEnabled: input.isEnabled === true,
    replicates: input.replicates === true,
  };
  const fields = {};
  if (!values.name) fields.name = 'Enter an image name.';
  if (!values.path) fields.path = 'Enter a relative image storage path.';
  else if (['dev', 'postdownloadscripts'].includes(values.path.toLowerCase())) fields.path = 'This path is reserved by FOG.';
  else if (values.path.length > 255 || !/^[a-z0-9._-]+(?:\/[a-z0-9._-]+)*$/i.test(values.path)
    || values.path.split('/').some((part) => part === '.' || part === '..')) {
    fields.path = 'Use a relative path containing letters, numbers, dots, underscores, hyphens, or safe subfolders.';
  }
  for (const [field, label] of [['osId', 'operating system'], ['imageTypeId', 'image type'], ['partitionTypeId', 'partition type']]) {
    if (!Number.isInteger(values[field]) || values[field] <= 0) fields[field] = `Select a valid ${label}.`;
  }
  if (!Number.isInteger(values.compression) || values.compression < 0 || values.compression > 22) {
    fields.compression = 'Compression must be between 0 and 22.';
  }
  if (!Number.isInteger(values.format) || values.format < 0 || values.format > 6) {
    fields.format = 'Select a valid image format.';
  }
  if (Object.keys(fields).length) throw new FogValidationError('Check the image definition fields.', fields);
  return values;
}

export function validateHostUpdate(input = {}) {
  const name = String(input.name ?? '').trim();
  const description = String(input.description ?? '').trim();
  const imageId = Number(input.imageId);
  const kernel = String(input.kernel ?? '').trim();
  const kernelArgs = String(input.kernelArgs ?? '').trim();
  const kernelDevice = String(input.kernelDevice ?? '').trim();
  const init = String(input.init ?? '').trim();
  const biosExit = String(input.biosExit ?? '').trim();
  const efiExit = String(input.efiExit ?? '').trim();
  const fields = {};
  const exitTypes = new Set(['', 'sanboot', 'grub', 'grub_first_hdd', 'grub_first_cdrom', 'grub_first_found_windows', 'refind_efi', 'exit', 'reboot']);

  if (!name) {
    fields.name = 'Enter a hostname.';
  } else if (!/^[\w!@#$%^()\-'{}.~]{1,15}$/u.test(name)) {
    fields.name = 'Use 1–15 characters accepted by FOG for hostnames.';
  }
  if (!Number.isInteger(imageId) || imageId < 0) {
    fields.imageId = 'Select a valid image.';
  }
  for (const [field, value, label] of [
    ['kernel', kernel, 'Kernel'],
    ['kernelArgs', kernelArgs, 'Kernel arguments'],
    ['kernelDevice', kernelDevice, 'Primary disk'],
    ['init', init, 'Init file'],
  ]) {
    if (value.length > 250) fields[field] = `${label} must be 250 characters or fewer.`;
    else if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value)) fields[field] = `${label} cannot contain control characters.`;
  }
  if (!exitTypes.has(biosExit)) fields.biosExit = 'Select a supported BIOS exit type.';
  if (!exitTypes.has(efiExit)) fields.efiExit = 'Select a supported EFI exit type.';
  if (Object.keys(fields).length) {
    throw new FogValidationError('Check the highlighted host fields.', fields);
  }

  return { name, description, imageId, kernel, kernelArgs, kernelDevice, init, biosExit, efiExit };
}

export function validateHostActiveDirectory(input = {}) {
  const values = {
    enabled: input.enabled === true,
    domain: String(input.domain ?? '').trim(),
    organizationalUnit: String(input.organizationalUnit ?? '').trim(),
    username: String(input.username ?? '').trim(),
    password: String(input.password ?? '').trim(),
    useDefaultPassword: input.useDefaultPassword === true,
    enforce: input.enforce === true,
  };
  const fields = {};
  if (values.domain.length > 250) fields.domain = 'Domain must be 250 characters or fewer.';
  if (values.organizationalUnit.length > 1024) fields.organizationalUnit = 'Organizational unit must be 1024 characters or fewer.';
  else if (values.organizationalUnit.includes(';')) fields.organizationalUnit = 'Use a distinguished name without semicolons.';
  if (values.username.length > 250) fields.username = 'Username must be 250 characters or fewer.';
  if (values.enabled) {
    if (!values.domain) fields.domain = 'Enter the Active Directory domain.';
    if (!values.username) fields.username = 'Enter the domain join account.';
    if (!values.useDefaultPassword && !values.password) fields.password = 'Enter the domain join password or choose the configured FOG default.';
    else if (!values.useDefaultPassword && values.password.length > 250) fields.password = 'Password must be 250 characters or fewer.';
    else if (!values.useDefaultPassword && /^[*#]{32}$/.test(values.password)) fields.password = 'Enter the real password or use the dedicated FOG default option.';
    else if (!values.useDefaultPassword && /[\u0000-\u001f\u007f]/u.test(values.password)) fields.password = 'Password cannot contain control characters.';
  }
  if (Object.keys(fields).length) throw new FogValidationError('Check the Active Directory fields.', fields);
  return values;
}

export function validateInventoryMetadata(input = {}) {
  const values = {
    primaryUser: String(input.primaryUser ?? '').trim(),
    assetTag: String(input.assetTag ?? '').trim(),
    alternateTag: String(input.alternateTag ?? '').trim(),
  };
  const fields = {};
  for (const [field, label] of [
    ['primaryUser', 'Primary user'],
    ['assetTag', 'Asset tag'],
    ['alternateTag', 'Alternate tag'],
  ]) {
    if (values[field].length > 50) fields[field] = `${label} must be 50 characters or fewer.`;
  }
  if (Object.keys(fields).length) {
    throw new FogValidationError('Check the inventory metadata fields.', fields);
  }
  return values;
}

export function validatePasswordResetAccount(value) {
  const account = String(value ?? '').trim();
  if (!account) {
    throw new FogValidationError('Enter the local Windows account to reset.', {
      account: 'Enter a local account name.',
    });
  }
  if (!/^[A-Za-z0-9._@$-]{1,20}$/.test(account)) {
    throw new FogValidationError('Check the Windows account name.', {
      account: 'Use 1–20 letters, numbers, periods, underscores, @, $, or hyphens with no spaces.',
    });
  }
  return account;
}

export function validateGroupDefinition(input = {}) {
  const values = {
    name: String(input.name || '').trim(),
    description: String(input.description || '').trim(),
  };
  const fields = {};
  if (!values.name) fields.name = 'Enter a group name.';
  else if (values.name.length > 50) fields.name = 'Use no more than 50 characters.';
  if (Object.keys(fields).length) throw new FogValidationError('Check the group fields.', fields);
  return values;
}

export function validateSnapinDefinition(input = {}, { creating = false } = {}) {
  const values = {
    name: String(input.name || '').trim(),
    description: String(input.description || '').trim(),
    file: String(input.file || '').trim(),
    arguments: String(input.arguments || '').trim(),
    runWith: String(input.runWith || '').trim(),
    runWithArguments: String(input.runWithArguments || '').trim(),
    packageType: Number(input.packageType),
    timeoutSeconds: Number(input.timeoutSeconds),
    storageGroupId: Number(input.storageGroupId),
    isProtected: input.isProtected === true,
    isEnabled: input.isEnabled === true,
    replicates: input.replicates === true,
    hidesArguments: input.hidesArguments === true,
    postAction: String(input.postAction || 'none'),
  };
  const fields = {};
  if (!values.name) fields.name = 'Enter a Snapin name.';
  else if (values.name.length > 200) fields.name = 'Use no more than 200 characters.';
  if (!values.file) fields.file = 'Enter the filename already present in Snapin storage.';
  else if (values.file === '.' || values.file === '..' || /ssl/i.test(values.file)
    || !/^[A-Za-z0-9_.-]+$/.test(values.file)) {
    fields.file = 'Use a single safe filename containing letters, numbers, dots, underscores, or hyphens; names containing “ssl” are reserved by FOG.';
  }
  if (![0, 1].includes(values.packageType)) fields.packageType = 'Select Normal Snapin or Snapin Pack.';
  if (!Number.isInteger(values.timeoutSeconds) || values.timeoutSeconds < 0 || values.timeoutSeconds > 2147483647) {
    fields.timeoutSeconds = 'Timeout must be a non-negative whole number accepted by FOG.';
  }
  if (creating && (!Number.isInteger(values.storageGroupId) || values.storageGroupId <= 0)) {
    fields.storageGroupId = 'Select a valid storage group.';
  }
  if (!['none', 'reboot', 'shutdown'].includes(values.postAction)) fields.postAction = 'Select a supported post-install action.';
  for (const [field, label] of [
    ['arguments', 'Arguments'], ['runWith', 'Run with'], ['runWithArguments', 'Run-with arguments'],
  ]) {
    if (values[field].length > 4096) fields[field] = `${label} must be 4096 characters or fewer.`;
    else if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(values[field])) fields[field] = `${label} cannot contain control characters.`;
  }
  if (Object.keys(fields).length) throw new FogValidationError('Check the Snapin definition fields.', fields);
  return values;
}

export function createResources(client) {
  return {
    system: {
      async status() {
        const status = await client.get('system/info', { responseType: 'text' });
        if (status !== 'success') throw new Error('FOG returned an unexpected status response');
        return status;
      },
    },
    hosts: {
      async list({ search = '' } = {}) {
        const payload = await getJson(client, searchPath('host', search));
        return normalizeCollection(payload, 'hosts', normalizeHost);
      },
      async get(id) {
        const payload = await getJson(client, `host/${assertPositiveId(id, 'Host')}`);
        return normalizeHost(payload);
      },
      async update(id, input) {
        const hostId = assertPositiveId(id, 'Host');
        const update = validateHostUpdate(input);
        const [current, imagesPayload, activePayload] = await Promise.all([
          getJson(client, `host/${hostId}`),
          getJson(client, 'image'),
          getJson(client, 'task/active'),
        ]);
        const currentHost = normalizeHost(current);
        const images = normalizeCollection(imagesPayload, 'images', normalizeImage);
        const activeTasks = normalizeCollection(activePayload, 'tasks', normalizeTask);

        if (update.imageId !== 0 && !images.some((image) => image.id === update.imageId)) {
          throw new FogValidationError('Check the highlighted host fields.', {
            imageId: 'The selected image no longer exists.',
          });
        }
        if (update.imageId !== (currentHost.imageId ?? 0)
          && activeTasks.some((task) => task.host.id === hostId)) {
          throw new FogConflictError('The assigned image cannot change while this computer has an active task.');
        }

        const payload = await client.put(`host/${hostId}/edit`, {
          name: update.name,
          description: update.description,
          imageID: update.imageId,
          kernel: update.kernel,
          kernelArgs: update.kernelArgs,
          kernelDevice: update.kernelDevice,
          init: update.init,
          biosexit: update.biosExit,
          efiexit: update.efiExit,
        }, { responseType: 'json' });
        return normalizeHost(payload);
      },
      async updateActiveDirectory(id, input) {
        const hostId = assertPositiveId(id, 'Host');
        const values = validateHostActiveDirectory(input);
        const currentHost = normalizeHost(await getJson(client, `host/${hostId}`));
        if (currentHost.id !== hostId) throw new FogConflictError('FOG returned a different host during Active Directory preflight.');
        const body = {
          useAD: values.enabled ? 1 : 0,
          ADDomain: values.domain,
          ADOU: values.organizationalUnit,
          ADUser: values.username,
          enforce: values.enforce ? 1 : 0,
        };
        if (values.enabled) {
          if (values.useDefaultPassword) {
            const defaults = await getActiveDirectoryDefaults(client, { includePassword: true });
            if (!defaults.password) {
              throw new FogValidationError('The FOG default domain password is not configured.', {
                password: 'Enter a password manually or configure FOG_AD_DEFAULT_PASSWORD.',
              });
            }
            body.ADPass = defaults.password;
          } else {
            body.ADPass = values.password;
          }
        }
        const payload = await client.put(`host/${hostId}/edit`, body, { responseType: 'json' });
        const host = normalizeHost(payload);
        if (host.id !== hostId) throw new FogConflictError('FOG returned a different host after the Active Directory update.');
        return host;
      },
      async activeDirectoryDefaults() {
        return getActiveDirectoryDefaults(client);
      },
    },
    inventory: {
      async updateForHost(id, input) {
        const hostId = assertPositiveId(id, 'Host');
        const values = validateInventoryMetadata(input);
        const host = normalizeHost(await getJson(client, `host/${hostId}`));
        if (!host.inventory.id) {
          throw new FogConflictError('Collect hardware inventory before editing its ownership and asset tags.');
        }
        const payload = await client.put(`inventory/${host.inventory.id}/edit`, {
          primaryUser: values.primaryUser,
          other1: values.assetTag,
          other2: values.alternateTag,
        }, { responseType: 'json' });
        const inventory = normalizeInventory(payload);
        if (inventory.hostId !== hostId) {
          throw new FogConflictError('FOG returned inventory for a different computer; the update could not be verified.');
        }
        return inventory;
      },
    },
    images: {
      async list({ search = '' } = {}) {
        const payload = await getJson(client, searchPath('image', search));
        return normalizeCollection(payload, 'images', normalizeImage);
      },
      async get(id) {
        const payload = await getJson(client, `image/${assertPositiveId(id, 'Image')}`);
        return normalizeImage(payload);
      },
      async details(id) {
        const imageId = assertPositiveId(id, 'Image');
        const [imagePayload, hostsPayload, activePayload] = await Promise.all([
          getJson(client, `image/${imageId}`),
          getJson(client, 'host'),
          getJson(client, 'task/active'),
        ]);
        const image = normalizeImage(imagePayload);
        return {
          image,
          assignedHosts: normalizeCollection(hostsPayload, 'hosts', normalizeHost)
            .filter((host) => host.imageId === imageId)
            .sort((left, right) => left.name.localeCompare(right.name)),
          activeTasks: normalizeCollection(activePayload, 'tasks', normalizeTask)
            .filter((task) => task.image.id === imageId),
        };
      },
      async lookups() {
        const [osPayload, typesPayload, partitionsPayload, storagePayload] = await Promise.all([
          getJson(client, 'os'), getJson(client, 'imagetype'),
          getJson(client, 'imagepartitiontype'), getJson(client, 'storagegroup'),
        ]);
        return {
          operatingSystems: normalizeCollection(osPayload, 'oss', normalizeLookup),
          imageTypes: normalizeCollection(typesPayload, 'imagetypes', normalizeLookup),
          partitionTypes: normalizeCollection(partitionsPayload, 'imagepartitiontypes', normalizeLookup),
          storageGroups: normalizeCollection(storagePayload, 'storagegroups', normalizeStorageGroup),
        };
      },
      async create(input) {
        const values = validateImageCreate(input);
        const [imagesPayload, lookups] = await Promise.all([
          getJson(client, 'image'),
          this.lookups(),
        ]);
        const images = normalizeCollection(imagesPayload, 'images', normalizeImage);
        const fields = {};
        if (images.some((image) => image.name.toLowerCase() === values.name.toLowerCase())) {
          fields.name = 'An image with this name already exists.';
        }
        if (images.some((image) => image.path.toLowerCase() === values.path.toLowerCase())) {
          fields.path = 'Another image already uses this path.';
        }
        const lookupChecks = [
          ['osId', lookups.operatingSystems], ['imageTypeId', lookups.imageTypes],
          ['partitionTypeId', lookups.partitionTypes], ['storageGroupId', lookups.storageGroups],
        ];
        for (const [field, options] of lookupChecks) {
          if (!options.some((option) => option.id === values[field])) fields[field] = 'The selected option no longer exists.';
        }
        if (Object.keys(fields).length) throw new FogValidationError('Check the image definition fields.', fields);
        const payload = await client.post('image/create', {
          name: values.name,
          description: values.description,
          path: values.path,
          osID: values.osId,
          imageTypeID: values.imageTypeId,
          imagePartitionTypeID: values.partitionTypeId,
          storagegroups: [values.storageGroupId],
          compress: values.compression,
          format: values.format,
          isEnabled: 1,
          toReplicate: values.replicates ? 1 : 0,
        }, { responseType: 'json' });
        return normalizeImage(payload);
      },
      async update(id, input) {
        const imageId = assertPositiveId(id, 'Image');
        const values = validateImageUpdate(input);
        const [currentPayload, imagesPayload, osPayload, typesPayload, partitionsPayload, activePayload] = await Promise.all([
          getJson(client, `image/${imageId}`),
          getJson(client, 'image'),
          getJson(client, 'os'),
          getJson(client, 'imagetype'),
          getJson(client, 'imagepartitiontype'),
          getJson(client, 'task/active'),
        ]);
        const current = normalizeImage(currentPayload);
        const images = normalizeCollection(imagesPayload, 'images', normalizeImage);
        const fields = {};
        if (images.some((image) => image.id !== imageId && image.name.toLowerCase() === values.name.toLowerCase())) {
          fields.name = 'An image with this name already exists.';
        }
        if (images.some((image) => image.id !== imageId && image.path.toLowerCase() === values.path.toLowerCase())) {
          fields.path = 'Another image already uses this path.';
        }
        const lookupChecks = [
          ['osId', normalizeCollection(osPayload, 'oss', normalizeLookup)],
          ['imageTypeId', normalizeCollection(typesPayload, 'imagetypes', normalizeLookup)],
          ['partitionTypeId', normalizeCollection(partitionsPayload, 'imagepartitiontypes', normalizeLookup)],
        ];
        for (const [field, options] of lookupChecks) {
          if (!options.some((option) => option.id === values[field])) fields[field] = 'The selected option no longer exists.';
        }
        if (Object.keys(fields).length) throw new FogValidationError('Check the image definition fields.', fields);
        const activeTasks = normalizeCollection(activePayload, 'tasks', normalizeTask);
        if (activeTasks.some((task) => task.image.id === imageId)) {
          throw new FogConflictError(`The image “${current.name || values.name}” cannot be edited while it has an active task.`);
        }
        const payload = await client.put(`image/${imageId}/edit`, {
          name: values.name,
          description: values.description,
          path: values.path,
          osID: values.osId,
          imageTypeID: values.imageTypeId,
          imagePartitionTypeID: values.partitionTypeId,
          format: values.format,
          protected: values.isProtected ? 1 : 0,
          compress: values.compression,
          isEnabled: values.isEnabled ? 1 : 0,
          toReplicate: values.replicates ? 1 : 0,
        }, { responseType: 'json' });
        return normalizeImage(payload);
      },
    },
    deployments: {
      async create(input = {}) {
        const hostIds = positiveIdList(input.hostIds || [], 'computers');
        const imageId = Number(input.imageId);
        if (!hostIds.length) {
          throw new FogValidationError('Select at least one computer.', {
            computers: 'Select one or more computers to deploy.',
          });
        }
        if (!Number.isInteger(imageId) || imageId <= 0) {
          throw new FogValidationError('Select an image.', { image: 'Select a valid image.' });
        }
        const [hostsPayload, imagesPayload, activePayload] = await Promise.all([
          getJson(client, 'host'),
          getJson(client, 'image'),
          getJson(client, 'task/active'),
        ]);
        const hosts = normalizeCollection(hostsPayload, 'hosts', normalizeHost);
        const images = normalizeCollection(imagesPayload, 'images', normalizeImage);
        const activeTasks = normalizeCollection(activePayload, 'tasks', normalizeTask);
        const hostMap = new Map(hosts.map((host) => [host.id, host]));
        const missingIds = hostIds.filter((hostId) => !hostMap.has(hostId));
        if (missingIds.length) {
          throw new FogValidationError('One or more selected computers no longer exist.', {
            computers: `Missing host IDs: ${missingIds.join(', ')}`,
          });
        }
        const image = images.find((item) => item.id === imageId);
        if (!image) {
          throw new FogValidationError('The selected image no longer exists.', { image: 'Choose another image.' });
        }
        if (!image.isEnabled) {
          throw new FogConflictError(`The image “${image.name}” is disabled and cannot be deployed.`);
        }

        const options = {
          includeSnapins: input.includeSnapins !== false,
          wake: input.wake === true,
          shutdown: input.shutdown === true,
        };
        const activeHostIds = new Set(activeTasks.map((task) => task.host.id));
        const taskTypeID = options.includeSnapins
          ? HOST_TASK_TYPES.deploy
          : HOST_TASK_TYPES.deployWithoutSnapins;
        const outcomes = [];

        for (const hostId of hostIds) {
          const host = hostMap.get(hostId);
          if (activeHostIds.has(hostId)) {
            outcomes.push({
              host, status: 'skipped', stage: 'preflight', imageChanged: false,
              message: 'Skipped because this computer already has an active task.',
            });
            continue;
          }
          let imageChanged = false;
          if (host.imageId !== imageId) {
            try {
              await client.put(`host/${hostId}/edit`, {
                name: host.name,
                description: host.description,
                imageID: imageId,
              }, { responseType: 'json' });
              imageChanged = true;
            } catch (error) {
              outcomes.push({
                host, status: 'failed', stage: 'image-assignment', imageChanged: false,
                message: 'FOG rejected the image assignment; no task was created.',
                errorCode: error.code || 'FOG_ERROR',
              });
              continue;
            }
          }
          const body = {
            taskTypeID,
            taskName: 'Foggy Bulk Deploy',
            shutdown: options.shutdown,
            wol: options.wake,
          };
          if (options.includeSnapins) body.deploySnapins = true;
          try {
            await client.post(`host/${hostId}/task`, body, { responseType: 'json' });
            outcomes.push({
              host: { ...host, imageId: image.id, imageName: image.name },
              status: 'queued', stage: 'complete', imageChanged,
              message: imageChanged
                ? 'Image assignment updated and deployment queued.'
                : 'Deployment queued using the existing image assignment.',
            });
          } catch (error) {
            outcomes.push({
              host: { ...host, imageId: image.id, imageName: image.name },
              status: 'failed', stage: 'task-creation', imageChanged,
              message: imageChanged
                ? 'Image assignment changed, but FOG rejected the deployment task.'
                : 'FOG rejected the deployment task.',
              errorCode: error.code || 'FOG_ERROR',
            });
          }
        }

        return {
          image,
          options,
          outcomes,
          queued: outcomes.filter((outcome) => outcome.status === 'queued').length,
          failed: outcomes.filter((outcome) => outcome.status !== 'queued').length,
        };
      },
    },
    captures: {
      async create(input = {}) {
        const hostId = Number(input.hostId);
        const imageId = Number(input.imageId);
        if (!Number.isInteger(hostId) || hostId <= 0) {
          throw new FogValidationError('Select a computer to capture.', { computer: 'Select a valid computer.' });
        }
        if (!Number.isInteger(imageId) || imageId <= 0) {
          throw new FogValidationError('Select an image definition.', { image: 'Select a valid image.' });
        }
        const [hostPayload, imagesPayload, activePayload] = await Promise.all([
          getJson(client, `host/${hostId}`),
          getJson(client, 'image'),
          getJson(client, 'task/active'),
        ]);
        const host = normalizeHost(hostPayload);
        const image = normalizeCollection(imagesPayload, 'images', normalizeImage)
          .find((item) => item.id === imageId);
        if (!image) {
          throw new FogValidationError('The selected image no longer exists.', { image: 'Choose another image.' });
        }
        if (!image.isEnabled) {
          throw new FogConflictError(`The image “${image.name}” is disabled and cannot be captured.`);
        }
        if (image.isProtected) {
          throw new FogConflictError(`The image “${image.name}” is protected and cannot be captured over.`);
        }
        const activeTasks = normalizeCollection(activePayload, 'tasks', normalizeTask)
          .filter((task) => task.host.id === hostId);
        if (activeTasks.length) {
          throw new FogConflictError(`${host.name || 'This computer'} already has an active task.`);
        }

        let imageChanged = false;
        if (host.imageId !== imageId) {
          try {
            await client.put(`host/${hostId}/edit`, {
              name: host.name,
              description: host.description,
              imageID: imageId,
            }, { responseType: 'json' });
            imageChanged = true;
          } catch (error) {
            return {
              host, image, status: 'failed', stage: 'image-assignment', imageChanged: false,
              message: 'FOG rejected the image assignment; no capture task was created.',
            };
          }
        }
        try {
          await client.post(`host/${hostId}/task`, {
            taskTypeID: HOST_TASK_TYPES.capture,
            taskName: 'Foggy Guided Capture',
            shutdown: input.shutdown === true,
            wol: input.wake === true,
          }, { responseType: 'json' });
          return {
            host: { ...host, imageId: image.id, imageName: image.name }, image,
            status: 'queued', stage: 'complete', imageChanged,
            message: imageChanged
              ? 'Image assignment updated and capture queued.'
              : 'Capture queued using the existing image assignment.',
          };
        } catch (error) {
          return {
            host: { ...host, imageId: image.id, imageName: image.name }, image,
            status: 'failed', stage: 'task-creation', imageChanged,
            message: imageChanged
              ? 'Image assignment changed, but FOG rejected the capture task.'
              : 'FOG rejected the capture task.',
          };
        }
      },
    },
    groups: {
      async list() {
        const payload = await getJson(client, 'group');
        return normalizeCollection(payload, 'groups', normalizeGroup);
      },
      async get(id) {
        const payload = await getJson(client, `group/${assertPositiveId(id, 'Group')}`);
        return normalizeGroup(payload);
      },
      async create(input) {
        const values = validateGroupDefinition(input);
        const groupsPayload = await getJson(client, 'group');
        const groups = normalizeCollection(groupsPayload, 'groups', normalizeGroup);
        if (groups.some((group) => group.name.toLowerCase() === values.name.toLowerCase())) {
          throw new FogValidationError('Check the group fields.', {
            name: 'A group with this name already exists.',
          });
        }
        const payload = await client.post('group/create', values, { responseType: 'json' });
        return normalizeGroup(payload);
      },
      async update(id, input) {
        const groupId = assertPositiveId(id, 'Group');
        const values = validateGroupDefinition(input);
        const [currentPayload, groupsPayload] = await Promise.all([
          getJson(client, `group/${groupId}`),
          getJson(client, 'group'),
        ]);
        const current = normalizeGroup(currentPayload);
        const groups = normalizeCollection(groupsPayload, 'groups', normalizeGroup);
        if (groups.some((group) => group.id !== groupId && group.name.toLowerCase() === values.name.toLowerCase())) {
          throw new FogValidationError('Check the group fields.', {
            name: 'A group with this name already exists.',
          });
        }
        const payload = await client.put(`group/${groupId}/edit`, {
          name: values.name,
          description: values.description,
          imageID: 0,
        }, { responseType: 'json' });
        const updated = normalizeGroup(payload);
        return { ...updated, hostCount: current.hostCount };
      },
      async remove(id) {
        const groupId = assertPositiveId(id, 'Group');
        const [groupPayload, members] = await Promise.all([
          getJson(client, `group/${groupId}`),
          this.members(groupId),
        ]);
        const group = normalizeGroup(groupPayload);
        await client.delete(`group/${groupId}`);
        const [groupsPayload, associationsPayload] = await Promise.all([
          getJson(client, 'group'),
          getJson(client, 'groupassociation'),
        ]);
        const groupStillExists = normalizeCollection(groupsPayload, 'groups', normalizeGroup)
          .some((item) => item.id === groupId);
        const remainingAssociations = rawCollection(associationsPayload, 'groupassociations')
          .filter((association) => sameId(association.groupID, groupId));
        if (groupStillExists || remainingAssociations.length) {
          throw new FogConflictError('FOG did not fully remove the group and all membership associations.');
        }
        return { group, detachedHostIds: members.map((host) => host.id) };
      },
      async members(id) {
        const groupId = assertPositiveId(id, 'Group');
        const [hostsPayload, associationsPayload] = await Promise.all([
          getJson(client, 'host'),
          getJson(client, 'groupassociation'),
        ]);
        const hostIds = new Set(rawCollection(associationsPayload, 'groupassociations')
          .filter((association) => sameId(association.groupID, groupId))
          .map((association) => Number(association.hostID)));
        return normalizeCollection(hostsPayload, 'hosts', normalizeHost)
          .filter((host) => hostIds.has(host.id))
          .sort((left, right) => left.name.localeCompare(right.name));
      },
      async updateMembers(id, requestedIds = []) {
        const groupId = assertPositiveId(id, 'Group');
        const memberIds = [...new Set((Array.isArray(requestedIds) ? requestedIds : [requestedIds])
          .filter((value) => value !== '')
          .map((value) => assertPositiveId(value, 'Host')))];
        const [groupPayload, hostsPayload, beforePayload] = await Promise.all([
          getJson(client, `group/${groupId}`),
          getJson(client, 'host'),
          getJson(client, 'groupassociation'),
        ]);
        const group = normalizeGroup(groupPayload);
        const hosts = normalizeCollection(hostsPayload, 'hosts', normalizeHost);
        const validHostIds = new Set(hosts.map((host) => host.id));
        const invalidIds = memberIds.filter((hostId) => !validHostIds.has(hostId));
        if (invalidIds.length) {
          throw new FogValidationError('One or more selected computers no longer exist.', {
            members: `Invalid host IDs: ${invalidIds.join(', ')}`,
          });
        }
        const beforeIds = new Set(rawCollection(beforePayload, 'groupassociations')
          .filter((association) => sameId(association.groupID, groupId))
          .map((association) => Number(association.hostID)));
        await client.put(`group/${groupId}/edit`, {
          name: group.name,
          description: group.description,
          hosts: memberIds,
          imageID: 0,
        }, { responseType: 'json' });
        const afterPayload = await getJson(client, 'groupassociation');
        const afterIds = new Set(rawCollection(afterPayload, 'groupassociations')
          .filter((association) => sameId(association.groupID, groupId))
          .map((association) => Number(association.hostID)));
        const failedAdd = memberIds.filter((hostId) => !afterIds.has(hostId));
        const failedRemove = [...beforeIds].filter((hostId) => !memberIds.includes(hostId) && afterIds.has(hostId));
        if (failedAdd.length || failedRemove.length) {
          throw new FogConflictError(`FOG only partially updated membership. Failed additions: ${failedAdd.join(', ') || 'none'}; failed removals: ${failedRemove.join(', ') || 'none'}.`);
        }
        return {
          groupId,
          added: memberIds.filter((hostId) => !beforeIds.has(hostId)),
          removed: [...beforeIds].filter((hostId) => !afterIds.has(hostId)),
          memberIds: [...afterIds],
        };
      },
      async forHost(id) {
        const hostId = assertPositiveId(id, 'Host');
        const [groupsPayload, associationsPayload] = await Promise.all([
          getJson(client, 'group'),
          getJson(client, 'groupassociation'),
        ]);
        const groupIds = new Set(rawCollection(associationsPayload, 'groupassociations')
          .filter((association) => sameId(association.hostID, hostId))
          .map((association) => Number(association.groupID)));
        return normalizeCollection(groupsPayload, 'groups', normalizeGroup)
          .filter((group) => groupIds.has(group.id))
          .sort((left, right) => left.name.localeCompare(right.name));
      },
    },
    snapins: {
      async list() {
        const payload = await getJson(client, 'snapin');
        return normalizeCollection(payload, 'snapins', normalizeSnapin);
      },
      async get(id) {
        const payload = await getJson(client, `snapin/${assertPositiveId(id, 'Snapin')}`);
        return normalizeSnapin(payload);
      },
      async lookups() {
        const payload = await getJson(client, 'storagegroup');
        return {
          storageGroups: normalizeCollection(payload, 'storagegroups', normalizeStorageGroup),
        };
      },
      async create(input) {
        const values = validateSnapinDefinition(input, { creating: true });
        const [snapinsPayload, lookups] = await Promise.all([
          getJson(client, 'snapin'),
          this.lookups(),
        ]);
        const snapins = normalizeCollection(snapinsPayload, 'snapins', normalizeSnapin);
        const fields = {};
        if (snapins.some((snapin) => snapin.name.toLowerCase() === values.name.toLowerCase())) {
          fields.name = 'A Snapin with this name already exists.';
        }
        if (!lookups.storageGroups.some((group) => group.id === values.storageGroupId)) {
          fields.storageGroupId = 'The selected storage group no longer exists.';
        }
        if (Object.keys(fields).length) throw new FogValidationError('Check the Snapin definition fields.', fields);
        const payload = await client.post('snapin/create', {
          name: values.name,
          description: values.description,
          file: values.file,
          args: values.arguments,
          runWith: values.runWith,
          runWithArgs: values.runWithArguments,
          packtype: values.packageType,
          timeout: values.timeoutSeconds,
          protected: values.isProtected ? 1 : 0,
          isEnabled: values.isEnabled ? 1 : 0,
          toReplicate: values.replicates ? 1 : 0,
          hide: values.hidesArguments ? 1 : 0,
          reboot: values.postAction === 'reboot' ? 1 : 0,
          shutdown: values.postAction === 'shutdown' ? 1 : 0,
          createdTime: new Date().toISOString().slice(0, 19).replace('T', ' '),
          createdBy: 'Foggy',
          storagegroups: [values.storageGroupId],
        }, { responseType: 'json' });
        return normalizeSnapin(payload);
      },
      async createWithFile(input, file, { timeoutMs } = {}) {
        if (!file?.path || !file?.originalName) {
          throw new FogValidationError('Choose an installer file to upload.', {
            installer: 'Choose an installer file.',
          });
        }
        const values = validateSnapinDefinition({ ...input, file: file.originalName }, { creating: true });
        const [snapinsPayload, lookups] = await Promise.all([
          getJson(client, 'snapin'),
          this.lookups(),
        ]);
        const snapins = normalizeCollection(snapinsPayload, 'snapins', normalizeSnapin);
        const fields = {};
        if (snapins.some((snapin) => snapin.name.toLowerCase() === values.name.toLowerCase())) {
          fields.name = 'A Snapin with this name already exists.';
        }
        if (!lookups.storageGroups.some((group) => group.id === values.storageGroupId)) {
          fields.storageGroupId = 'The selected storage group no longer exists.';
        }
        if (Object.keys(fields).length) throw new FogValidationError('Check the Snapin definition fields.', fields);

        const form = new FormData();
        form.append('snapin', values.name);
        form.append('description', values.description);
        form.append('packtype', String(values.packageType));
        form.append('rw', values.runWith);
        form.append('rwa', values.runWithArguments);
        form.append('storagegroup', String(values.storageGroupId));
        form.append('args', values.arguments);
        form.append('timeout', String(values.timeoutSeconds));
        form.append('action', values.postAction);
        if (values.isEnabled) form.append('isEnabled', '1');
        if (values.replicates) form.append('toReplicate', '1');
        if (values.hidesArguments) form.append('isHidden', '1');
        const blob = await openAsBlob(file.path, { type: file.mimeType || 'application/octet-stream' });
        form.append('snapinfile', blob, values.file);
        try {
          const payload = await client.postForm('snapin/createwithfile', form, {
            responseType: 'json', timeoutMs,
          });
          return normalizeSnapin(payload);
        } catch (error) {
          if ([404, 405].includes(error.status)) {
            throw new FogConflictError('This FOG server does not provide the Snapin multipart upload endpoint. Use an existing stored filename or install a compatible FOG API extension.');
          }
          throw error;
        }
      },
      async update(id, input) {
        const snapinId = assertPositiveId(id, 'Snapin');
        const values = validateSnapinDefinition(input);
        const [currentPayload, snapinsPayload, activePayload] = await Promise.all([
          getJson(client, `snapin/${snapinId}`),
          getJson(client, 'snapin'),
          getJson(client, 'snapintask/active'),
        ]);
        const current = normalizeSnapin(currentPayload);
        const snapins = normalizeCollection(snapinsPayload, 'snapins', normalizeSnapin);
        if (snapins.some((snapin) => snapin.id !== snapinId && snapin.name.toLowerCase() === values.name.toLowerCase())) {
          throw new FogValidationError('Check the Snapin definition fields.', {
            name: 'A Snapin with this name already exists.',
          });
        }
        if (rawCollection(activePayload, 'snapintasks').some((task) => sameId(task.snapinID ?? task.snapin?.id, snapinId))) {
          throw new FogConflictError(`The Snapin “${current.name || values.name}” cannot be edited while it has a queued or running Snapin task.`);
        }
        const payload = await client.put(`snapin/${snapinId}/edit`, {
          name: values.name,
          description: values.description,
          file: values.file,
          args: values.arguments,
          runWith: values.runWith,
          runWithArgs: values.runWithArguments,
          packtype: values.packageType,
          timeout: values.timeoutSeconds,
          protected: values.isProtected ? 1 : 0,
          isEnabled: values.isEnabled ? 1 : 0,
          toReplicate: values.replicates ? 1 : 0,
          hide: values.hidesArguments ? 1 : 0,
          reboot: values.postAction === 'reboot' ? 1 : 0,
          shutdown: values.postAction === 'shutdown' ? 1 : 0,
        }, { responseType: 'json' });
        return normalizeSnapin(payload);
      },
      async assignmentsForHost(id) {
        const hostId = assertPositiveId(id, 'Host');
        const [snapinsPayload, associationsPayload] = await Promise.all([
          getJson(client, 'snapin'),
          getJson(client, 'snapinassociation'),
        ]);
        const all = normalizeCollection(snapinsPayload, 'snapins', normalizeSnapin)
          .sort((left, right) => left.name.localeCompare(right.name));
        const assignedIds = new Set(rawCollection(associationsPayload, 'snapinassociations')
          .filter((association) => sameId(association.hostID, hostId))
          .map((association) => Number(association.snapinID)));
        return {
          all,
          assigned: all.filter((snapin) => assignedIds.has(snapin.id)),
          assignedIds,
        };
      },
      async forHost(id) {
        return (await this.assignmentsForHost(id)).assigned;
      },
      async updateAssignmentsForHost(id, requestedIds = []) {
        const hostId = assertPositiveId(id, 'Host');
        const snapinIds = positiveIdList(requestedIds, 'snapins');
        const [hostPayload, snapinsPayload, beforePayload] = await Promise.all([
          getJson(client, `host/${hostId}`),
          getJson(client, 'snapin'),
          getJson(client, 'snapinassociation'),
        ]);
        const host = normalizeHost(hostPayload);
        const snapins = normalizeCollection(snapinsPayload, 'snapins', normalizeSnapin);
        const validIds = new Set(snapins.map((snapin) => snapin.id));
        const invalidIds = snapinIds.filter((snapinId) => !validIds.has(snapinId));
        if (invalidIds.length) {
          throw new FogValidationError('One or more selected Snapins no longer exist.', {
            snapins: `Invalid Snapin IDs: ${invalidIds.join(', ')}`,
          });
        }
        const beforeIds = new Set(rawCollection(beforePayload, 'snapinassociations')
          .filter((association) => sameId(association.hostID, hostId))
          .map((association) => Number(association.snapinID)));
        await client.put(`host/${hostId}/edit`, { snapins: snapinIds }, { responseType: 'json' });
        const afterPayload = await getJson(client, 'snapinassociation');
        const afterIds = new Set(rawCollection(afterPayload, 'snapinassociations')
          .filter((association) => sameId(association.hostID, hostId))
          .map((association) => Number(association.snapinID)));
        const failedAdd = snapinIds.filter((snapinId) => !afterIds.has(snapinId));
        const failedRemove = [...beforeIds]
          .filter((snapinId) => !snapinIds.includes(snapinId) && afterIds.has(snapinId));
        if (failedAdd.length || failedRemove.length) {
          throw new FogConflictError(`FOG only partially updated Snapin assignments. Failed additions: ${failedAdd.join(', ') || 'none'}; failed removals: ${failedRemove.join(', ') || 'none'}.`);
        }
        return {
          host,
          assignedIds: [...afterIds],
          added: snapinIds.filter((snapinId) => !beforeIds.has(snapinId)),
          removed: [...beforeIds].filter((snapinId) => !afterIds.has(snapinId)),
        };
      },
    },
    printers: {
      async assignmentsForHost(id) {
        const hostId = assertPositiveId(id, 'Host');
        const [hostPayload, printersPayload, associationsPayload] = await Promise.all([
          getJson(client, `host/${hostId}`),
          getJson(client, 'printer'),
          getJson(client, 'printerassociation'),
        ]);
        const host = normalizeHost(hostPayload);
        const associations = rawCollection(associationsPayload, 'printerassociations')
          .filter((association) => sameId(association.hostID, hostId));
        const rawPrinters = rawCollection(printersPayload, 'printers');
        const all = rawPrinters.map((printer) => normalizePrinter(printer))
          .filter((printer) => printer.id !== null)
          .sort((left, right) => left.name.localeCompare(right.name));
        const assigned = associations.map((association) => {
          const printer = rawPrinters.find((item) => sameId(item.id, association.printerID)) || {};
          return normalizePrinter(printer, association);
        }).filter((printer) => printer.id !== null)
          .sort((left, right) => left.name.localeCompare(right.name));
        return {
          all,
          assigned,
          assignedIds: new Set(assigned.map((printer) => printer.id)),
          defaultId: assigned.find((printer) => printer.isDefault)?.id ?? 0,
          managementLevel: host.printerLevel ?? 0,
        };
      },
      async forHost(id) {
        return (await this.assignmentsForHost(id)).assigned;
      },
      async updateAssignmentsForHost(id, input = {}) {
        const hostId = assertPositiveId(id, 'Host');
        const printerIds = positiveIdList(input.printerIds || [], 'printers');
        const managementLevel = Number(input.managementLevel);
        const defaultId = Number(input.defaultId || 0);
        const fields = {};
        if (![0, 1, 2].includes(managementLevel)) {
          fields.managementLevel = 'Select a valid printer management level.';
        }
        if (!Number.isInteger(defaultId) || defaultId < 0) {
          fields.defaultId = 'Select a valid default printer.';
        } else if (defaultId !== 0 && !printerIds.includes(defaultId)) {
          fields.defaultId = 'The default printer must also be assigned to this computer.';
        }
        if (Object.keys(fields).length) {
          throw new FogValidationError('Check the printer assignment fields.', fields);
        }

        const [hostPayload, printersPayload, beforePayload] = await Promise.all([
          getJson(client, `host/${hostId}`),
          getJson(client, 'printer'),
          getJson(client, 'printerassociation'),
        ]);
        const host = normalizeHost(hostPayload);
        const printers = rawCollection(printersPayload, 'printers').map((printer) => normalizePrinter(printer));
        const validIds = new Set(printers.map((printer) => printer.id));
        const invalidIds = printerIds.filter((printerId) => !validIds.has(printerId));
        if (invalidIds.length) {
          throw new FogValidationError('One or more selected printers no longer exist.', {
            printers: `Invalid printer IDs: ${invalidIds.join(', ')}`,
          });
        }
        const beforeAssociations = rawCollection(beforePayload, 'printerassociations')
          .filter((association) => sameId(association.hostID, hostId));
        const beforeIds = new Set(beforeAssociations.map((association) => Number(association.printerID)));

        await client.put(`host/${hostId}/edit`, {
          printers: printerIds,
          printerLevel: managementLevel,
        }, { responseType: 'json' });

        let associationPayload = await getJson(client, 'printerassociation');
        let associations = rawCollection(associationPayload, 'printerassociations')
          .filter((association) => sameId(association.hostID, hostId));
        const assignedIds = new Set(associations.map((association) => Number(association.printerID)));
        const failedAdd = printerIds.filter((printerId) => !assignedIds.has(printerId));
        const failedRemove = [...beforeIds]
          .filter((printerId) => !printerIds.includes(printerId) && assignedIds.has(printerId));
        if (failedAdd.length || failedRemove.length) {
          throw new FogConflictError(`FOG only partially updated printer assignments. Failed additions: ${failedAdd.join(', ') || 'none'}; failed removals: ${failedRemove.join(', ') || 'none'}.`);
        }

        const defaultChanges = associations
          .filter((association) => Boolean(Number(association.isDefault)) !== (Number(association.printerID) === defaultId))
          .sort((left, right) => Number(Number(left.printerID) === defaultId) - Number(Number(right.printerID) === defaultId));
        let defaultWriteError = null;
        for (const association of defaultChanges) {
          try {
            await client.put(`printerassociation/${assertPositiveId(association.id, 'Printer association')}/edit`, {
              isDefault: Number(association.printerID) === defaultId ? 1 : 0,
            }, { responseType: 'json' });
          } catch (error) {
            defaultWriteError = error;
            break;
          }
        }

        const [finalHostPayload, finalAssociationPayload] = await Promise.all([
          getJson(client, `host/${hostId}`),
          getJson(client, 'printerassociation'),
        ]);
        const finalHost = normalizeHost(finalHostPayload);
        associationPayload = finalAssociationPayload;
        associations = rawCollection(associationPayload, 'printerassociations')
          .filter((association) => sameId(association.hostID, hostId));
        const finalDefaultIds = associations
          .filter((association) => Boolean(Number(association.isDefault)))
          .map((association) => Number(association.printerID));
        const defaultVerified = defaultId === 0
          ? finalDefaultIds.length === 0
          : finalDefaultIds.length === 1 && finalDefaultIds[0] === defaultId;
        if (defaultWriteError || !defaultVerified || finalHost.printerLevel !== managementLevel) {
          throw new FogConflictError(`FOG only partially updated printer settings. Assignments were saved, but ${!defaultVerified ? 'the default printer' : 'the management level'} could not be verified.`);
        }
        return {
          host,
          assignedIds: printerIds,
          defaultId,
          managementLevel,
          added: printerIds.filter((printerId) => !beforeIds.has(printerId)),
          removed: [...beforeIds].filter((printerId) => !assignedIds.has(printerId)),
        };
      },
    },
    clientServices: {
      async configurationForHost(id) {
        const hostId = assertPositiveId(id, 'Host');
        const [modulesPayload, associationsPayload] = await Promise.all([
          getJson(client, 'module'),
          getJson(client, 'moduleassociation'),
        ]);
        const associations = rawCollection(associationsPayload, 'moduleassociations')
          .filter((association) => sameId(association.hostID, hostId));
        const rawModules = rawCollection(modulesPayload, 'modules');
        const normalizedModules = rawModules.map((module) => normalizeClientModule(module));
        let statuses = new Map();
        let globalStatusAvailable = true;
        try {
          statuses = await globalModuleStatuses(client, normalizedModules);
        } catch {
          globalStatusAvailable = false;
        }
        const all = rawModules.map((module) => {
          const normalized = normalizeClientModule(module);
          const association = associations.find((item) => sameId(item.moduleID, normalized.id)) || {};
          const settingName = MODULE_GLOBAL_SETTINGS[normalized.shortName];
          const globallyEnabled = globalStatusAvailable && settingName
            ? statuses.get(settingName) === true
            : null;
          return normalizeClientModule(module, association, globallyEnabled);
        }).filter((module) => module.id !== null)
          .sort((left, right) => left.name.localeCompare(right.name));
        return {
          all,
          enabledIds: new Set(all.filter((module) => module.isEnabled).map((module) => module.id)),
          globalStatusAvailable,
        };
      },
      async forHost(id) {
        return (await this.configurationForHost(id)).all;
      },
      async updateForHost(id, requestedIds = []) {
        const hostId = assertPositiveId(id, 'Host');
        const moduleIds = positiveIdList(requestedIds, 'modules');
        const configuration = await this.configurationForHost(hostId);
        if (!configuration.globalStatusAvailable) {
          throw new FogConflictError('Global FOG Client module status is unavailable, so module settings cannot be changed safely.');
        }
        const validIds = new Set(configuration.all.map((module) => module.id));
        const invalidIds = moduleIds.filter((moduleId) => !validIds.has(moduleId));
        if (invalidIds.length) {
          throw new FogValidationError('One or more selected client modules no longer exist.', {
            modules: `Invalid module IDs: ${invalidIds.join(', ')}`,
          });
        }
        const globallyDisabled = configuration.all
          .filter((module) => moduleIds.includes(module.id) && module.globallyEnabled !== true);
        if (globallyDisabled.length) {
          throw new FogValidationError('Globally disabled modules cannot be enabled for a computer.', {
            modules: `Unavailable modules: ${globallyDisabled.map((module) => module.name).join(', ')}`,
          });
        }
        const beforeIds = configuration.enabledIds;
        const preservedUnavailableIds = configuration.all
          .filter((module) => module.isEnabled && module.globallyEnabled !== true)
          .map((module) => module.id);
        const effectiveIds = [...new Set([...moduleIds, ...preservedUnavailableIds])];
        await client.put(`host/${hostId}/edit`, { modules: effectiveIds }, { responseType: 'json' });
        const afterPayload = await getJson(client, 'moduleassociation');
        const afterIds = new Set(rawCollection(afterPayload, 'moduleassociations')
          .filter((association) => sameId(association.hostID, hostId) && settingBoolean(association.state))
          .map((association) => Number(association.moduleID)));
        const failedAdd = effectiveIds.filter((moduleId) => !afterIds.has(moduleId));
        const failedRemove = [...beforeIds]
          .filter((moduleId) => !effectiveIds.includes(moduleId) && afterIds.has(moduleId));
        if (failedAdd.length || failedRemove.length) {
          throw new FogConflictError(`FOG only partially updated client modules. Failed additions: ${failedAdd.join(', ') || 'none'}; failed removals: ${failedRemove.join(', ') || 'none'}.`);
        }
        return {
          enabledIds: [...afterIds],
          added: effectiveIds.filter((moduleId) => !beforeIds.has(moduleId)),
          removed: [...beforeIds].filter((moduleId) => !afterIds.has(moduleId)),
        };
      },
    },
    power: {
      async forHost(id) {
        const hostId = assertPositiveId(id, 'Host');
        const payload = await getJson(client, 'powermanagement');
        return rawCollection(payload, 'powermanagements')
          .filter((schedule) => sameId(schedule.hostID, hostId))
          .map(normalizePowerSchedule);
      },
    },
    history: {
      async forHost({ id, macs = [] }) {
        const hostId = assertPositiveId(id, 'Host');
        const [loginPayload, imagingPayload, jobsPayload, tasksPayload, virusPayload] = await Promise.all([
          getJson(client, 'usertracking'),
          getJson(client, 'imaginglog'),
          getJson(client, 'snapinjob'),
          getJson(client, 'snapintask'),
          getJson(client, 'virus'),
        ]);
        const loginEvents = rawCollection(loginPayload, 'usertrackings')
          .filter((event) => sameId(event.hostID, hostId))
          .map(normalizeLoginEvent);
        const imagingEvents = rawCollection(imagingPayload, 'imaginglogs')
          .filter((event) => sameId(event.hostID, hostId))
          .map(normalizeImagingLog);
        const snapinJobs = rawCollection(jobsPayload, 'snapinjobs')
          .filter((job) => sameId(job.hostID, hostId))
          .map(normalizeSnapinJob);
        const jobIds = new Set(snapinJobs.map((job) => job.id));
        const snapinTasks = rawCollection(tasksPayload, 'snapintasks')
          .filter((task) => jobIds.has(Number(task.jobID)))
          .map(normalizeSnapinTask);
        const knownMacs = new Set(macs.map(canonicalMac).filter(Boolean));
        const virusEvents = rawCollection(virusPayload, 'viruss')
          .filter((event) => knownMacs.has(canonicalMac(event.mac)))
          .map(normalizeVirusEvent);
        return {
          logins: newestFirst(loginEvents, 'occurredAt'),
          imaging: newestFirst(imagingEvents, 'startedAt'),
          snapinJobs: newestFirst(snapinJobs, 'createdAt'),
          snapinTasks: newestFirst(snapinTasks, 'completedAt'),
          viruses: newestFirst(virusEvents, 'occurredAt'),
        };
      },
    },
    tasks: {
      async list() {
        const payload = await getJson(client, 'task');
        return normalizeCollection(payload, 'tasks', normalizeTask);
      },
      async listActive() {
        const payload = await getJson(client, 'task/active');
        return normalizeCollection(payload, 'tasks', normalizeTask);
      },
      async forHost(id, { activeOnly = false } = {}) {
        const hostId = assertPositiveId(id, 'Host');
        const payload = await getJson(client, activeOnly ? 'task/active' : 'task');
        return normalizeCollection(payload, 'tasks', normalizeTask)
          .filter((task) => task.host.id === hostId);
      },
      async createForHost(id, action, options = {}) {
        const hostId = assertPositiveId(id, 'Host');
        const isWipe = action === 'wipe';
        if ((!Object.hasOwn(HOST_TASK_TYPES, action) && !isWipe) || action === 'deployWithoutSnapins') {
          throw new FogValidationError('Select a supported task action.', { action: 'Unsupported task action.' });
        }
        const wipeMode = isWipe ? String(options.wipeMode || '') : '';
        if (isWipe && !Object.hasOwn(WIPE_TASK_TYPES, wipeMode)) {
          throw new FogValidationError('Select a supported disk wipe method.', {
            wipeMode: 'Choose Fast, Normal, or Full wipe.',
          });
        }
        const passwordResetAccount = action === 'password-reset'
          ? validatePasswordResetAccount(options.account)
          : null;
        const isImaging = action === 'deploy' || action === 'capture';
        const isDiagnostic = DIAGNOSTIC_TASK_ACTIONS.has(action) || isWipe;
        const [hostPayload, activePayload, imagesPayload, taskTypesPayload] = await Promise.all([
          getJson(client, `host/${hostId}`),
          getJson(client, 'task/active'),
          isImaging ? getJson(client, 'image') : Promise.resolve(null),
          isDiagnostic ? getJson(client, 'tasktype') : Promise.resolve(null),
        ]);
        const host = normalizeHost(hostPayload);
        const activeTasks = normalizeCollection(activePayload, 'tasks', normalizeTask)
          .filter((task) => task.host.id === hostId);
        if (activeTasks.length) {
          throw new FogConflictError(`${host.name || 'This computer'} already has an active task.`);
        }
        if (isWipe && String(options.targetConfirmation || '').trim() !== host.name) {
          throw new FogValidationError('Type the computer hostname exactly to authorize this disk wipe.', {
            targetConfirmation: `Type ${host.name} exactly.`,
          });
        }

        let taskTypeID = isWipe ? WIPE_TASK_TYPES[wipeMode] : HOST_TASK_TYPES[action];
        const taskDisplayName = isWipe
          ? `${wipeMode[0].toUpperCase()}${wipeMode.slice(1)} Wipe`
          : HOST_TASK_NAMES[action];
        const body = {
          taskTypeID,
          taskName: `Foggy ${taskDisplayName}`,
        };
        if (action === 'wake') {
          body.wol = true;
        } else if (isDiagnostic) {
          const taskTypeExists = rawCollection(taskTypesPayload, 'tasktypes')
            .some((taskType) => sameId(taskType.id, taskTypeID));
          if (!taskTypeExists) {
            throw new FogConflictError(`FOG task type ${taskTypeID} is unavailable on this server.`);
          }
          body.wol = options.wake === true;
          if (action === 'debug') body.debug = true;
          if (action === 'password-reset') body.passreset = passwordResetAccount;
        } else {
          const image = normalizeCollection(imagesPayload, 'images', normalizeImage)
            .find((item) => item.id === host.imageId);
          if (!image || !image.isEnabled) {
            throw new FogConflictError('Assign an enabled image before creating this imaging task.');
          }
          if (action === 'capture' && image.isProtected) {
            throw new FogConflictError(`The image “${image.name}” is protected and cannot be captured over.`);
          }
          body.shutdown = options.shutdown === true;
          body.wol = options.wake === true;
          if (action === 'deploy') {
            if (options.includeSnapins === false) {
              taskTypeID = HOST_TASK_TYPES.deployWithoutSnapins;
              body.taskTypeID = taskTypeID;
            } else {
              body.deploySnapins = true;
            }
          }
        }
        await client.post(`host/${hostId}/task`, body, { responseType: 'json' });
        return { hostId, action, taskTypeId: taskTypeID };
      },
      async runSnapins(id, requestedSnapin = 'all') {
        const hostId = assertPositiveId(id, 'Host');
        const [hostPayload, snapinsPayload, associationsPayload, activePayload] = await Promise.all([
          getJson(client, `host/${hostId}`),
          getJson(client, 'snapin'),
          getJson(client, 'snapinassociation'),
          getJson(client, 'task/active'),
        ]);
        const host = normalizeHost(hostPayload);
        const activeTasks = normalizeCollection(activePayload, 'tasks', normalizeTask)
          .filter((task) => task.host.id === hostId);
        if (activeTasks.length) {
          throw new FogConflictError(`${host.name || 'This computer'} already has an active task.`);
        }
        const assignedIds = new Set(rawCollection(associationsPayload, 'snapinassociations')
          .filter((association) => sameId(association.hostID, hostId))
          .map((association) => Number(association.snapinID)));
        const assignedSnapins = normalizeCollection(snapinsPayload, 'snapins', normalizeSnapin)
          .filter((snapin) => assignedIds.has(snapin.id) && snapin.isEnabled);
        if (!assignedSnapins.length) {
          throw new FogConflictError('This computer has no enabled Snapins assigned.');
        }

        let taskTypeID = 12;
        let deploySnapins = true;
        let snapinNames = assignedSnapins.map((snapin) => snapin.name);
        if (requestedSnapin !== 'all') {
          const snapinId = assertPositiveId(requestedSnapin, 'Snapin');
          const snapin = assignedSnapins.find((item) => item.id === snapinId);
          if (!snapin) {
            throw new FogValidationError('The selected Snapin is not enabled and assigned to this computer.', {
              snapin: 'Choose an assigned Snapin.',
            });
          }
          taskTypeID = 13;
          deploySnapins = snapin.id;
          snapinNames = [snapin.name];
        }
        await client.post(`host/${hostId}/task`, {
          taskTypeID,
          taskName: taskTypeID === 12 ? 'Foggy All Snapins' : 'Foggy Single Snapin',
          deploySnapins,
        }, { responseType: 'json' });
        return { hostId, taskTypeId: taskTypeID, snapinNames };
      },
      async cancelForHost(id) {
        const hostId = assertPositiveId(id, 'Host');
        const activePayload = await getJson(client, 'task/active');
        const activeTasks = normalizeCollection(activePayload, 'tasks', normalizeTask)
          .filter((task) => task.host.id === hostId);
        if (!activeTasks.length) {
          throw new FogConflictError('This computer no longer has an active task to cancel.');
        }
        await client.delete(`host/${hostId}/cancel`, { responseType: 'json' });
        return { hostId, cancelledTaskIds: activeTasks.map((task) => task.id) };
      },
    },
    multicast: {
      async listActive() {
        const payload = await getJson(client, 'multicastsession/current');
        return normalizeCollection(payload, 'multicastsessions', normalizeMulticastSession);
      },
    },
  };
}
