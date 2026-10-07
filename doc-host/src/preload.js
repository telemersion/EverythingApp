'use strict';

// Host API v1 (window.evHost). Runs sandboxed, in an isolated world.
const { contextBridge, ipcRenderer, webUtils, webFrame } = require('electron');

// Every page load announces a random id before it sends anything else and
// tags its messages with it: the host ignores messages from earlier loads
// (load-tags.js).
const loadId = crypto.randomUUID();
ipcRenderer.send('doc:hello', loadId);

// Subframes receive no pointer input (see the drop handling below). Inserted
// here so it is in place before any document script runs; security.js inserts
// it again on dom-ready as a backstop. Copy of NO_IFRAME_INPUT in
// security.js (this sandboxed preload cannot require it): keep them equal.
const NO_IFRAME_INPUT = 'iframe, frame, frameset { pointer-events: none !important; }';
try {
  webFrame.insertCSS(NO_IFRAME_INPUT, { cssOrigin: 'user' });
} catch {
  // the dom-ready insert in security.js still applies
}

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
  ipcRenderer.send('doc:save-data', { loadId, requestId, json, changes, error });
});

contextBridge.exposeInMainWorld('evHost', {
  version: 1,
  onSaveRequest: (handler) => {
    if (typeof handler === 'function') saveHandler = handler;
  },
  markDirty: () => ipcRenderer.send('doc:dirty', { loadId, counter: ++changes }),
});

// Files dropped onto a document open in the host. The preload's capture
// listeners are registered before any document script, so they run first and
// stop file drags completely: the document never sees dropped files, neither
// paths nor contents (not even dataTransfer.items during dragover). Only real
// drops from the user (isTrusted) open anything. This preload does not run
// inside iframes the document creates (about:blank, srcdoc); the host's user
// style (security.js) gives iframes no pointer input, so drags and drops
// over an iframe arrive here, at the document. Known limit of M1: a document
// that calls document.open() after loading erases every listener on the page,
// these included (the user style survives); it then receives dropped files.
function hasFiles(event) {
  return !!event.dataTransfer && Array.from(event.dataTransfer.types).includes('Files');
}

for (const type of ['dragenter', 'dragover', 'dragleave', 'drag']) {
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
  if (paths.length) ipcRenderer.send('doc:dropped-files', { loadId, paths });
}, true);
