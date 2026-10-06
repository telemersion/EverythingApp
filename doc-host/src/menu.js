'use strict';

const { Menu, shell } = require('electron');

// current() returns the focused DocumentWindow or null.
function buildMenu({ current, showOpenDialog, isDev }) {
  const isMac = process.platform === 'darwin';
  const withDoc = (fn) => () => {
    const doc = current();
    if (doc) fn(doc);
  };

  const template = [
    ...(isMac ? [{ role: 'appMenu' }] : []),
    {
      label: 'File',
      submenu: [
        { label: 'Open…', accelerator: 'CmdOrCtrl+O', click: () => showOpenDialog() },
        { type: 'separator' },
        { label: 'Close', accelerator: 'CmdOrCtrl+W', click: withDoc((doc) => doc.win.close()) },
        { type: 'separator' },
        { label: isMac ? 'Reveal in Finder' : 'Show in folder', click: withDoc((doc) => shell.showItemInFolder(doc.filePath)) },
        ...(isMac ? [] : [{ type: 'separator' }, { role: 'quit' }]),
      ],
    },
    { role: 'editMenu' },
    {
      label: 'View',
      submenu: [
        ...(isDev ? [{
          label: 'Developer Tools',
          accelerator: isMac ? 'Alt+Cmd+I' : 'Ctrl+Shift+I',
          click: withDoc((doc) => doc.view.webContents.toggleDevTools()),
        }] : []),
      ],
    },
    { role: 'windowMenu' },
  ];
  return Menu.buildFromTemplate(template);
}

module.exports = { buildMenu };
