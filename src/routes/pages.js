import os from 'node:os';
import { promises as fs } from 'node:fs';
import { Router } from 'express';
import multer from 'multer';
import { taskTone } from '../lib/format.js';
import { requireCsrf, requireSameOrigin } from '../auth/security.js';
import { env } from '../config/env.js';

const snapinUpload = multer({
  dest: os.tmpdir(),
  limits: {
    fileSize: env.snapinUploadMaxBytes,
    files: 1,
    fields: 24,
    parts: 26,
  },
});

function parseSnapinUpload(request, response, next) {
  snapinUpload.single('installer')(request, response, (error) => {
    if (error) {
      const tooLarge = error.code === 'LIMIT_FILE_SIZE';
      return response.status(tooLarge ? 413 : 400).render('pages/error', {
        title: 'Snapin upload rejected', currentPath: '/snapins', status: tooLarge ? 413 : 400,
        message: tooLarge
          ? `The selected installer exceeds Foggy's ${Math.ceil(env.snapinUploadMaxBytes / 1024 / 1024)} MB upload limit.`
          : 'Foggy could not safely parse the installer upload. Select one file and try again.',
      });
    }
    if (request.file?.path) {
      let cleaned = false;
      const cleanup = async () => {
        if (cleaned) return;
        cleaned = true;
        await fs.unlink(request.file.path).catch(() => {});
      };
      response.once('finish', cleanup);
      response.once('close', cleanup);
    }
    return next();
  });
}

function messageFor(error) {
  if (error?.code === 'FOG_API_REDIRECT') {
    return 'The FOG server is reachable, but its REST API appears to be disabled.';
  }
  if (error?.code === 'FOG_CREDENTIALS_REQUIRED') {
    return 'The FOG server address is set, but its application and user API credentials are incomplete.';
  }
  if (error?.code === 'FOG_NOT_CONFIGURED') {
    return 'No FOG server is configured yet. Use Add server in the sidebar to create a connection.';
  }
  return 'FOG data is temporarily unavailable. Check the server connection and credentials.';
}

const TASK_ACTIONS = Object.freeze({
  deploy: {
    title: 'Deploy image', description: 'Queue the assigned image for deployment to this computer.',
    consequence: 'The computer will boot into FOS and its target disk will be overwritten.', button: 'Queue deployment',
  },
  capture: {
    title: 'Capture image', description: 'Capture this computer into its assigned image definition.',
    consequence: 'Existing image data on FOG storage will be replaced by this capture.', button: 'Queue capture',
  },
  wake: {
    title: 'Wake computer', description: 'Ask FOG to send Wake-on-LAN packets to every MAC assigned to this computer.',
    consequence: 'FOG will send the packets immediately; delivery depends on the network and firmware configuration.', button: 'Send wake request',
  },
  inventory: {
    title: 'Refresh hardware inventory', description: 'Boot this computer into FOS and report freshly detected hardware to FOG.',
    consequence: 'The computer will leave its operating system, PXE boot into FOS, and update its collected hardware inventory.', button: 'Queue inventory task', wakeOption: true, warning: true,
  },
  memtest: {
    title: 'Run memory test', description: 'Boot this computer into the configured Memtest86+ environment.',
    consequence: 'The computer will leave its operating system and run the memory test continuously. Cancel the FOG task when testing is finished.', button: 'Queue memory test', wakeOption: true, warning: true,
  },
  'disk-test': {
    title: 'Open TestDisk', description: 'Boot this computer into FOS with the interactive TestDisk utility.',
    consequence: 'The computer will leave its operating system. TestDisk permits low-level partition inspection and recovery operations; cancel the task when finished.', button: 'Queue TestDisk', wakeOption: true, warning: true,
  },
  'surface-test': {
    title: 'Run disk surface test', description: 'Boot this computer into FOS and check the disk surface sector by sector.',
    consequence: 'The computer will leave its operating system and the sector-by-sector test can take a long time to finish.', button: 'Queue surface test', wakeOption: true, warning: true,
  },
  debug: {
    title: 'Open FOS debug shell', description: 'Boot this computer into the FOS command-line debug environment.',
    consequence: 'The computer will stop at a privileged FOS shell. Commands entered there can alter disks or data; cancel the FOG task when finished.', button: 'Queue debug task', wakeOption: true, warning: true,
  },
  'password-reset': {
    title: 'Reset a local Windows password', description: 'Boot into FOS and blank the password for one local Windows account.',
    consequence: 'This is an offline local-account reset, not a domain or Microsoft-account reset. It can make EFS-encrypted files, saved credentials, or protected keys inaccessible.', button: 'Queue password reset', wakeOption: true, warning: true, accountInput: true,
  },
  wipe: {
    title: 'Permanently wipe disks', description: 'Queue a FOG boot task that irreversibly erases this computer’s target disk.',
    consequence: 'All partitions, operating systems, applications, and user data on the target disk will be destroyed. This operation cannot be undone.', button: 'Permanently wipe disks', wakeOption: true, danger: true, wipeInput: true,
  },
  cancel: {
    title: 'Cancel active task', description: 'Cancel queued or running task records for this computer.',
    consequence: 'An imaging operation already in progress may stop before completing and leave the target disk unusable.', button: 'Cancel active task',
  },
});

const COMPUTER_TABS = Object.freeze([
  { id: 'general', label: 'General' },
  { id: 'active-directory', label: 'Active Directory' },
  { id: 'tasks', label: 'Tasks & actions' },
  { id: 'inventory', label: 'Inventory' },
  { id: 'groups', label: 'Groups' },
  { id: 'snapins', label: 'Snapins' },
  { id: 'printers', label: 'Printers' },
  { id: 'services', label: 'Client services' },
  { id: 'power', label: 'Power' },
  { id: 'history', label: 'History' },
]);

function computerTab(value, fallback = 'general') {
  const requested = String(value || '');
  return COMPUTER_TABS.some((tab) => tab.id === requested) ? requested : fallback;
}

async function settle(work, fallback = []) {
  try {
    return { data: await work(), error: null };
  } catch (error) {
    return { data: fallback, error: messageFor(error) };
  }
}

export function createPageRouter(fog) {
  const router = Router();

  async function taskActionModel(id, action, overrides = {}) {
    const actionDetails = TASK_ACTIONS[action];
    if (!actionDetails) return null;
    const [computer, activeTasks] = await Promise.all([
      fog.hosts.get(id),
      fog.tasks.forHost(id, { activeOnly: true }),
    ]);
    return {
      computer,
      action,
      actionDetails,
      activeTasks: activeTasks.map((task) => ({ ...task, tone: taskTone(task) })),
      formError: overrides.formError || '',
      values: {
        account: overrides.values?.account ?? 'Administrator',
        wipeMode: overrides.values?.wipeMode ?? 'fast',
        targetConfirmation: overrides.values?.targetConfirmation ?? '',
      },
    };
  }

  async function deploymentModel(overrides = {}) {
    const [computers, images, activeTasks] = await Promise.all([
      fog.hosts.list(), fog.images.list(), fog.tasks.listActive(),
    ]);
    const activeHostIds = new Set(activeTasks.map((task) => task.host.id));
    return {
      computers: computers.map((computer) => ({ ...computer, hasActiveTask: activeHostIds.has(computer.id) })),
      images: images.filter((image) => image.isEnabled),
      values: overrides.values || {
        hostIds: [], imageId: '', includeSnapins: true, wake: true, shutdown: false,
      },
      formError: overrides.formError || '',
    };
  }

  async function snapinRunModel(id, requestedSnapin, error = '') {
    const [computer, snapins, activeTasks] = await Promise.all([
      fog.hosts.get(id), fog.snapins.forHost(id), fog.tasks.forHost(id, { activeOnly: true }),
    ]);
    const selectedSnapin = requestedSnapin === 'all'
      ? null
      : snapins.find((snapin) => snapin.id === Number(requestedSnapin));
    if (requestedSnapin !== 'all' && !selectedSnapin) return null;
    return {
      computer, snapins, requestedSnapin, selectedSnapin,
      activeTasks: activeTasks.map((task) => ({ ...task, tone: taskTone(task) })),
      formError: error,
    };
  }

  async function captureModel(overrides = {}) {
    const [computers, images, activeTasks] = await Promise.all([
      fog.hosts.list(), fog.images.list(), fog.tasks.listActive(),
    ]);
    const activeHostIds = new Set(activeTasks.map((task) => task.host.id));
    return {
      computers: computers.map((computer) => ({ ...computer, hasActiveTask: activeHostIds.has(computer.id) })),
      images,
      values: overrides.values || { hostId: '', imageId: '', wake: true, shutdown: false },
      formError: overrides.formError || '',
    };
  }

  async function imageCreateModel(overrides = {}) {
    const lookups = await fog.images.lookups();
    return {
      lookups,
      values: overrides.values || {
        name: '', description: '', path: '',
        osId: lookups.operatingSystems[0]?.id || '',
        imageTypeId: lookups.imageTypes[0]?.id || '',
        partitionTypeId: lookups.partitionTypes[0]?.id || '',
        storageGroupId: lookups.storageGroups[0]?.id || '',
        compression: 6, format: 5, replicates: true,
      },
      errors: overrides.errors || {},
      formError: overrides.formError || '',
    };
  }

  async function imageWorkspaceModel(id, overrides = {}) {
    const [details, lookups] = await Promise.all([
      fog.images.details(id),
      fog.images.lookups(),
    ]);
    const { image } = details;
    return {
      ...details,
      image,
      activeTasks: details.activeTasks.map((task) => ({ ...task, tone: taskTone(task) })),
      lookups,
      values: overrides.values || {
        name: image.name,
        description: image.description,
        path: image.path,
        osId: image.osId,
        imageTypeId: image.imageTypeId,
        partitionTypeId: image.partitionTypeId,
        compression: image.compression ?? 6,
        format: image.format ?? 0,
        isProtected: image.isProtected,
        isEnabled: image.isEnabled,
        replicates: image.replicates,
      },
      errors: overrides.errors || {},
      formError: overrides.formError || '',
    };
  }

  function snapinFormValues(input = {}) {
    return {
      name: String(input.name || ''),
      description: String(input.description || ''),
      file: String(input.file || ''),
      arguments: String(input.arguments || ''),
      runWith: String(input.runWith || ''),
      runWithArguments: String(input.runWithArguments || ''),
      packageType: String(input.packageType ?? '0'),
      timeoutSeconds: String(input.timeoutSeconds ?? '0'),
      storageGroupId: String(input.storageGroupId || ''),
      isProtected: input.isProtected === true || input.isProtected === '1',
      isEnabled: input.isEnabled === true || input.isEnabled === '1',
      replicates: input.replicates === true || input.replicates === '1',
      hidesArguments: input.hidesArguments === true || input.hidesArguments === '1',
      postAction: String(input.postAction || 'none'),
    };
  }

  async function snapinCreateModel(overrides = {}) {
    const lookups = await fog.snapins.lookups();
    return {
      lookups,
      values: overrides.values || snapinFormValues({
        storageGroupId: lookups.storageGroups[0]?.id || '', isEnabled: true, replicates: true,
      }),
      errors: overrides.errors || {},
      formError: overrides.formError || '',
    };
  }

  async function snapinEditModel(id, overrides = {}) {
    const snapin = await fog.snapins.get(id);
    return {
      snapin,
      values: overrides.values || snapinFormValues({
        ...snapin,
        postAction: snapin.shutdown ? 'shutdown' : (snapin.reboot ? 'reboot' : 'none'),
      }),
      errors: overrides.errors || {},
      formError: overrides.formError || '',
    };
  }

  async function groupWorkspaceModel(id, overrides = {}) {
    const [group, members] = await Promise.all([
      fog.groups.get(id),
      fog.groups.members(id),
    ]);
    const taskResult = await settle(() => fog.tasks.listActive());
    const memberIds = new Set(members.map((member) => member.id));
    return {
      group,
      members,
      activeTasks: taskResult.data
        .filter((task) => memberIds.has(task.host.id))
        .map((task) => ({ ...task, tone: taskTone(task) })),
      taskError: taskResult.error,
      values: overrides.values || { name: group.name, description: group.description },
      errors: overrides.errors || {},
      formError: overrides.formError || '',
    };
  }

  async function computerWorkspaceModel(id, overrides = {}) {
    const activeTab = computerTab(overrides.activeTab);
    const computer = await fog.hosts.get(id);
    const hostMacs = [...new Set([computer.primaryMac, ...computer.macs].filter(Boolean))];
    const [groups, snapinAssignments, printers, clientServices, powerSchedules, history, activeTasks, images, adDefaults] = await Promise.all([
      settle(() => fog.groups.forHost(computer.id)),
      settle(() => fog.snapins.assignmentsForHost(computer.id), {
        all: [], assigned: [], assignedIds: new Set(),
      }),
      settle(() => fog.printers.assignmentsForHost(computer.id), {
        all: [], assigned: [], assignedIds: new Set(), defaultId: 0, managementLevel: 0,
      }),
      settle(() => fog.clientServices.configurationForHost(computer.id), {
        all: [], enabledIds: new Set(), globalStatusAvailable: false,
      }),
      settle(() => fog.power.forHost(computer.id)),
      settle(() => fog.history.forHost({ id: computer.id, macs: hostMacs }), {
        logins: [], imaging: [], snapinJobs: [], snapinTasks: [], viruses: [],
      }),
      settle(() => fog.tasks.forHost(computer.id, { activeOnly: true })),
      settle(() => fog.images.list()),
      activeTab === 'active-directory'
        ? settle(() => fog.hosts.activeDirectoryDefaults(), { domain: '', organizationalUnit: '', username: '', hasPassword: false })
        : Promise.resolve({ data: { domain: '', organizationalUnit: '', username: '', hasPassword: false }, error: null }),
    ]);
    return {
      computer,
      groups: groups.data,
      snapins: snapinAssignments.data.assigned,
      allSnapins: snapinAssignments.data.all,
      selectedSnapinIds: overrides.selectedSnapinIds || snapinAssignments.data.assignedIds,
      snapinAssignmentError: overrides.snapinAssignmentError || '',
      printers: printers.data.assigned,
      allPrinters: printers.data.all,
      selectedPrinterIds: overrides.selectedPrinterIds || printers.data.assignedIds,
      printerManagementLevel: overrides.printerManagementLevel ?? printers.data.managementLevel,
      printerDefaultId: overrides.printerDefaultId ?? printers.data.defaultId,
      printerAssignmentError: overrides.printerAssignmentError || '',
      clientServices: clientServices.data.all,
      selectedClientServiceIds: overrides.selectedClientServiceIds
        ? new Set([
          ...overrides.selectedClientServiceIds,
          ...clientServices.data.all
            .filter((module) => module.isEnabled && module.globallyEnabled !== true)
            .map((module) => module.id),
        ])
        : clientServices.data.enabledIds,
      clientServiceGlobalStatusAvailable: clientServices.data.globalStatusAvailable,
      clientServiceConfigError: overrides.clientServiceConfigError || '',
      powerSchedules: powerSchedules.data,
      history: history.data,
      activeTasks: activeTasks.data.map((task) => ({ ...task, tone: taskTone(task) })),
      images: images.data,
      hasActiveTask: activeTasks.data.length > 0,
      computerTabs: COMPUTER_TABS,
      activeTab,
      values: overrides.values || {
        name: computer.name,
        description: computer.description,
        imageId: computer.imageId ?? 0,
        kernel: computer.kernel,
        kernelArgs: computer.kernelArgs,
        kernelDevice: computer.kernelDevice,
        init: computer.init,
        biosExit: computer.biosExit,
        efiExit: computer.efiExit,
      },
      errors: overrides.errors || {},
      formError: overrides.formError || '',
      inventoryValues: overrides.inventoryValues || {
        primaryUser: computer.inventory.primaryUser,
        assetTag: computer.inventory.assetTag,
        alternateTag: computer.inventory.alternateTag,
      },
      inventoryErrors: overrides.inventoryErrors || {},
      inventoryFormError: overrides.inventoryFormError || '',
      adValues: overrides.adValues || {
        enabled: computer.activeDirectory.enabled,
        domain: computer.activeDirectory.domain,
        organizationalUnit: computer.activeDirectory.organizationalUnit,
        username: computer.activeDirectory.username,
        enforce: computer.activeDirectory.enforce,
        useDefaultPassword: false,
      },
      adErrors: overrides.adErrors || {},
      adFormError: overrides.adFormError || '',
      adDefaults: adDefaults.data,
      adDefaultsError: adDefaults.error,
      sectionErrors: {
        groups: groups.error,
        snapins: snapinAssignments.error,
        printers: printers.error,
        services: clientServices.error,
        power: powerSchedules.error,
        history: history.error,
        tasks: activeTasks.error,
        images: images.error,
      },
    };
  }

  router.get('/', async (req, res) => {
    const [hosts, images, activeTasks, allTasks] = await Promise.all([
      settle(() => fog.hosts.list()),
      settle(() => fog.images.list()),
      settle(() => fog.tasks.listActive()),
      settle(() => fog.tasks.list()),
    ]);
    const errors = [...new Set([hosts.error, images.error, activeTasks.error, allTasks.error].filter(Boolean))];
    res.render('pages/dashboard/index', {
      title: 'Dashboard',
      currentPath: '/',
      serverAdded: req.query.serverAdded === '1',
      errors,
      stats: {
        computers: hosts.data.length,
        images: images.data.length,
        active: activeTasks.data.filter((task) => task.progress > 0).length,
        queued: activeTasks.data.filter((task) => task.progress <= 0).length,
      },
      activeTasks: activeTasks.data.map((task) => ({ ...task, tone: taskTone(task) })),
      recentTasks: allTasks.data.slice(0, 8).map((task) => ({ ...task, tone: taskTone(task) })),
    });
  });

  router.get('/deploy', async (req, res) => {
    try {
      const model = await deploymentModel({
        values: {
          hostIds: [], imageId: String(req.query.image || ''),
          includeSnapins: true, wake: true, shutdown: false,
        },
      });
      return res.render('pages/deploy/index', {
        title: 'Deploy', currentPath: '/deploy', ...model,
      });
    } catch (error) {
      return res.status(503).render('pages/error', {
        title: 'Deploy unavailable', currentPath: '/deploy', status: 503,
        message: messageFor(error),
      });
    }
  });

  router.post('/deploy', requireCsrf, async (req, res, next) => {
    const hostIds = req.body.hostIds || [];
    const values = {
      hostIds: (Array.isArray(hostIds) ? hostIds : [hostIds]).map(Number),
      imageId: String(req.body.imageId || ''),
      includeSnapins: req.body.includeSnapins === '1',
      wake: req.body.wake === '1',
      shutdown: req.body.shutdown === '1',
    };
    if (req.body.confirm !== '1') {
      try {
        const model = await deploymentModel({ values, formError: 'Confirm that the selected computers may have their target disks overwritten.' });
        return res.status(422).render('pages/deploy/index', {
          title: 'Deploy', currentPath: '/deploy', ...model,
        });
      } catch (error) {
        return next(error);
      }
    }
    try {
      const result = await fog.deployments.create(values);
      return res.status(result.failed ? 207 : 200).render('pages/deploy/results', {
        title: 'Deployment results', currentPath: '/deploy', result,
      });
    } catch (error) {
      if (error.code === 'FOG_VALIDATION_ERROR' || error.code === 'FOG_CONFLICT') {
        try {
          const model = await deploymentModel({ values, formError: error.message });
          return res.status(error.code === 'FOG_CONFLICT' ? 409 : 422).render('pages/deploy/index', {
            title: 'Deploy', currentPath: '/deploy', ...model,
          });
        } catch (loadError) {
          return next(loadError);
        }
      }
      const status = error.status === 403 ? 403 : 502;
      return res.status(status).render('pages/error', {
        title: 'Deployment request failed', currentPath: '/deploy', status,
        message: error.status === 403
          ? 'The configured FOG API user is not authorized to assign images or create tasks.'
          : 'FOG rejected the deployment request. Completed per-computer operations were not rolled back.',
      });
    }
  });

  router.get('/capture', async (req, res) => {
    try {
      const model = await captureModel({
        values: {
          hostId: '', imageId: String(req.query.image || ''), wake: true, shutdown: false,
        },
      });
      return res.render('pages/capture/index', {
        title: 'Capture', currentPath: '/capture', imageCreated: req.query.created === '1', ...model,
      });
    } catch (error) {
      return res.status(503).render('pages/error', {
        title: 'Capture unavailable', currentPath: '/capture', status: 503,
        message: messageFor(error),
      });
    }
  });

  router.post('/capture', requireCsrf, async (req, res, next) => {
    const values = {
      hostId: String(req.body.hostId || ''),
      imageId: String(req.body.imageId || ''),
      wake: req.body.wake === '1',
      shutdown: req.body.shutdown === '1',
    };
    if (req.body.confirm !== '1') {
      try {
        const model = await captureModel({ values, formError: 'Confirm that this capture may replace the selected image data.' });
        return res.status(422).render('pages/capture/index', {
          title: 'Capture', currentPath: '/capture', ...model,
        });
      } catch (error) {
        return next(error);
      }
    }
    try {
      const result = await fog.captures.create(values);
      return res.status(result.status === 'queued' ? 200 : 502).render('pages/capture/results', {
        title: 'Capture result', currentPath: '/capture', result,
      });
    } catch (error) {
      if (error.code === 'FOG_VALIDATION_ERROR' || error.code === 'FOG_CONFLICT') {
        try {
          const model = await captureModel({ values, formError: error.message });
          return res.status(error.code === 'FOG_CONFLICT' ? 409 : 422).render('pages/capture/index', {
            title: 'Capture', currentPath: '/capture', ...model,
          });
        } catch (loadError) {
          return next(loadError);
        }
      }
      const status = error.status === 403 ? 403 : 502;
      return res.status(status).render('pages/error', {
        title: 'Capture request failed', currentPath: '/capture', status,
        message: error.status === 403
          ? 'The configured FOG API user is not authorized to assign images or create capture tasks.'
          : 'FOG rejected the capture request. Completed assignment changes were not rolled back.',
      });
    }
  });

  router.get('/computers', async (req, res) => {
    const search = String(req.query.search || '').trim();
    const hosts = await settle(() => fog.hosts.list({ search }));
    const model = { computers: hosts.data, search, error: hosts.error };
    if (req.get('HX-Request') === 'true') {
      return res.render('pages/computers/table', model);
    }
    return res.render('pages/computers/index', {
      title: 'Computers',
      currentPath: '/computers',
      ...model,
    });
  });

  router.get('/computers/:id/edit', async (req, res, next) => {
    try {
      const computer = await fog.hosts.get(req.params.id);
      return res.redirect(302, `/computers/${computer.id}?tab=general`);
    } catch (error) {
      if (error.status === 404 || error instanceof TypeError) return next();
      return res.status(503).render('pages/error', {
        title: 'Computer unavailable', currentPath: '/computers', status: 503,
        message: messageFor(error),
      });
    }
  });

  router.post('/computers/:id', requireCsrf, async (req, res, next) => {
    const values = {
      name: String(req.body.name || ''),
      description: String(req.body.description || ''),
      imageId: String(req.body.imageId ?? ''),
      kernel: String(req.body.kernel || ''),
      kernelArgs: String(req.body.kernelArgs || ''),
      kernelDevice: String(req.body.kernelDevice || ''),
      init: String(req.body.init || ''),
      biosExit: String(req.body.biosExit || ''),
      efiExit: String(req.body.efiExit || ''),
    };
    try {
      const updated = await fog.hosts.update(req.params.id, values);
      return res.redirect(303, `/computers/${updated.id}?tab=general&updated=1`);
    } catch (error) {
      if (error.status === 404 || error instanceof TypeError) return next();
      if (error.code === 'FOG_VALIDATION_ERROR' || error.code === 'FOG_CONFLICT') {
        try {
          const model = await computerWorkspaceModel(req.params.id, {
            activeTab: 'general',
            values,
            errors: error.fields,
            formError: error.code === 'FOG_CONFLICT' ? error.message : '',
          });
          return res.status(error.code === 'FOG_CONFLICT' ? 409 : 422).render('pages/computers/show', {
            title: model.computer.name || 'Computer',
            currentPath: '/computers',
            ...model,
            updated: false,
            taskResult: '',
            snapinQueued: false,
            snapinsUpdated: false,
          });
        } catch (loadError) {
          return next(loadError);
        }
      }
      const status = error.status === 403 ? 403 : 502;
      return res.status(status).render('pages/error', {
        title: 'Host update failed', currentPath: '/computers', status,
        message: error.status === 403
          ? 'The configured FOG API user is not authorized to edit hosts.'
          : 'FOG rejected the host update. No database workaround was attempted.',
      });
    }
  });

  router.post('/computers/:id/active-directory', requireCsrf, async (req, res, next) => {
    const adValues = {
      enabled: req.body.enabled === '1',
      domain: String(req.body.domain || ''),
      organizationalUnit: String(req.body.organizationalUnit || ''),
      username: String(req.body.username || ''),
      enforce: req.body.enforce === '1',
      useDefaultPassword: req.body.useDefaultPassword === '1',
    };
    const renderWorkspace = async (status, adFormError, adErrors = {}) => {
      const model = await computerWorkspaceModel(req.params.id, {
        activeTab: 'active-directory', adValues, adErrors, adFormError,
      });
      return res.status(status).render('pages/computers/show', {
        title: model.computer.name || 'Computer', currentPath: '/computers', ...model,
        updated: false, taskResult: '', snapinQueued: false, snapinsUpdated: false,
        inventoryUpdated: false, printersUpdated: false, servicesUpdated: false,
        adUpdated: false,
      });
    };
    if (req.body.confirm !== '1') {
      try {
        return await renderWorkspace(422, 'Confirm the domain-join effect before saving. Re-enter the password if AD is enabled.');
      } catch (error) {
        if (error.status === 404 || error instanceof TypeError) return next();
        return next(error);
      }
    }
    try {
      await fog.hosts.updateActiveDirectory(req.params.id, {
        ...adValues,
        password: String(req.body.password || ''),
      });
      return res.redirect(303, `/computers/${req.params.id}?tab=active-directory&ad=updated`);
    } catch (error) {
      if (error.status === 404 || error instanceof TypeError) return next();
      if (error.code === 'FOG_VALIDATION_ERROR' || error.code === 'FOG_CONFLICT') {
        try {
          return await renderWorkspace(error.code === 'FOG_CONFLICT' ? 409 : 422, error.message, error.fields);
        } catch (loadError) {
          return next(loadError);
        }
      }
      const status = error.status === 403 ? 403 : 502;
      return res.status(status).render('pages/error', {
        title: 'Active Directory update failed', currentPath: '/computers', status,
        message: error.status === 403
          ? 'The configured FOG API user is not authorized to edit host Active Directory settings.'
          : 'FOG rejected the Active Directory update. No database workaround was attempted.',
      });
    }
  });

  router.post('/computers/:id/inventory', requireCsrf, async (req, res, next) => {
    const inventoryValues = {
      primaryUser: String(req.body.primaryUser || ''),
      assetTag: String(req.body.assetTag || ''),
      alternateTag: String(req.body.alternateTag || ''),
    };
    try {
      await fog.inventory.updateForHost(req.params.id, inventoryValues);
      return res.redirect(303, `/computers/${req.params.id}?tab=inventory&inventory=updated`);
    } catch (error) {
      if (error.status === 404 || error instanceof TypeError) return next();
      if (error.code === 'FOG_VALIDATION_ERROR' || error.code === 'FOG_CONFLICT') {
        try {
          const model = await computerWorkspaceModel(req.params.id, {
            activeTab: 'inventory',
            inventoryValues,
            inventoryErrors: error.fields,
            inventoryFormError: error.message,
          });
          return res.status(error.code === 'FOG_CONFLICT' ? 409 : 422).render('pages/computers/show', {
            title: model.computer.name || 'Computer', currentPath: '/computers', ...model,
            updated: false, taskResult: '', snapinQueued: false, snapinsUpdated: false,
            inventoryUpdated: false,
          });
        } catch (loadError) {
          return next(loadError);
        }
      }
      const status = error.status === 403 ? 403 : 502;
      return res.status(status).render('pages/error', {
        title: 'Inventory update failed', currentPath: '/computers', status,
        message: error.status === 403
          ? 'The configured FOG API user is not authorized to edit inventory metadata.'
          : 'FOG rejected the inventory update. Collected hardware fields were not modified by Foggy.',
      });
    }
  });

  router.post('/computers/:id/printers', requireCsrf, async (req, res, next) => {
    const submitted = req.body.printerIds || [];
    const printerIds = (Array.isArray(submitted) ? submitted : [submitted])
      .filter((value) => value !== '')
      .map(Number);
    const managementLevel = Number(req.body.managementLevel);
    const defaultId = Number(req.body.defaultPrinterId || 0);
    const renderWorkspace = async (status, message) => {
      const model = await computerWorkspaceModel(req.params.id, {
        activeTab: 'printers',
        selectedPrinterIds: new Set(printerIds),
        printerManagementLevel: managementLevel,
        printerDefaultId: defaultId,
        printerAssignmentError: message,
      });
      return res.status(status).render('pages/computers/show', {
        title: model.computer.name || 'Computer', currentPath: '/computers', ...model,
        updated: false, taskResult: '', snapinQueued: false, snapinsUpdated: false,
        inventoryUpdated: false, printersUpdated: false,
      });
    };
    if (req.body.confirm !== '1') {
      try {
        return await renderWorkspace(422, 'Confirm the complete printer configuration before saving.');
      } catch (error) {
        if (error.status === 404 || error instanceof TypeError) return next();
        return next(error);
      }
    }
    try {
      await fog.printers.updateAssignmentsForHost(req.params.id, {
        printerIds, managementLevel, defaultId,
      });
      return res.redirect(303, `/computers/${req.params.id}?tab=printers&printers=updated#printer-assignments`);
    } catch (error) {
      if (error.status === 404 || error instanceof TypeError) return next();
      if (error.code === 'FOG_VALIDATION_ERROR' || error.code === 'FOG_CONFLICT') {
        try {
          return await renderWorkspace(error.code === 'FOG_CONFLICT' ? 409 : 422, error.message);
        } catch (loadError) {
          return next(loadError);
        }
      }
      const status = error.status === 403 ? 403 : 502;
      return res.status(status).render('pages/error', {
        title: 'Printer configuration failed', currentPath: '/computers', status,
        message: error.status === 403
          ? 'The configured FOG API user is not authorized to edit host printer settings.'
          : 'FOG rejected the printer update. Review the host because some association changes may already have completed.',
      });
    }
  });

  router.post('/computers/:id/services', requireCsrf, async (req, res, next) => {
    const submitted = req.body.moduleIds || [];
    const moduleIds = (Array.isArray(submitted) ? submitted : [submitted])
      .filter((value) => value !== '')
      .map(Number);
    const renderWorkspace = async (status, message) => {
      const model = await computerWorkspaceModel(req.params.id, {
        activeTab: 'services',
        selectedClientServiceIds: new Set(moduleIds),
        clientServiceConfigError: message,
      });
      return res.status(status).render('pages/computers/show', {
        title: model.computer.name || 'Computer', currentPath: '/computers', ...model,
        updated: false, taskResult: '', snapinQueued: false, snapinsUpdated: false,
        inventoryUpdated: false, printersUpdated: false, servicesUpdated: false,
      });
    };
    if (req.body.confirm !== '1') {
      try {
        return await renderWorkspace(422, 'Confirm the complete client service configuration before saving.');
      } catch (error) {
        if (error.status === 404 || error instanceof TypeError) return next();
        return next(error);
      }
    }
    try {
      await fog.clientServices.updateForHost(req.params.id, moduleIds);
      return res.redirect(303, `/computers/${req.params.id}?tab=services&services=updated#service-modules`);
    } catch (error) {
      if (error.status === 404 || error instanceof TypeError) return next();
      if (error.code === 'FOG_VALIDATION_ERROR' || error.code === 'FOG_CONFLICT') {
        try {
          return await renderWorkspace(error.code === 'FOG_CONFLICT' ? 409 : 422, error.message);
        } catch (loadError) {
          return next(loadError);
        }
      }
      const status = error.status === 403 ? 403 : 502;
      return res.status(status).render('pages/error', {
        title: 'Client service update failed', currentPath: '/computers', status,
        message: error.status === 403
          ? 'The configured FOG API user is not authorized to edit host client modules.'
          : 'FOG rejected the client service update. Review the computer because some module changes may already have completed.',
      });
    }
  });

  router.get('/computers/:id/tasks/new', async (req, res, next) => {
    const action = String(req.query.action || '');
    try {
      const model = await taskActionModel(req.params.id, action);
      if (!model) return next();
      return res.render('pages/computers/task-action', {
        title: `${model.actionDetails.title} · ${model.computer.name}`,
        currentPath: '/computers',
        ...model,
      });
    } catch (error) {
      if (error.status === 404 || error instanceof TypeError) return next();
      return res.status(503).render('pages/error', {
        title: 'Task action unavailable', currentPath: '/computers', status: 503,
        message: messageFor(error),
      });
    }
  });

  router.post('/computers/:id/tasks', requireCsrf, async (req, res, next) => {
    const action = String(req.body.action || '');
    if (!TASK_ACTIONS[action]) return next();
    if (req.body.confirm !== '1') {
      try {
        const model = await taskActionModel(req.params.id, action, {
          formError: 'Confirm that you understand the effect of this action.', values: req.body,
        });
        return res.status(422).render('pages/computers/task-action', {
          title: `${model.actionDetails.title} · ${model.computer.name}`,
          currentPath: '/computers',
          ...model,
        });
      } catch (error) {
        return next(error);
      }
    }
    try {
      if (action === 'cancel') {
        await fog.tasks.cancelForHost(req.params.id);
      } else {
        await fog.tasks.createForHost(req.params.id, action, {
          shutdown: req.body.shutdown === '1',
          wake: req.body.wake === '1',
          includeSnapins: req.body.includeSnapins === '1',
          account: req.body.account,
          wipeMode: req.body.wipeMode,
          targetConfirmation: req.body.targetConfirmation,
        });
      }
      return res.redirect(303, `/computers/${req.params.id}?tab=tasks&task=${encodeURIComponent(action)}`);
    } catch (error) {
      if (error.status === 404 || error instanceof TypeError) return next();
      if (error.code === 'FOG_VALIDATION_ERROR' || error.code === 'FOG_CONFLICT' || error.status === 500) {
        try {
          const model = await taskActionModel(req.params.id, action, {
            formError: error.message, values: req.body,
          });
          return res.status(error.code === 'FOG_CONFLICT' ? 409 : 422).render('pages/computers/task-action', {
            title: `${model.actionDetails.title} · ${model.computer.name}`,
            currentPath: '/computers',
            ...model,
          });
        } catch (loadError) {
          return next(loadError);
        }
      }
      const status = error.status === 403 ? 403 : 502;
      return res.status(status).render('pages/error', {
        title: 'FOG task request failed', currentPath: '/computers', status,
        message: error.status === 403
          ? 'The configured FOG API user is not authorized to create or cancel tasks.'
          : 'FOG rejected the task request. No database workaround was attempted.',
      });
    }
  });

  router.get('/computers/:id/snapins/run', async (req, res, next) => {
    const requestedSnapin = String(req.query.snapin || 'all');
    try {
      const model = await snapinRunModel(req.params.id, requestedSnapin);
      if (!model) return next();
      return res.render('pages/computers/run-snapins', {
        title: `Run Snapins · ${model.computer.name}`, currentPath: '/computers', ...model,
      });
    } catch (error) {
      if (error.status === 404 || error instanceof TypeError) return next();
      return res.status(503).render('pages/error', {
        title: 'Snapin task unavailable', currentPath: '/computers', status: 503,
        message: messageFor(error),
      });
    }
  });

  router.post('/computers/:id/snapins/run', requireCsrf, async (req, res, next) => {
    const requestedSnapin = String(req.body.snapin || 'all');
    if (req.body.confirm !== '1') {
      try {
        const model = await snapinRunModel(req.params.id, requestedSnapin, 'Confirm the Snapin task before submitting.');
        if (!model) return next();
        return res.status(422).render('pages/computers/run-snapins', {
          title: `Run Snapins · ${model.computer.name}`, currentPath: '/computers', ...model,
        });
      } catch (error) {
        return next(error);
      }
    }
    try {
      await fog.tasks.runSnapins(req.params.id, requestedSnapin);
      return res.redirect(303, `/computers/${req.params.id}?tab=snapins&snapin=queued`);
    } catch (error) {
      if (error.status === 404 || error instanceof TypeError) return next();
      if (error.code === 'FOG_VALIDATION_ERROR' || error.code === 'FOG_CONFLICT') {
        try {
          const model = await snapinRunModel(req.params.id, requestedSnapin, error.message);
          if (!model) return next();
          return res.status(error.code === 'FOG_CONFLICT' ? 409 : 422).render('pages/computers/run-snapins', {
            title: `Run Snapins · ${model.computer.name}`, currentPath: '/computers', ...model,
          });
        } catch (loadError) {
          return next(loadError);
        }
      }
      const status = error.status === 403 ? 403 : 502;
      return res.status(status).render('pages/error', {
        title: 'Snapin task failed', currentPath: '/computers', status,
        message: error.status === 403
          ? 'The configured FOG API user is not authorized to create Snapin tasks.'
          : 'FOG rejected the Snapin task. No database workaround was attempted.',
      });
    }
  });

  router.post('/computers/:id/snapins', requireCsrf, async (req, res, next) => {
    const submitted = req.body.snapinIds || [];
    const requestedIds = (Array.isArray(submitted) ? submitted : [submitted])
      .filter((value) => value !== '')
      .map(Number);
    const renderWorkspace = async (status, message) => {
      const model = await computerWorkspaceModel(req.params.id, {
        activeTab: 'snapins',
        selectedSnapinIds: new Set(requestedIds),
        snapinAssignmentError: message,
      });
      return res.status(status).render('pages/computers/show', {
        title: model.computer.name || 'Computer', currentPath: '/computers', ...model,
        updated: false, taskResult: '', snapinQueued: false, snapinsUpdated: false,
      });
    };
    if (req.body.confirm !== '1') {
      try {
        return await renderWorkspace(422, 'Confirm the complete Snapin assignment list before saving.');
      } catch (error) {
        if (error.status === 404 || error instanceof TypeError) return next();
        return next(error);
      }
    }
    try {
      await fog.snapins.updateAssignmentsForHost(req.params.id, requestedIds);
      return res.redirect(303, `/computers/${req.params.id}?tab=snapins&snapins=updated`);
    } catch (error) {
      if (error.status === 404 || error instanceof TypeError) return next();
      if (error.code === 'FOG_VALIDATION_ERROR' || error.code === 'FOG_CONFLICT') {
        try {
          return await renderWorkspace(error.code === 'FOG_CONFLICT' ? 409 : 422, error.message);
        } catch (loadError) {
          return next(loadError);
        }
      }
      const status = error.status === 403 ? 403 : 502;
      return res.status(status).render('pages/error', {
        title: 'Snapin assignment failed', currentPath: '/computers', status,
        message: error.status === 403
          ? 'The configured FOG API user is not authorized to edit host Snapin assignments.'
          : 'FOG rejected the Snapin assignment update. No database workaround was attempted.',
      });
    }
  });

  router.get('/computers/:id', async (req, res, next) => {
    try {
      const model = await computerWorkspaceModel(req.params.id, { activeTab: computerTab(req.query.tab) });
      return res.render('pages/computers/show', {
        title: model.computer.name || 'Computer',
        currentPath: '/computers',
        ...model,
        updated: req.query.updated === '1',
        taskResult: Object.hasOwn(TASK_ACTIONS, req.query.task) ? req.query.task : '',
        snapinQueued: req.query.snapin === 'queued',
        snapinsUpdated: req.query.snapins === 'updated',
        inventoryUpdated: req.query.inventory === 'updated',
        printersUpdated: req.query.printers === 'updated',
        servicesUpdated: req.query.services === 'updated',
        adUpdated: req.query.ad === 'updated',
      });
    } catch (error) {
      if (error.status === 404 || error instanceof TypeError) return next();
      return res.status(503).render('pages/error', {
        title: 'Computer unavailable',
        currentPath: '/computers',
        status: 503,
        message: messageFor(error),
      });
    }
  });

  router.get('/images', async (req, res) => {
    const search = String(req.query.search || '').trim();
    const images = await settle(() => fog.images.list({ search }));
    const model = { images: images.data, search, error: images.error };
    if (req.get('HX-Request') === 'true') {
      return res.render('pages/images/grid', model);
    }
    return res.render('pages/images/index', {
      title: 'Images',
      currentPath: '/images',
      ...model,
    });
  });

  router.get('/images/new', async (req, res) => {
    try {
      const model = await imageCreateModel();
      return res.render('pages/images/new', {
        title: 'Create image definition', currentPath: '/images', ...model,
      });
    } catch (error) {
      return res.status(503).render('pages/error', {
        title: 'Image creation unavailable', currentPath: '/images', status: 503,
        message: messageFor(error),
      });
    }
  });

  router.post('/images', requireCsrf, async (req, res, next) => {
    const values = {
      name: String(req.body.name || ''), description: String(req.body.description || ''),
      path: String(req.body.path || ''), osId: String(req.body.osId || ''),
      imageTypeId: String(req.body.imageTypeId || ''), partitionTypeId: String(req.body.partitionTypeId || ''),
      storageGroupId: String(req.body.storageGroupId || ''), compression: String(req.body.compression || ''),
      format: String(req.body.format || ''), replicates: req.body.replicates === '1',
    };
    if (req.body.confirm !== '1') {
      try {
        const model = await imageCreateModel({ values, formError: 'Confirm creation of this FOG image definition.' });
        return res.status(422).render('pages/images/new', {
          title: 'Create image definition', currentPath: '/images', ...model,
        });
      } catch (error) {
        return next(error);
      }
    }
    try {
      const image = await fog.images.create(values);
      return res.redirect(303, `/capture?image=${image.id}&created=1`);
    } catch (error) {
      if (error.code === 'FOG_VALIDATION_ERROR' || error.code === 'FOG_CONFLICT') {
        try {
          const model = await imageCreateModel({
            values, errors: error.fields || {}, formError: error.code === 'FOG_CONFLICT' ? error.message : '',
          });
          return res.status(error.code === 'FOG_CONFLICT' ? 409 : 422).render('pages/images/new', {
            title: 'Create image definition', currentPath: '/images', ...model,
          });
        } catch (loadError) {
          return next(loadError);
        }
      }
      const status = error.status === 403 ? 403 : 502;
      return res.status(status).render('pages/error', {
        title: 'Image creation failed', currentPath: '/images', status,
        message: error.status === 403
          ? 'The configured FOG API user is not authorized to create images.'
          : 'FOG rejected the image definition. No database workaround was attempted.',
      });
    }
  });

  router.get('/images/:id/edit', async (req, res, next) => {
    try {
      await fog.images.get(req.params.id);
      return res.redirect(303, `/images/${encodeURIComponent(req.params.id)}#image-settings`);
    } catch (error) {
      if (error.status === 404 || error instanceof TypeError) return next();
      return res.status(503).render('pages/error', {
        title: 'Image editing unavailable', currentPath: '/images', status: 503,
        message: messageFor(error),
      });
    }
  });

  router.post('/images/:id', requireCsrf, async (req, res, next) => {
    const values = {
      name: String(req.body.name || ''),
      description: String(req.body.description || ''),
      path: String(req.body.path || ''),
      osId: String(req.body.osId || ''),
      imageTypeId: String(req.body.imageTypeId || ''),
      partitionTypeId: String(req.body.partitionTypeId || ''),
      compression: String(req.body.compression || ''),
      format: String(req.body.format || ''),
      isProtected: req.body.isProtected === '1',
      isEnabled: req.body.isEnabled === '1',
      replicates: req.body.replicates === '1',
    };
    if (req.body.confirm !== '1') {
      try {
        const model = await imageWorkspaceModel(req.params.id, {
          values, formError: 'Confirm this image-definition update before submitting.',
        });
        return res.status(422).render('pages/images/show', {
          title: model.image.name || 'Image', currentPath: '/images', updated: false, ...model,
        });
      } catch (error) {
        if (error.status === 404 || error instanceof TypeError) return next();
        return next(error);
      }
    }
    try {
      const image = await fog.images.update(req.params.id, values);
      return res.redirect(303, `/images/${image.id}?updated=1`);
    } catch (error) {
      if (error.status === 404 || error instanceof TypeError) return next();
      if (error.code === 'FOG_VALIDATION_ERROR' || error.code === 'FOG_CONFLICT') {
        try {
          const model = await imageWorkspaceModel(req.params.id, {
            values, errors: error.fields || {}, formError: error.message,
          });
          return res.status(error.code === 'FOG_CONFLICT' ? 409 : 422).render('pages/images/show', {
            title: model.image.name || 'Image', currentPath: '/images', updated: false, ...model,
          });
        } catch (loadError) {
          return next(loadError);
        }
      }
      const status = error.status === 403 ? 403 : 502;
      return res.status(status).render('pages/error', {
        title: 'Image update failed', currentPath: '/images', status,
        message: error.status === 403
          ? 'The configured FOG API user is not authorized to edit images.'
          : 'FOG rejected the image update. No storage files or database records were changed directly.',
      });
    }
  });

  router.get('/images/:id', async (req, res, next) => {
    try {
      const model = await imageWorkspaceModel(req.params.id);
      return res.render('pages/images/show', {
        title: model.image.name || 'Image', currentPath: '/images',
        ...model,
        updated: req.query.updated === '1',
      });
    } catch (error) {
      if (error.status === 404 || error instanceof TypeError) return next();
      return res.status(503).render('pages/error', {
        title: 'Image unavailable', currentPath: '/images', status: 503,
        message: messageFor(error),
      });
    }
  });

  router.get('/snapins', async (req, res) => {
    const snapins = await settle(() => fog.snapins.list());
    return res.render('pages/snapins/index', {
      title: 'Snapins', currentPath: '/snapins', snapins: snapins.data, error: snapins.error,
    });
  });

  router.get('/snapins/new', async (req, res) => {
    try {
      const model = await snapinCreateModel();
      return res.render('pages/snapins/new', {
        title: 'Create Snapin definition', currentPath: '/snapins', ...model,
      });
    } catch (error) {
      const status = error.status === 403 ? 403 : 503;
      return res.status(status).render('pages/error', {
        title: 'Snapin creation unavailable', currentPath: '/snapins', status,
        message: error.status === 403
          ? 'An administrator FOG API user is required to load storage groups and create Snapins.'
          : messageFor(error),
      });
    }
  });

  router.post('/snapins', requireSameOrigin, parseSnapinUpload, requireCsrf, async (req, res, next) => {
    const values = snapinFormValues(req.body);
    const renderForm = async (status, formError = '', errors = {}) => {
      const model = await snapinCreateModel({ values, formError, errors });
      return res.status(status).render('pages/snapins/new', {
        title: 'Create Snapin definition', currentPath: '/snapins', ...model,
      });
    };
    if (req.body.confirm !== '1') {
      try {
        return await renderForm(422, `Confirm creation of this Snapin definition and storage-group association.${req.file ? ' Reselect the installer before submitting again.' : ''}`);
      } catch (error) {
        return next(error);
      }
    }
    try {
      const snapin = req.file
        ? await fog.snapins.createWithFile(values, {
          path: req.file.path,
          originalName: req.file.originalname,
          mimeType: req.file.mimetype,
          size: req.file.size,
        }, { timeoutMs: env.snapinUploadTimeoutMs })
        : await fog.snapins.create(values);
      return res.redirect(303, `/snapins/${snapin.id}/edit?created=1`);
    } catch (error) {
      if (error.code === 'FOG_VALIDATION_ERROR' || error.code === 'FOG_CONFLICT') {
        try {
          const errors = req.file && error.fields?.file
            ? { ...error.fields, file: '', installer: error.fields.file }
            : (error.fields || {});
          return await renderForm(error.code === 'FOG_CONFLICT' ? 409 : 422, error.message, errors);
        } catch (loadError) {
          return next(loadError);
        }
      }
      const status = error.status === 403 ? 403 : 502;
      return res.status(status).render('pages/error', {
        title: 'Snapin creation failed', currentPath: '/snapins', status,
        message: error.status === 403
          ? 'The configured FOG API user is not authorized to create Snapins.'
          : (req.file
            ? 'FOG rejected the combined Snapin upload/create operation. The file may have reached the storage node before a later failure; check FOG storage before retrying. No database workaround was attempted.'
            : 'FOG rejected the Snapin definition. No file was uploaded and no database workaround was attempted.'),
      });
    }
  });

  router.get('/snapins/:id/edit', async (req, res, next) => {
    try {
      const model = await snapinEditModel(req.params.id);
      return res.render('pages/snapins/edit', {
        title: `Edit ${model.snapin.name || 'Snapin'}`, currentPath: '/snapins',
        created: req.query.created === '1', updated: req.query.updated === '1', ...model,
      });
    } catch (error) {
      if (error.status === 404 || error instanceof TypeError) return next();
      return res.status(503).render('pages/error', {
        title: 'Snapin unavailable', currentPath: '/snapins', status: 503, message: messageFor(error),
      });
    }
  });

  router.post('/snapins/:id', requireCsrf, async (req, res, next) => {
    const values = snapinFormValues(req.body);
    const renderForm = async (status, formError = '', errors = {}) => {
      const model = await snapinEditModel(req.params.id, { values, formError, errors });
      return res.status(status).render('pages/snapins/edit', {
        title: `Edit ${model.snapin.name || 'Snapin'}`, currentPath: '/snapins',
        created: false, updated: false, ...model,
      });
    };
    if (req.body.confirm !== '1') {
      try {
        return await renderForm(422, 'Confirm this Snapin definition update before submitting.');
      } catch (error) {
        if (error.status === 404 || error instanceof TypeError) return next();
        return next(error);
      }
    }
    try {
      const snapin = await fog.snapins.update(req.params.id, values);
      return res.redirect(303, `/snapins/${snapin.id}/edit?updated=1`);
    } catch (error) {
      if (error.status === 404 || error instanceof TypeError) return next();
      if (error.code === 'FOG_VALIDATION_ERROR' || error.code === 'FOG_CONFLICT') {
        try {
          return await renderForm(error.code === 'FOG_CONFLICT' ? 409 : 422, error.message, error.fields || {});
        } catch (loadError) {
          return next(loadError);
        }
      }
      const status = error.status === 403 ? 403 : 502;
      return res.status(status).render('pages/error', {
        title: 'Snapin update failed', currentPath: '/snapins', status,
        message: error.status === 403
          ? 'The configured FOG API user is not authorized to edit Snapins.'
          : 'FOG rejected the Snapin update. No storage file or database record was changed directly.',
      });
    }
  });

  router.get('/groups', async (req, res) => {
    const groups = await settle(() => fog.groups.list());
    res.render('pages/groups/index', {
      title: 'Groups',
      currentPath: '/groups',
      groups: groups.data,
      error: groups.error,
      created: req.query.created === '1',
      deletedName: String(req.query.deleted || ''),
    });
  });

  router.get('/groups/new', (req, res) => res.render('pages/groups/new', {
    title: 'Create group', currentPath: '/groups',
    values: { name: '', description: '' }, errors: {}, formError: '',
  }));

  router.post('/groups', requireCsrf, async (req, res, next) => {
    const values = {
      name: String(req.body.name || ''),
      description: String(req.body.description || ''),
    };
    try {
      const group = await fog.groups.create(values);
      return res.redirect(303, `/groups/${group.id}?created=1`);
    } catch (error) {
      if (error.code === 'FOG_VALIDATION_ERROR') {
        return res.status(422).render('pages/groups/new', {
          title: 'Create group', currentPath: '/groups', values,
          errors: error.fields || {}, formError: error.message,
        });
      }
      const status = error.status === 403 ? 403 : 502;
      return res.status(status).render('pages/error', {
        title: 'Group creation failed', currentPath: '/groups', status,
        message: error.status === 403
          ? 'The configured FOG API user is not authorized to create groups.'
          : 'FOG rejected the group definition. No database workaround was attempted.',
      });
    }
  });

  router.get('/groups/:id/edit', async (req, res, next) => {
    try {
      await fog.groups.get(req.params.id);
      return res.redirect(303, `/groups/${encodeURIComponent(req.params.id)}#group-settings`);
    } catch (error) {
      if (error.status === 404 || error instanceof TypeError) return next();
      return res.status(503).render('pages/error', {
        title: 'Group editing unavailable', currentPath: '/groups', status: 503,
        message: messageFor(error),
      });
    }
  });

  router.post('/groups/:id', requireCsrf, async (req, res, next) => {
    const values = {
      name: String(req.body.name || ''),
      description: String(req.body.description || ''),
    };
    if (req.body.confirm !== '1') {
      try {
        const model = await groupWorkspaceModel(req.params.id, {
          values, formError: 'Confirm the group metadata update before submitting.',
        });
        return res.status(422).render('pages/groups/show', {
          title: model.group.name || 'Group', currentPath: '/groups',
          membersUpdated: false, created: false, updated: false, ...model,
        });
      } catch (error) {
        if (error.status === 404 || error instanceof TypeError) return next();
        return next(error);
      }
    }
    try {
      const group = await fog.groups.update(req.params.id, values);
      return res.redirect(303, `/groups/${group.id}?updated=1`);
    } catch (error) {
      if (error.status === 404 || error instanceof TypeError) return next();
      if (error.code === 'FOG_VALIDATION_ERROR') {
        try {
          const model = await groupWorkspaceModel(req.params.id, {
            values, errors: error.fields || {}, formError: error.message,
          });
          return res.status(422).render('pages/groups/show', {
            title: model.group.name || 'Group', currentPath: '/groups',
            membersUpdated: false, created: false, updated: false, ...model,
          });
        } catch (loadError) {
          return next(loadError);
        }
      }
      const status = error.status === 403 ? 403 : 502;
      return res.status(status).render('pages/error', {
        title: 'Group update failed', currentPath: '/groups', status,
        message: error.status === 403
          ? 'The configured FOG API user is not authorized to edit groups.'
          : 'FOG rejected the group update. Member hosts were not edited directly.',
      });
    }
  });

  router.get('/groups/:id/delete', async (req, res, next) => {
    try {
      const [group, members] = await Promise.all([
        fog.groups.get(req.params.id), fog.groups.members(req.params.id),
      ]);
      return res.render('pages/groups/delete', {
        title: `Delete ${group.name}`, currentPath: '/groups', group, members, formError: '',
      });
    } catch (error) {
      if (error.status === 404 || error instanceof TypeError) return next();
      return res.status(503).render('pages/error', {
        title: 'Group deletion unavailable', currentPath: '/groups', status: 503,
        message: messageFor(error),
      });
    }
  });

  router.post('/groups/:id/delete', requireCsrf, async (req, res, next) => {
    try {
      const [group, members] = await Promise.all([
        fog.groups.get(req.params.id), fog.groups.members(req.params.id),
      ]);
      const confirmed = req.body.confirm === '1';
      const typedName = String(req.body.groupName || '').trim();
      if (!confirmed || typedName !== group.name) {
        return res.status(422).render('pages/groups/delete', {
          title: `Delete ${group.name}`, currentPath: '/groups', group, members,
          formError: !confirmed
            ? 'Confirm that the group membership associations may be removed.'
            : 'Enter the group name exactly as shown.',
        });
      }
      const result = await fog.groups.remove(req.params.id);
      return res.redirect(303, `/groups?deleted=${encodeURIComponent(result.group.name)}`);
    } catch (error) {
      if (error.status === 404 || error instanceof TypeError) return next();
      if (error.code === 'FOG_CONFLICT') {
        return res.status(409).render('pages/error', {
          title: 'Group deletion incomplete', currentPath: '/groups', status: 409,
          message: error.message,
        });
      }
      const status = error.status === 403 ? 403 : 502;
      return res.status(status).render('pages/error', {
        title: 'Group deletion failed', currentPath: '/groups', status,
        message: error.status === 403
          ? 'The configured FOG API user is not authorized to delete groups.'
          : 'FOG rejected the group deletion. No member hosts were deleted directly.',
      });
    }
  });

  router.get('/groups/:id', async (req, res, next) => {
    try {
      const model = await groupWorkspaceModel(req.params.id);
      return res.render('pages/groups/show', {
        title: model.group.name || 'Group', currentPath: '/groups', ...model,
        membersUpdated: req.query.members === 'updated',
        created: req.query.created === '1',
        updated: req.query.updated === '1',
      });
    } catch (error) {
      if (error.status === 404 || error instanceof TypeError) return next();
      return res.status(503).render('pages/error', {
        title: 'Group unavailable', currentPath: '/groups', status: 503,
        message: messageFor(error),
      });
    }
  });

  router.get('/groups/:id/members/edit', async (req, res, next) => {
    try {
      const [group, members, computers] = await Promise.all([
        fog.groups.get(req.params.id), fog.groups.members(req.params.id), fog.hosts.list(),
      ]);
      return res.render('pages/groups/edit-members', {
        title: `Manage ${group.name} membership`, currentPath: '/groups', group, computers,
        selectedIds: new Set(members.map((member) => member.id)), formError: '',
      });
    } catch (error) {
      if (error.status === 404 || error instanceof TypeError) return next();
      return res.status(503).render('pages/error', {
        title: 'Group membership unavailable', currentPath: '/groups', status: 503,
        message: messageFor(error),
      });
    }
  });

  router.post('/groups/:id/members', requireCsrf, async (req, res, next) => {
    const requestedIds = req.body.hostIds || [];
    if (req.body.confirm !== '1') {
      return res.status(422).send('Confirm the group membership change before submitting.');
    }
    try {
      await fog.groups.updateMembers(req.params.id, requestedIds);
      return res.redirect(303, `/groups/${req.params.id}?members=updated`);
    } catch (error) {
      if (error.status === 404 || error instanceof TypeError) return next();
      if (error.code === 'FOG_VALIDATION_ERROR' || error.code === 'FOG_CONFLICT') {
        try {
          const [group, computers] = await Promise.all([
            fog.groups.get(req.params.id), fog.hosts.list(),
          ]);
          const selected = Array.isArray(requestedIds) ? requestedIds : [requestedIds];
          return res.status(error.code === 'FOG_CONFLICT' ? 409 : 422).render('pages/groups/edit-members', {
            title: `Manage ${group.name} membership`, currentPath: '/groups', group, computers,
            selectedIds: new Set(selected.map(Number)), formError: error.message,
          });
        } catch (loadError) {
          return next(loadError);
        }
      }
      const status = error.status === 403 ? 403 : 502;
      return res.status(status).render('pages/error', {
        title: 'Group update failed', currentPath: '/groups', status,
        message: error.status === 403
          ? 'The configured FOG API user is not authorized to update groups.'
          : 'FOG rejected the membership update. No database workaround was attempted.',
      });
    }
  });

  router.get('/tasks', async (req, res) => {
    const allowedStatuses = new Set(['active', 'running', 'queued', 'completed', 'failed', 'cancelled', 'all']);
    const status = allowedStatuses.has(String(req.query.status)) ? String(req.query.status) : 'active';
    const isLiveStatus = ['active', 'running', 'queued'].includes(status);
    const [tasks, multicast] = await Promise.all([
      settle(() => isLiveStatus ? fog.tasks.listActive() : fog.tasks.list()),
      isLiveStatus
        ? settle(() => fog.multicast.listActive())
        : Promise.resolve({ data: [], error: null }),
    ]);
    const filteredTasks = tasks.data.filter((task) => {
      if (status === 'all') return true;
      if (status === 'active') return ['running', 'queued'].includes(task.category);
      return task.category === status;
    });
    const model = {
      tasks: filteredTasks.map((task) => ({ ...task, tone: taskTone(task) })),
      status,
      multicastSessions: multicast.data
        .filter((session) => status === 'active' || session.category === status)
        .map((session) => ({ ...session, tone: taskTone(session) })),
      error: tasks.error || multicast.error,
    };
    if (req.get('HX-Request') === 'true') {
      return res.render('pages/tasks/results', model);
    }
    return res.render('pages/tasks/index', {
      title: 'Active Tasks',
      currentPath: '/tasks',
      ...model,
    });
  });

  return router;
}
