'use strict';

const os = require('node:os');
const path = require('node:path');
const { dialog, clipboard } = require('electron');
const { version } = require('../package.json');

function headline({ action, filePath }) {
  return `EverythingApp could not ${action}${filePath ? ` ${path.basename(filePath)}` : ''}.`;
}

// The text shown in the error dialog and copied by "Copy report".
function formatErrorReport({ action, filePath, err }) {
  const lines = [
    headline({ action, filePath }),
    `File: ${filePath || '(none)'}`,
    '',
    `Error: ${err && err.message ? err.message : String(err)}`,
    '',
    (err && err.stack) || '(no stack trace)',
    '',
    `EverythingApp ${version}, Electron ${process.versions.electron}, ${process.platform} ${os.release()} (${process.arch})`,
  ];
  return lines.join('\n');
}

// For errors nothing else handled. The dialog belongs to no window, so it
// also shows while a document has its own dialog open. Never rejects.
async function showError({ action, filePath, err }) {
  const report = formatErrorReport({ action, filePath, err });
  try {
    const { response } = await dialog.showMessageBox({
      type: 'error',
      message: headline({ action, filePath }),
      detail: report,
      buttons: ['Copy report', 'OK'],
      defaultId: 1,
      cancelId: 1,
    });
    if (response === 0) clipboard.writeText(report);
  } catch (dialogErr) {
    console.error(report, dialogErr);
  }
}

module.exports = { formatErrorReport, showError };
