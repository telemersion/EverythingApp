'use strict';

const { Menu, shell } = require('electron');
const { showError } = require('./errors');

// current() returns the focused DocumentWindow or null.
function buildMenu({ current, showOpenDialog, isDev }) {
  const isMac = process.platform === 'darwin';
  // Runs fn on the focused document; anything it throws is shown as "could
  // not <action> <file>".
  const withDoc = (action, fn) => () => {
    const doc = current();
    if (!doc) return;
    Promise.resolve()
      .then(() => fn(doc))
      .catch((err) => showError({ action, filePath: doc.filePath, err }));
  };

  const template = [
    ...(isMac ? [{ role: 'appMenu' }] : []),
    {
      label: 'File',
      submenu: [
        { label: 'Open…', accelerator: 'CmdOrCtrl+O', click: () => showOpenDialog() },
        { type: 'separator' },
        { label: 'Save', accelerator: 'CmdOrCtrl+S', click: withDoc('save', (doc) => doc.save()) },
        { label: 'Close', accelerator: 'CmdOrCtrl+W', click: withDoc('close', (doc) => doc.win.close()) },
        { type: 'separator' },
        { label: isMac ? 'Reveal in Finder' : 'Show in folder', click: withDoc('show', (doc) => shell.showItemInFolder(doc.filePath)) },
        ...(isMac ? [] : [{ type: 'separator' }, { role: 'quit' }]),
      ],
    },
    { role: 'editMenu' },
    {
      label: 'View',
      submenu: [
        { label: 'Reload', accelerator: 'CmdOrCtrl+R', click: withDoc('reload', (doc) => doc.reloadInteractive()) },
        ...(isDev ? [{
          label: 'Developer Tools',
          accelerator: isMac ? 'Alt+Cmd+I' : 'Ctrl+Shift+I',
          click: withDoc('open the developer tools for', (doc) => doc.view.webContents.toggleDevTools()),
        }] : []),
      ],
    },
    { role: 'windowMenu' },
  ];
  return Menu.buildFromTemplate(template);
}

module.exports = { buildMenu };
