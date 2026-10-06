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
// folder, because an atomic save replaces the file with a new one.
function watchFile(filePath, onChange, { debounceMs = 200 } = {}) {
  const name = path.basename(filePath);
  let timer = null;
  const watcher = fs.watch(path.dirname(filePath), (_event, changed) => {
    if (changed && changed.toString() !== name) return;
    clearTimeout(timer);
    timer = setTimeout(onChange, debounceMs);
  });
  watcher.on('error', () => {});
  return {
    close() {
      clearTimeout(timer);
      watcher.close();
    },
  };
}

module.exports = { sectionHashes, classifyChange, watchFile };
