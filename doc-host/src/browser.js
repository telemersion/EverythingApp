'use strict';

const childProcess = require('node:child_process');
const path = require('node:path');

// Opens a file in the app that handles https:// links, launched with the
// file directly. Never through the file association: when EverythingApp is
// the default for .html, that would send the file straight back. Resolves
// false, opening nothing, when there is no such app or it is EverythingApp.
async function openInBrowser(filePath, { app, spawn = childProcess.spawn, platform = process.platform }) {
  let handler;
  try {
    handler = await app.getApplicationInfoForProtocol('https://');
  } catch {
    return false;
  }
  if (!handler || !handler.path) return false;
  const exe = app.getPath('exe');
  const sep = platform === 'win32' ? path.win32.sep : path.posix.sep;
  if (exe === handler.path || exe.startsWith(handler.path + sep)) return false;
  const [command, args] = platform === 'darwin'
    ? ['open', ['-a', handler.path, filePath]]
    : [handler.path, [filePath]];
  const child = spawn(command, args, { detached: true, stdio: 'ignore' });
  if (typeof child.on === 'function') child.on('error', () => {}); // a failed start must not crash the host
  child.unref();
  return true;
}

module.exports = { openInBrowser };
