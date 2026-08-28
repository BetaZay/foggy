function numberOrNull(value) {
  if (value === '' || value === null || value === undefined) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function stringOrEmpty(value) {
  return typeof value === 'string' ? value : '';
}

function booleanValue(value) {
  return value === true || value === 1 || value === '1';
}

function pingStatus(host) {
  const code = numberOrNull(host.pingstatuscode);
  const markup = stringOrEmpty(host.pingstatus);
  const title = markup.match(/\btitle=["']([^"']+)["']/i)?.[1];

  if (code === 0) return { label: 'Windows', tone: 'success' };
  if (code === 111) {
    const label = ['Linux', 'FOS'].includes(title) ? title : 'Linux';
    return { label, tone: 'info' };
  }
  return { label: title || 'Unknown', tone: 'neutral' };
}

export function normalizeHost(host = {}) {
  const inventory = host.inventory && typeof host.inventory === 'object'
    ? host.inventory
    : {};

  const status = pingStatus(host);

  return {
    id: numberOrNull(host.id),
    name: stringOrEmpty(host.name),
    description: stringOrEmpty(host.description),
    primaryMac: stringOrEmpty(host.primac),
    macs: Array.isArray(host.macs) ? host.macs.map(String) : [],
    imageId: numberOrNull(host.imageID),
    imageName: stringOrEmpty(host.imagename || host.image?.name),
    imageEnabled: booleanValue(host.image?.isEnabled),
    imageProtected: booleanValue(host.image?.protected),
    kernel: stringOrEmpty(host.kernel),
    kernelArgs: stringOrEmpty(host.kernelArgs),
    kernelDevice: stringOrEmpty(host.kernelDevice),
    init: stringOrEmpty(host.init),
    biosExit: stringOrEmpty(host.biosexit),
    efiExit: stringOrEmpty(host.efiexit),
    activeDirectory: {
      enabled: booleanValue(host.useAD),
      domain: stringOrEmpty(host.ADDomain),
      organizationalUnit: stringOrEmpty(host.ADOU),
      username: stringOrEmpty(host.ADUser),
      enforce: booleanValue(host.enforce),
    },
    printerLevel: numberOrNull(host.printerLevel),
    manufacturer: stringOrEmpty(inventory.sysman),
    model: stringOrEmpty(inventory.sysproduct),
    serialNumber: stringOrEmpty(inventory.sysserial),
    inventory: normalizeInventory(inventory),
    screen: {
      width: numberOrNull(host.hostscreen?.width),
      height: numberOrNull(host.hostscreen?.height),
      refresh: numberOrNull(host.hostscreen?.refresh),
      orientation: numberOrNull(host.hostscreen?.orientation),
    },
    autoLogoffMinutes: numberOrNull(host.hostalo?.time),
    createdAt: stringOrEmpty(host.createdTime),
    lastDeployedAt: stringOrEmpty(host.deployed),
    status: status.label,
    statusTone: status.tone,
    statusCode: numberOrNull(host.pingstatuscode),
  };
}

export function normalizeInventory(inventory = {}) {
  return {
    id: numberOrNull(inventory.id),
    hostId: numberOrNull(inventory.hostID),
    primaryUser: stringOrEmpty(inventory.primaryUser),
    assetTag: stringOrEmpty(inventory.other1),
    alternateTag: stringOrEmpty(inventory.other2),
    collectedAt: stringOrEmpty(inventory.createdTime),
    system: {
      manufacturer: stringOrEmpty(inventory.sysman),
      product: stringOrEmpty(inventory.sysproduct),
      version: stringOrEmpty(inventory.sysversion),
      serial: stringOrEmpty(inventory.sysserial),
      uuid: stringOrEmpty(inventory.sysuuid),
      type: stringOrEmpty(inventory.systype),
    },
    bios: {
      vendor: stringOrEmpty(inventory.biosvendor),
      version: stringOrEmpty(inventory.biosversion),
      date: stringOrEmpty(inventory.biosdate),
    },
    motherboard: {
      manufacturer: stringOrEmpty(inventory.mbman),
      product: stringOrEmpty(inventory.mbproductname),
      version: stringOrEmpty(inventory.mbversion),
      serial: stringOrEmpty(inventory.mbserial),
      assetTag: stringOrEmpty(inventory.mbasset),
    },
    processor: {
      manufacturer: stringOrEmpty(inventory.cpuman),
      version: stringOrEmpty(inventory.cpuversion),
      currentMhz: numberOrNull(inventory.cpucurrent),
      maxMhz: numberOrNull(inventory.cpumax),
    },
    memory: stringOrEmpty(inventory.memory || inventory.mem),
    disk: {
      model: stringOrEmpty(inventory.hdmodel),
      serial: stringOrEmpty(inventory.hdserial),
      firmware: stringOrEmpty(inventory.hdfirmware),
    },
    chassis: {
      manufacturer: stringOrEmpty(inventory.caseman),
      version: stringOrEmpty(inventory.casever),
      serial: stringOrEmpty(inventory.caseserial),
      assetTag: stringOrEmpty(inventory.caseasset),
    },
    graphics: {
      vendors: stringOrEmpty(inventory.gpuvendors),
      products: stringOrEmpty(inventory.gpuproducts),
    },
  };
}

export function normalizeImage(image = {}) {
  return {
    id: numberOrNull(image.id),
    name: stringOrEmpty(image.name),
    description: stringOrEmpty(image.description),
    path: stringOrEmpty(image.path),
    osId: numberOrNull(image.osID),
    imageTypeId: numberOrNull(image.imageTypeID),
    partitionTypeId: numberOrNull(image.imagePartitionTypeID),
    size: numberOrNull(image.srvsize ?? image.size),
    clientSize: numberOrNull(image.size),
    imageType: stringOrEmpty(image.imagetypename || image.imagetype?.name),
    partitionType: stringOrEmpty(image.imageparttypename || image.imagepartitiontype?.name),
    operatingSystem: stringOrEmpty(image.osname || image.os?.name),
    storageGroup: stringOrEmpty(image.storagegroupname),
    createdAt: stringOrEmpty(image.createdTime),
    createdBy: stringOrEmpty(image.createdBy),
    lastDeployedAt: stringOrEmpty(image.deployed),
    format: numberOrNull(image.format),
    compression: numberOrNull(image.compress),
    isProtected: Boolean(Number(image.protected)),
    isEnabled: Boolean(Number(image.isEnabled)),
    replicates: Boolean(Number(image.toReplicate)),
  };
}

export function normalizeGroup(group = {}) {
  return {
    id: numberOrNull(group.id),
    name: stringOrEmpty(group.name),
    description: stringOrEmpty(group.description),
    hostCount: numberOrNull(group.hostcount) ?? 0,
    building: stringOrEmpty(group.building),
    createdAt: stringOrEmpty(group.createdTime),
    createdBy: stringOrEmpty(group.createdBy),
  };
}

export function normalizeLookup(item = {}) {
  return {
    id: numberOrNull(item.id),
    name: stringOrEmpty(item.name),
    description: stringOrEmpty(item.description),
    type: stringOrEmpty(item.type),
  };
}

export function normalizeStorageGroup(group = {}) {
  return {
    id: numberOrNull(group.id),
    name: stringOrEmpty(group.name),
    description: stringOrEmpty(group.description),
    enabledNodeIds: Array.isArray(group.enablednodes) ? group.enablednodes.map(Number).filter(Number.isInteger) : [],
    totalSupportedClients: numberOrNull(group.totalsupportedclients),
  };
}

export function normalizeSnapin(snapin = {}) {
  return {
    id: numberOrNull(snapin.id),
    name: stringOrEmpty(snapin.name),
    description: stringOrEmpty(snapin.description),
    file: stringOrEmpty(snapin.file),
    arguments: stringOrEmpty(snapin.args),
    runWith: stringOrEmpty(snapin.runWith),
    runWithArguments: stringOrEmpty(snapin.runWithArgs),
    packageType: numberOrNull(snapin.packtype) ?? 0,
    timeoutSeconds: numberOrNull(snapin.timeout),
    size: numberOrNull(snapin.size),
    storageGroup: stringOrEmpty(snapin.storagegroupname),
    createdAt: stringOrEmpty(snapin.createdTime),
    createdBy: stringOrEmpty(snapin.createdBy),
    hash: stringOrEmpty(snapin.hash),
    hidesArguments: booleanValue(snapin.hide),
    isProtected: booleanValue(snapin.protected),
    replicates: booleanValue(snapin.toReplicate),
    isEnabled: booleanValue(snapin.isEnabled),
    reboot: booleanValue(snapin.reboot),
    shutdown: booleanValue(snapin.shutdown),
  };
}

export function normalizePrinter(printer = {}, association = {}) {
  return {
    id: numberOrNull(printer.id),
    name: stringOrEmpty(printer.name),
    description: stringOrEmpty(printer.description),
    model: stringOrEmpty(printer.model),
    ip: stringOrEmpty(printer.ip),
    port: stringOrEmpty(printer.port),
    isDefault: booleanValue(association.isDefault),
  };
}

export function normalizeClientModule(module = {}, association = {}, globallyEnabled = null) {
  return {
    id: numberOrNull(module.id),
    name: stringOrEmpty(module.name),
    shortName: stringOrEmpty(module.shortName),
    description: stringOrEmpty(module.description),
    isDefault: booleanValue(module.isDefault),
    isEnabled: booleanValue(association.state),
    globallyEnabled,
  };
}

export function normalizePowerSchedule(schedule = {}) {
  return {
    id: numberOrNull(schedule.id),
    hostId: numberOrNull(schedule.hostID),
    minute: stringOrEmpty(schedule.min),
    hour: stringOrEmpty(schedule.hour),
    dayOfMonth: stringOrEmpty(schedule.dom),
    month: stringOrEmpty(schedule.month),
    dayOfWeek: stringOrEmpty(schedule.dow),
    onDemand: booleanValue(schedule.onDemand),
    action: stringOrEmpty(schedule.action),
  };
}

export function normalizeLoginEvent(event = {}) {
  const action = numberOrNull(event.action);
  return {
    id: numberOrNull(event.id),
    hostId: numberOrNull(event.hostID),
    username: stringOrEmpty(event.username),
    action,
    actionLabel: action !== null && action > 0 ? 'Login' : 'Logout',
    occurredAt: stringOrEmpty(event.datetime),
    date: stringOrEmpty(event.date),
    description: stringOrEmpty(event.description),
  };
}

export function normalizeImagingLog(log = {}) {
  return {
    id: numberOrNull(log.id),
    hostId: numberOrNull(log.hostID),
    startedAt: stringOrEmpty(log.start),
    finishedAt: stringOrEmpty(log.finish),
    imageName: stringOrEmpty(log.image),
    type: stringOrEmpty(log.type),
    createdBy: stringOrEmpty(log.createdBy),
  };
}

export function normalizeSnapinJob(job = {}) {
  return {
    id: numberOrNull(job.id),
    hostId: numberOrNull(job.hostID),
    state: {
      id: numberOrNull(job.state?.id ?? job.stateID),
      name: stringOrEmpty(job.state?.name),
    },
    createdAt: stringOrEmpty(job.createdTime),
  };
}

export function normalizeSnapinTask(task = {}) {
  return {
    id: numberOrNull(task.id),
    jobId: numberOrNull(task.jobID),
    snapin: {
      id: numberOrNull(task.snapin?.id ?? task.snapinID),
      name: stringOrEmpty(task.snapin?.name),
    },
    state: {
      id: numberOrNull(task.state?.id ?? task.stateID),
      name: stringOrEmpty(task.state?.name),
    },
    checkedInAt: stringOrEmpty(task.checkin),
    completedAt: stringOrEmpty(task.complete),
    returnCode: numberOrNull(task.return),
    details: stringOrEmpty(task.details),
  };
}

export function normalizeVirusEvent(event = {}) {
  return {
    id: numberOrNull(event.id),
    name: stringOrEmpty(event.name),
    mac: stringOrEmpty(event.mac),
    file: stringOrEmpty(event.file),
    occurredAt: stringOrEmpty(event.date),
    mode: stringOrEmpty(event.mode),
  };
}

export function normalizeTask(task = {}) {
  const stateId = numberOrNull(task.state?.id ?? task.stateID);
  const stateName = stringOrEmpty(task.state?.name);
  const normalizedState = stateName.toLowerCase();
  let category = 'other';
  if (normalizedState.includes('fail') || normalizedState.includes('error')) category = 'failed';
  else if (stateId === 1 || stateId === 2 || normalizedState.includes('queue') || normalizedState.includes('checked')) category = 'queued';
  else if (stateId === 3 || normalizedState.includes('progress') || normalizedState.includes('running')) category = 'running';
  else if (stateId === 4 || normalizedState.includes('complete') || normalizedState.includes('success')) category = 'completed';
  else if (stateId === 5 || normalizedState.includes('cancel') || normalizedState.includes('abort')) category = 'cancelled';
  return {
    id: numberOrNull(task.id),
    name: stringOrEmpty(task.name),
    host: normalizeHost(task.host || {}),
    image: task.image && typeof task.image === 'object'
      ? { id: numberOrNull(task.image.id), name: stringOrEmpty(task.image.name) }
      : { id: numberOrNull(task.imageID), name: '' },
    type: {
      id: numberOrNull(task.type?.id ?? task.typeID),
      name: stringOrEmpty(task.type?.name),
    },
    state: {
      id: stateId,
      name: stateName,
    },
    category,
    createdAt: stringOrEmpty(task.createdTime),
    checkedInAt: stringOrEmpty(task.checkInTime),
    scheduledFor: stringOrEmpty(task.scheduledStartTime),
    progress: Math.max(0, Math.min(100, numberOrNull(task.pct) ?? 0)),
    progressText: stringOrEmpty(task.percent),
    bytesPerMinute: numberOrNull(task.bpm),
    elapsed: stringOrEmpty(task.timeElapsed),
    remaining: stringOrEmpty(task.timeRemaining),
    dataCopied: stringOrEmpty(task.dataCopied),
    dataTotal: stringOrEmpty(task.dataTotal),
    storageNode: stringOrEmpty(task.storagenode?.name),
    storageGroup: stringOrEmpty(task.storagegroup?.name),
  };
}

export function normalizeMulticastSession(session = {}) {
  const stateId = numberOrNull(session.state?.id ?? session.stateID);
  const stateName = stringOrEmpty(session.state?.name);
  const normalizedState = stateName.toLowerCase();
  let category = 'other';
  if (stateId === 1 || stateId === 2 || normalizedState.includes('queue') || normalizedState.includes('checked')) category = 'queued';
  else if (stateId === 3 || normalizedState.includes('progress') || normalizedState.includes('running')) category = 'running';
  else if (stateId === 4 || normalizedState.includes('complete')) category = 'completed';
  else if (stateId === 5 || normalizedState.includes('cancel')) category = 'cancelled';
  return {
    id: numberOrNull(session.id),
    name: stringOrEmpty(session.name),
    image: session.image && typeof session.image === 'object'
      ? { id: numberOrNull(session.image.id), name: stringOrEmpty(session.image.name) }
      : { id: numberOrNull(session.imageID ?? session.image), name: '' },
    state: { id: stateId, name: stateName },
    category,
    progress: Math.max(0, Math.min(100, numberOrNull(session.percent) ?? 0)),
    clientCount: numberOrNull(session.sessclients) ?? numberOrNull(session.clients) ?? 0,
    startedAt: stringOrEmpty(session.starttime),
    completedAt: stringOrEmpty(session.completetime),
    storageGroupId: numberOrNull(session.storagegroupID),
  };
}

export function normalizeCollection(payload, key, normalizer) {
  const values = Array.isArray(payload?.[key]) ? payload[key] : [];
  return values.map(normalizer);
}
