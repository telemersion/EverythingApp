'use strict';

const path = require('node:path');

// File paths from a command line. In development argv is
// [electron, '.', ...files]; in a packaged app it is [app, ...files].
// Chromium switches (starting with "-") are skipped.
function pathsFromArgv(argv, { isPackaged, cwd }) {
  return argv
    .slice(isPackaged ? 1 : 2)
    .filter((arg) => arg && !arg.startsWith('-'))
    .map((arg) => path.resolve(cwd, arg));
}

module.exports = { pathsFromArgv };
