'use strict';

// Test support (only active with EV_PROBE=1): prints the document's
// "[probe]" console lines to stdout and quits when it reports "done".
// Exit code 1 if any line says FAIL.
const { app } = require('electron');

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

module.exports = { attachProbe };
