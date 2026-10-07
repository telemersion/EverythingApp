'use strict';

const { ipcMain } = require('electron');
const { paneOf } = require('./workspace-model');

// Routes messages from the preload to their document. The sender decides
// which document a message belongs to; messages never carry a target path.
// The document checks the load tag of every message but doc:hello.
function registerIpc({ workspace }) {
  const documentOf = (event) => workspace.registry.bySender(event.sender.id);
  ipcMain.on('doc:hello', (event, loadId) => documentOf(event)?.onHello(loadId));
  ipcMain.on('doc:dirty', (event, payload) => documentOf(event)?.onDirty(payload));
  ipcMain.on('doc:save-data', (event, payload) => documentOf(event)?.onSaveData(payload));
  // Files dropped on a document open in that document's pane, one by one.
  ipcMain.on('doc:dropped-files', async (event, payload) => {
    const doc = documentOf(event);
    if (!doc) return;
    for (const p of doc.droppedPaths(payload)) {
      await workspace.open(p, { paneId: paneOf(workspace.model, doc.id) ?? undefined });
    }
  });
}

module.exports = { registerIpc };
