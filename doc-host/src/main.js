'use strict';

const path = require('node:path');
const { app, Menu, session } = require('electron');
const { registerSchemePrivileges } = require('./protocol');
const { registerIpc } = require('./ipc');
const { Workspace } = require('./workspace');
const { buildMenu } = require('./menu');
const { pathsFromArgv } = require('./argv');
const { isolateUserData, attachProbe } = require('./probe');
const { hostResolverRules, mainProbeChecks } = require('./resolver-rules');
const { createHostLog } = require('./host-log');
const { runCleanup } = require('./cleanup');

app.setName('EverythingApp');
// No names resolve but the update hosts: documents could leak data through
// DNS names (dns-prefetch). See resolver-rules.js.
app.commandLine.appendSwitch('host-resolver-rules', hostResolverRules());
registerSchemePrivileges();
if (process.env.EV_PROBE) isolateUserData();

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
    const doc = await workspace.open(p);
    if (doc && process.env.EV_PROBE && !probeAttached) {
      probeAttached = true;
      attachProbe(doc, {
        mainChecks: mainProbeChecks({
          resolveHost: (name) => session.defaultSession.resolveHost(name),
          expectNetwork: process.env.EV_PROBE_NETWORK === '1',
        }),
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
    workspace = new Workspace({
      storeDir: path.join(userData, 'versions'),
      workspaceFile: path.join(userData, 'workspace.json'),
      allowDevTools: !app.isPackaged,
    });
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
    if (!process.env.EV_PROBE) {
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
