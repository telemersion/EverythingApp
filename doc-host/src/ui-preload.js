'use strict';

// window.evUi for the host UI (src/ui). Runs sandboxed, in an isolated world.
// The page draws the state the main process pushes and sends intents; the
// main process accepts ui:intent only from this view's web contents and
// checks every intent (ui-intents.js).
const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('evUi', {
  onState: (callback) => {
    if (typeof callback === 'function') ipcRenderer.on('ui:state', (_event, state) => callback(state));
  },
  onThumbnail: (callback) => {
    if (typeof callback === 'function') ipcRenderer.on('ui:thumbnail', (_event, docId, dataUrl) => callback(docId, dataUrl));
  },
  send: (intent) => ipcRenderer.send('ui:intent', intent),
});

// Files dropped on the host UI (list, tab strips, banner rows, the empty
// state) open in the focused pane. Copy of MAX_OPEN_FILES in ui-intents.js
// (this sandboxed preload cannot require it): one intent carries at most that
// many paths, so a larger drop is sent in parts.
const MAX_OPEN_FILES = 100;

function hasFiles(event) {
  return !!event.dataTransfer && Array.from(event.dataTransfer.types).includes('Files');
}

for (const type of ['dragenter', 'dragover']) {
  window.addEventListener(type, (event) => {
    if (!event.isTrusted || !hasFiles(event)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
  }, true);
}

window.addEventListener('drop', (event) => {
  if (!event.isTrusted || !hasFiles(event)) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  const paths = Array.from(event.dataTransfer.files)
    .map((file) => webUtils.getPathForFile(file))
    .filter(Boolean);
  for (let i = 0; i < paths.length; i += MAX_OPEN_FILES) {
    ipcRenderer.send('ui:intent', { type: 'open-files', paths: paths.slice(i, i + MAX_OPEN_FILES) });
  }
}, true);
