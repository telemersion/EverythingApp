'use strict';

const os = require('node:os');
const path = require('node:path');
const { version } = require('../package.json');

function headline({ action, filePath }) {
  return `EverythingApp could not ${action}${filePath ? ` ${path.basename(filePath)}` : ''}.`;
}

// The text shown in the error sheet and copied by "Copy report".
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

// The sheet for an unexpected error: its message box options and the report
// that "Copy report" (button 0) copies.
function errorBox({ action, filePath, err }) {
  const report = formatErrorReport({ action, filePath, err });
  return {
    report,
    options: {
      type: 'error',
      message: headline({ action, filePath }),
      detail: report,
      buttons: ['Copy report', 'OK'],
      defaultId: 1,
      cancelId: 1,
    },
  };
}

module.exports = { formatErrorReport, errorBox };
