'use strict';

const path = require('node:path');
const { app, Menu, dialog, session, shell, autoUpdater: squirrel } = require('electron');
const { autoUpdater } = require('electron-updater');
const { registerSchemePrivileges } = require('./protocol');
const { registerIpc } = require('./ipc');
const { Workspace } = require('./workspace');
const { buildMenu } = require('./menu');
const { pathsFromArgv } = require('./argv');
const { isolateUserData, armProbeDeadline, attachProbe } = require('./probe');
const { hostResolverRules, mainProbeChecks } = require('./resolver-rules');
const { createHostLog } = require('./host-log');
const { runCleanup } = require('./cleanup');
const { createUpdates } = require('./updates');
const { aboutPanelOptions } = require('./help');

app.setName('EverythingApp');
// No names resolve but the update hosts: documents could leak data through
// DNS names (dns-prefetch). See resolver-rules.js.
app.commandLine.appendSwitch('host-resolver-rules', hostResolverRules());
registerSchemePrivileges();
if (process.env.EV_PROBE) {
  isolateUserData();
  armProbeDeadline();
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  let workspace = null;   // made once the app is ready
  let started = false;    // restore() is done: paths open at once
  const early = [];       // paths that arrived before that
  let probeAttached = false;

  // Every open route but drops (Finder, second instance, argv) ends here:
  // the focused pane. EV_PROBE: the probe runs in the first one opened.
  async function open(p) {
    const doc = await workspace.open(p, { source: 'os' });
    if (doc && process.env.EV_PROBE && !probeAttached) {
      probeAttached = true;
      const hostUiLoads = workspace.hostUi.ready.then(
        () => ['[probe] PASS host UI loads'],
        (err) => [`[probe] FAIL host UI loads (${err.message})`],
      );
      attachProbe(doc, {
        mainChecks: Promise.all([
          hostUiLoads,
          mainProbeChecks({
            resolveHost: (name) => session.defaultSession.resolveHost(name),
            expectNetwork: process.env.EV_PROBE_NETWORK === '1',
          }),
        ]).then((lines) => lines.flat()),
      });
    }
  }

  async function openAll(paths) {
    for (const p of paths) await open(p);
  }

  // macOS: files dropped on the dock icon or opened via Finder.
  app.on('open-file', (event, p) => {
    event.preventDefault();
    if (started) open(p);
    else early.push(p);
  });

  app.on('second-instance', (_event, argv, cwd) => {
    const paths = pathsFromArgv(argv, { isPackaged: app.isPackaged, cwd });
    if (!started) {
      early.push(...paths);
      return;
    }
    if (workspace.win.isMinimized()) workspace.win.restore();
    workspace.win.focus();
    openAll(paths);
  });

  // Quitting goes through the close summary; workspace.quit() exits once it
  // is confirmed.
  app.on('before-quit', (event) => {
    if (!workspace || workspace.quitConfirmed) return;
    event.preventDefault();
    workspace.quit();
  });

  app.on('window-all-closed', () => app.quit());

  app.whenReady().then(async () => {
    const userData = app.getPath('userData');
    const log = createHostLog(path.join(userData, 'logs', 'host.log'));
    const probe = Boolean(process.env.EV_PROBE);
    if (process.platform === 'darwin') {
      app.setAboutPanelOptions(aboutPanelOptions({ version: app.getVersion(), electron: process.versions.electron }));
    }
    autoUpdater.logger = {
      info: () => {},
      warn: (message) => log.write(`updater: ${message}`),
      error: (message) => log.write(`updater: ${message}`),
    };
    // The workspace is made after the Move to Applications offer: a move
    // relaunches the host, and quitting must not write an empty workspace.json.
    const updates = createUpdates({
      updater: autoUpdater,
      app,
      dialog,
      log,
      packaged: app.isPackaged,
      platform: process.platform,
      probe,
      nativeUpdater: app.isPackaged && process.platform === 'darwin' ? squirrel : null,
      workspace: {
        setNotice: (notice) => workspace.setNotice(notice),
        removeNotice: (kind) => workspace.removeNotice(kind),
        sheet: (options) => workspace.sheet(options),
        showError: (args) => workspace.showError(args),
        quit: (options) => workspace.quit(options),
      },
    });
    // Moved: this instance quits and the one in Applications starts instead.
    if (await updates.offerMove()) return;
    workspace = new Workspace({
      storeDir: path.join(userData, 'versions'),
      workspaceFile: path.join(userData, 'workspace.json'),
      allowDevTools: !app.isPackaged,
    });
    workspace.exit = (options) => updates.exit(options);
    workspace.onNoticeAction = (kind, action) => updates.noticeAction(kind, action);
    workspace.checkForUpdates = () => updates.checkNow();
    workspace.showLog = async () => {
      await log.write('log shown');
      shell.showItemInFolder(log.file);
    };
    workspace.menu = buildMenu({ workspace, isDev: !app.isPackaged });
    Menu.setApplicationMenu(workspace.menu);
    registerIpc({ workspace });
    try {
      await workspace.restore();
    } catch (err) {
      await workspace.showError({ action: 'restore the workspace', err });
    }
    started = true;
    // Background work nobody asked for: never a sheet, only the host log.
    updates.start();
    if (!probe) {
      runCleanup({
        storeDir: path.join(userData, 'versions'),
        openPaths: new Set(workspace.openDocuments().map((doc) => doc.filePath)),
        log,
      }).catch((err) => log.write('clean-up failed', err));
    }
    // No open dialog: the empty state offers Open… (Task 10).
    await openAll([...early.splice(0), ...pathsFromArgv(process.argv, { isPackaged: app.isPackaged, cwd: process.cwd() })]);
  });
}
