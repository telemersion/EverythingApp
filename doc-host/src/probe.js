'use strict';

// Test support (only active with EV_PROBE=1): prints the document's
// "[probe]" console lines to stdout and quits when it reports "done".
// Exit code 1 if any line says FAIL.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { app } = require('electron');

// The probe gets a userData directory of its own, removed when it exits: it
// never restores or writes the user's workspace or version store, and never
// meets the single-instance lock of a running EverythingApp. Call before the
// app is ready.
function isolateUserData() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ev-probe-'));
  app.setPath('userData', dir);
  process.on('exit', () => fs.rmSync(dir, { recursive: true, force: true }));
}

// doc: the Document the probe runs in (the first one opened).
function attachProbe(doc) {
  let failed = false;
  doc.view.webContents.on('console-message', (event) => {
    const { message } = event;
    if (!message || !message.startsWith('[probe]')) return;
    console.log(message);
    if (message.includes('FAIL')) failed = true;
    if (message === '[probe] done') app.exit(failed ? 1 : 0);
  });
  setTimeout(() => {
    console.log('[probe] FAIL timeout: the probe did not finish');
    app.exit(1);
  }, 15000);
}

module.exports = { isolateUserData, attachProbe };
