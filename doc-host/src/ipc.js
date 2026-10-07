'use strict';

const { ipcMain } = require('electron');
const { paneOf } = require('./workspace-model');
const { parseIntent, intentIds } = require('./ui-intents');

// Routes messages from the preloads. The sender decides where a message
// belongs; messages never carry a target path. doc:* go to the document
// whose view sent them (anything else is ignored, the host UI included), and
// the document checks the load tag of every message but doc:hello. ui:intent
// is accepted only from the host-UI view (a document can never send one),
// and only as an intent that parseIntent accepts.
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
  ipcMain.on('ui:intent', (event, payload) => {
    const { hostUi } = workspace;
    if (!hostUi || event.sender.id !== hostUi.webContentsId) return;
    const intent = parseIntent(payload, intentIds(workspace.model));
    if (intent) hostUi.onIntent(intent);
  });
}

module.exports = { registerIpc };
