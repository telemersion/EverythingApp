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
  process.on('exit', () => {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch (err) {
      console.log(`[probe] could not remove ${dir}: ${err.message}`);
    }
  });
}

// The probe fails if no document reports "done" within ms of the start, for
// example when the probe document never opens (a sheet would wait forever).
function armProbeDeadline(ms = 60000) {
  setTimeout(() => {
    console.log('[probe] FAIL timeout: no probe document finished');
    app.exit(1);
  }, ms).unref();
}

// doc: the Document the probe runs in (the first one opened). mainChecks:
// a promise of the main process's own probe lines (resolver-rules.js),
// printed once the document reports "done". SKIP lines do not fail the run.
function attachProbe(doc, { mainChecks = Promise.resolve([]) } = {}) {
  let failed = false;
  const print = (line) => {
    console.log(line);
    if (line.includes('FAIL')) failed = true;
  };
  doc.view.webContents.on('console-message', async (event) => {
    const { message } = event;
    if (!message || !message.startsWith('[probe]')) return;
    if (message !== '[probe] done') {
      print(message);
      return;
    }
    try {
      for (const line of await mainChecks) print(line);
    } catch (err) {
      print(`[probe] FAIL main-process checks (${err.message})`);
    }
    console.log(message);
    console.log(`[probe] exiting with ${failed ? 1 : 0}`);
    app.exit(failed ? 1 : 0);
  });
  setTimeout(() => {
    console.log('[probe] FAIL timeout: the probe did not finish');
    app.exit(1);
  }, 15000);
}

module.exports = { isolateUserData, armProbeDeadline, attachProbe };
