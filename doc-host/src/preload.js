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

// Files dropped onto a document open in the host. The preload's capture
// listeners are registered before any document script, so they run first and
// stop file drags completely: the document never sees dropped files, neither
// paths nor contents (not even dataTransfer.items during dragover). Only real
// drops from the user (isTrusted) open anything. This preload does not run
// inside iframes the document creates (about:blank, srcdoc); the host's user
// style (security.js) gives iframes no pointer input, so drags and drops
// over an iframe arrive here, at the document.
function hasFiles(event) {
  return !!event.dataTransfer && Array.from(event.dataTransfer.types).includes('Files');
}

for (const type of ['dragenter', 'dragover']) {
  window.addEventListener(type, (event) => {
    if (!event.isTrusted || !hasFiles(event)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
  }, true);
}

window.addEventListener('drop', (event) => {
  if (!event.isTrusted || !hasFiles(event)) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  const paths = Array.from(event.dataTransfer.files)
    .map((file) => webUtils.getPathForFile(file))
    .filter(Boolean);
  if (paths.length) ipcRenderer.send('doc:dropped-files', paths);
}, true);
