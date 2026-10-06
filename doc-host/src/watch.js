'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { buildDocument } = require('./frame');
const { sha256 } = require('./hash');

// Behaviour is everything except the data block: the frame fields, style,
// kit and script. Hashing the document with an empty data block covers it.
function sectionHashes(parts) {
  return {
    behaviour: sha256(buildDocument({ ...parts, data: '' })),
    data: sha256(parts.data),
  };
}

function classifyChange(before, after) {
  return {
    behaviour: before.behaviour !== after.behaviour,
    data: before.data !== after.data,
  };
}

// Calls onChange (debounced) whenever the file may have changed. Watches the
// folder, because an atomic save replaces the file with a new one. A watcher
// error also counts as a possible change; watching resumes if the folder is
// still there (if not, the document reports its file as missing).
function watchFile(filePath, onChange, { debounceMs = 200, watch = fs.watch } = {}) {
  const dir = path.dirname(filePath);
  const name = path.basename(filePath);
  let timer = null;
  let watcher = null;
  let closed = false;

  function changed() {
    clearTimeout(timer);
    timer = setTimeout(onChange, debounceMs);
  }

  function start() {
    watcher = watch(dir, (_event, file) => {
      if (file && file.toString() !== name) return;
      changed();
    });
    watcher.on('error', () => {
      watcher.close();
      watcher = null;
      changed();
      if (closed || !fs.existsSync(dir)) return;
      try {
        start();
      } catch {
        watcher = null; // folder vanished in between: stop watching
      }
    });
  }

  start();
  return {
    close() {
      closed = true;
      clearTimeout(timer);
      if (watcher) watcher.close();
    },
  };
}

module.exports = { sectionHashes, classifyChange, watchFile };
