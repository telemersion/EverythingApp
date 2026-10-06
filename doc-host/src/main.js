'use strict';

const path = require('node:path');
const { app, BaseWindow, Menu, dialog } = require('electron');
const { registerSchemePrivileges } = require('./protocol');
const { Registry } = require('./registry');
const { registerIpc } = require('./ipc');
const { openPath } = require('./open');
const { buildMenu } = require('./menu');
const { pathsFromArgv } = require('./argv');
const { attachProbe } = require('./probe');
const { showError } = require('./errors');

app.setName('EverythingApp');
registerSchemePrivileges();

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  const registry = new Registry();
  const storeDir = () => path.join(app.getPath('userData'), 'versions');
  // Every open route (dialog, Finder, second instance, argv, drop) ends here.
  const open = (p) => openPath(p, { registry, storeDir: storeDir() }).then((doc) => {
    if (doc && process.env.EV_PROBE) attachProbe(doc);
    return doc;
  }).catch((err) => showError({ action: 'open', filePath: p, err }));
  const current = () => {
    const win = BaseWindow.getFocusedWindow();
    return win ? registry.byWindow(win) : null;
  };

  async function showOpenDialog() {
    let result;
    try {
      result = await dialog.showOpenDialog({
        properties: ['openFile', 'multiSelections'],
        filters: [{ name: 'EverythingApp documents', extensions: ['html', 'htm'] }, { name: 'All files', extensions: ['*'] }],
      });
    } catch (err) {
      await showError({ action: 'show the open dialog', err });
      return;
    }
    if (!result.canceled) for (const p of result.filePaths) await open(p);
  }

  registerIpc({ registry, open });

  // macOS: files dropped on the dock icon or opened via Finder.
  const early = [];
  app.on('open-file', (event, p) => {
    event.preventDefault();
    if (app.isReady()) open(p);
    else early.push(p);
  });

  app.on('second-instance', (_event, argv, cwd) => {
    for (const p of pathsFromArgv(argv, { isPackaged: app.isPackaged, cwd })) open(p);
  });

  app.whenReady().then(async () => {
    Menu.setApplicationMenu(buildMenu({ current, showOpenDialog, isDev: !app.isPackaged }));
    const paths = [...early, ...pathsFromArgv(process.argv, { isPackaged: app.isPackaged, cwd: process.cwd() })];
    for (const p of paths) await open(p);
    if (paths.length === 0) await showOpenDialog();
    if (registry.documents.size === 0 && process.platform !== 'darwin') app.quit();
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin' || process.env.EV_PROBE) app.quit();
  });
}
