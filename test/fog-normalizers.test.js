import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeHost,
  normalizeImage,
  normalizeLoginEvent,
  normalizeSnapinTask,
  normalizeTask,
} from '../src/fog/normalizers.js';

test('image normalization retains editable identifiers without raw response fields', () => {
  const image = normalizeImage({
    id: 4, name: 'Windows 11', osID: 5, imageTypeID: 1, imagePartitionTypeID: 1,
    format: '5', compress: '6', createdBy: 'fog', protected: 1, isEnabled: '1',
    os: { id: 5, name: 'Windows 11' }, imagetype: { id: 1, name: 'Resizable' },
  });
  assert.equal(image.osId, 5);
  assert.equal(image.imageTypeId, 1);
  assert.equal(image.partitionTypeId, 1);
  assert.equal(image.format, 5);
  assert.equal(image.compression, 6);
  assert.equal(image.createdBy, 'fog');
  assert.equal(Object.hasOwn(image, 'os'), false);
});

test('host normalization allowlists fields and removes upstream secrets', () => {
  const host = normalizeHost({
    id: '7',
    name: 'BUILD-07',
    primac: '00:11:22:33:44:55',
    imageID: '3',
    imagename: 'Windows 11',
    useAD: '1',
    ADDomain: 'example.test',
    ADOU: 'OU=Computers,DC=example,DC=test',
    ADUser: 'join-account',
    enforce: '1',
    ADPass: 'decrypted-password',
    productKey: 'AAAAA-BBBBB-CCCCC-DDDDD-EEEEE',
    sec_tok: 'client-secret',
    inventory: {
      sysman: 'Dell Inc.',
      sysproduct: 'OptiPlex 7090',
      sysserial: 'SERIAL123',
    },
  });

  assert.equal(host.id, 7);
  assert.equal(host.name, 'BUILD-07');
  assert.equal(host.manufacturer, 'Dell Inc.');
  assert.equal(host.inventory.system.serial, 'SERIAL123');
  assert.equal(host.imageName, 'Windows 11');
  assert.deepEqual(host.activeDirectory, {
    enabled: true,
    domain: 'example.test',
    organizationalUnit: 'OU=Computers,DC=example,DC=test',
    username: 'join-account',
    enforce: true,
  });
  assert.equal(Object.hasOwn(host, 'ADPass'), false);
  assert.equal(Object.hasOwn(host.activeDirectory, 'password'), false);
  assert.equal(Object.hasOwn(host, 'productKey'), false);
  assert.equal(Object.hasOwn(host, 'sec_tok'), false);
});

test('history normalizers retain operational fields without nested host payloads', () => {
  const login = normalizeLoginEvent({
    id: '4', hostID: '7', username: 'jsmith', action: '1', datetime: '2026-08-27 10:00:00',
    host: { id: 7, ADPass: 'secret' },
  });
  const snapin = normalizeSnapinTask({
    id: '8', jobID: '5', return: '0', details: 'Done',
    snapin: { id: '2', name: 'Install Agent', file: 'sensitive-path.exe' },
    snapinjob: { host: { ADPass: 'secret' } },
  });

  assert.deepEqual(login, {
    id: 4, hostId: 7, username: 'jsmith', action: 1, actionLabel: 'Login',
    occurredAt: '2026-08-27 10:00:00', date: '', description: '',
  });
  assert.equal(snapin.snapin.name, 'Install Agent');
  assert.equal(snapin.returnCode, 0);
  assert.equal(Object.hasOwn(snapin, 'snapinjob'), false);
});

test('nested task hosts receive the same secret-removing normalization', () => {
  const task = normalizeTask({
    id: '9',
    pct: '42',
    host: { id: '7', name: 'BUILD-07', ADPass: 'secret' },
    image: { id: '3', name: 'Windows 11' },
    type: { id: '1', name: 'Deploy' },
    state: { id: '3', name: 'In Progress' },
  });

  assert.equal(task.progress, 42);
  assert.equal(task.category, 'running');
  assert.equal(task.host.name, 'BUILD-07');
  assert.equal(Object.hasOwn(task.host, 'ADPass'), false);
});

test('host ping status converts FOG presentation HTML into a plain semantic label', () => {
  const host = normalizeHost({
    id: '1',
    name: 'BIOS-PC1',
    pingstatuscode: '113',
    pingstatus: '<i class="icon-ping-down fa fa-exclamation-circle red" data-toggle="tooltip" title="Unknown"></i>',
  });

  assert.equal(host.status, 'Unknown');
  assert.equal(host.statusTone, 'neutral');
  assert.equal(host.status.includes('<'), false);
});

test('host ping codes distinguish Windows, Linux, and FOS without exposing markup', () => {
  const windows = normalizeHost({ pingstatuscode: 0, pingstatus: '<i title="Windows"></i>' });
  const linux = normalizeHost({ pingstatuscode: 111, pingstatus: '<i title="Linux"></i>' });
  const fos = normalizeHost({ pingstatuscode: 111, pingstatus: '<i title="FOS"></i>' });

  assert.deepEqual([windows.status, windows.statusTone], ['Windows', 'success']);
  assert.deepEqual([linux.status, linux.statusTone], ['Linux', 'info']);
  assert.deepEqual([fos.status, fos.statusTone], ['FOS', 'info']);
});
