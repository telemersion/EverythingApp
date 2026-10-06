'use strict';

// Host API v1 (window.evHost). Runs sandboxed, in an isolated world.
const { contextBridge, ipcRenderer, webUtils } = require('electron');

let saveHandler = null;
let changes = 0;

ipcRenderer.on('doc:request-save', (_event, requestId) => {
  let json = null;
  let error = null;
  if (!saveHandler) {
    error = 'The document did not register a save handler (evHost.onSaveRequest).';
  } else {
    try {
      json = saveHandler();
    } catch (err) {
      error = `The document failed to produce its data: ${err && err.message ? err.message : err}`;
    }
  }
  ipcRenderer.send('doc:save-data', { requestId, json, changes, error });
});

contextBridge.exposeInMainWorld('evHost', {
  version: 1,
  onSaveRequest: (handler) => {
    if (typeof handler === 'function') saveHandler = handler;
  },
  markDirty: () => ipcRenderer.send('doc:dirty', ++changes),
});

// Files dropped onto a document open in the host. Only real drops from the
// user count (isTrusted); the document never sees the paths.
function hasFiles(event) {
  return !!event.dataTransfer && Array.from(event.dataTransfer.types).includes('Files');
}

window.addEventListener('dragover', (event) => {
  if (hasFiles(event)) event.preventDefault();
}, true);

window.addEventListener('drop', (event) => {
  if (!event.isTrusted || !hasFiles(event)) return;
  event.preventDefault();
  event.stopPropagation();
  const paths = Array.from(event.dataTransfer.files)
    .map((file) => webUtils.getPathForFile(file))
    .filter(Boolean);
  if (paths.length) ipcRenderer.send('doc:dropped-files', paths);
}, true);
