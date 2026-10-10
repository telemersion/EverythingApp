'use strict';

// Runs the escape probe against the packaged app (CI, before a release is
// uploaded): node tools/packaged-probe.js [app executable]
// The default executable is the one electron-builder's --dir or full build
// leaves in dist/ for this platform and architecture. EV_PROBE_NETWORK is
// passed through. Exits with the probe's exit code.
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

const root = path.join(__dirname, '..');
const defaults = {
  darwin: path.join(root, 'dist', process.arch === 'arm64' ? 'mac-arm64' : 'mac', 'EverythingApp.app', 'Contents', 'MacOS', 'EverythingApp'),
  win32: path.join(root, 'dist', 'win-unpacked', 'EverythingApp.exe'),
};
const exe = process.argv[2] ? path.resolve(process.argv[2]) : defaults[process.platform];
if (!exe || !fs.existsSync(exe)) {
  console.error(`No packaged app at ${exe || `(no default for ${process.platform})`}. Run npm run package first.`);
  process.exit(1);
}
const env = { ...process.env, EV_PROBE: '1' };
delete env.ELECTRON_RUN_AS_NODE;
const child = spawn(exe, [path.join(root, 'fixtures', 'escape-probe.ev.html')], { stdio: 'inherit', env });
child.on('exit', (code) => process.exit(code ?? 1));
