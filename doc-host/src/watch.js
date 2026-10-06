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
// still there (if not, the document reports its file as missing). The first
// error restarts at once; further errors in a row wait retryMs, doubling up
// to a minute, until the new watcher reports an event.
function watchFile(filePath, onChange, { debounceMs = 200, retryMs = 1000, watch = fs.watch } = {}) {
  const dir = path.dirname(filePath);
  const name = path.basename(filePath);
  let timer = null;
  let retry = null;
  let watcher = null;
  let failures = 0; // errors since the last event
  let closed = false;

  function changed() {
    clearTimeout(timer);
    timer = setTimeout(onChange, debounceMs);
  }

  function start() {
    const current = watch(dir, (_event, file) => {
      failures = 0;
      if (file && file.toString() !== name) return;
      changed();
    });
    watcher = current;
    current.on('error', () => {
      if (current.failed) return; // one restart per watcher
      current.failed = true;
      current.close();
      if (watcher === current) watcher = null;
      if (closed) return;
      changed();
      failures++;
      if (failures === 1) restart();
      else retry = setTimeout(restart, Math.min(retryMs * 2 ** (failures - 2), 60000));
    });
  }

  function restart() {
    retry = null;
    if (closed || !fs.existsSync(dir)) return;
    try {
      start();
    } catch {
      // folder vanished in between: stop watching
    }
  }

  start();
  return {
    close() {
      closed = true;
      clearTimeout(timer);
      clearTimeout(retry);
      if (watcher) watcher.close();
    },
  };
}

module.exports = { sectionHashes, classifyChange, watchFile };
