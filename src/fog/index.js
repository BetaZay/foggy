import { FogClient } from './client.js';
import { FogNotConfiguredError } from './errors.js';
import { createResources } from './resources.js';

function unavailableResources(setupRequired = false) {
  const reject = async () => { throw new FogNotConfiguredError(setupRequired); };
  return {
    system: { status: reject },
    hosts: { list: reject, get: reject, update: reject, updateActiveDirectory: reject, activeDirectoryDefaults: reject },
    inventory: { updateForHost: reject },
    images: { list: reject, get: reject, details: reject, lookups: reject, create: reject, update: reject },
    deployments: { create: reject },
    captures: { create: reject },
    groups: { list: reject, get: reject, create: reject, update: reject, remove: reject, members: reject, updateMembers: reject, forHost: reject },
    snapins: { list: reject, get: reject, lookups: reject, create: reject, createWithFile: reject, update: reject, assignmentsForHost: reject, forHost: reject, updateAssignmentsForHost: reject },
    printers: { assignmentsForHost: reject, forHost: reject, updateAssignmentsForHost: reject },
    clientServices: { configurationForHost: reject, forHost: reject, updateForHost: reject },
    power: { forHost: reject },
    history: { forHost: reject },
    tasks: { list: reject, listActive: reject, forHost: reject, createForHost: reject, runSnapins: reject, cancelForHost: reject },
  };
}

export function createFog(config) {
  if (!config.configured) return unavailableResources(config.setupRequired);
  return createResources(new FogClient(config));
}
