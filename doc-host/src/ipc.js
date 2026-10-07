'use strict';

const path = require('node:path');
const { ipcMain } = require('electron');

// Routes messages from the preload to their document. The sender decides
// which document a message belongs to; messages never carry a target path.
// The document checks the load tag of doc:dirty and doc:save-data.
function registerIpc({ registry, open }) {
  ipcMain.on('doc:hello', (event, loadId) => registry.bySender(event.sender.id)?.onHello(loadId));
  ipcMain.on('doc:dirty', (event, payload) => registry.bySender(event.sender.id)?.onDirty(payload));
  ipcMain.on('doc:save-data', (event, payload) => registry.bySender(event.sender.id)?.onSaveData(payload));
  ipcMain.on('doc:dropped-files', (event, paths) => {
    if (!registry.bySender(event.sender.id) || !Array.isArray(paths)) return;
    for (const p of paths) if (typeof p === 'string' && path.isAbsolute(p)) open(p);
  });
}

module.exports = { registerIpc };
