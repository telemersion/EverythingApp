'use strict';

// Starts the host: node tools/start.js [--probe | --smoke] [file ...]
// Clears ELECTRON_RUN_AS_NODE, which terminals inside VS Code set and which
// would make Electron behave like plain Node. --probe enables src/probe.js;
// --smoke runs tools/smoke.js instead of the app, with the test-only kits
// (EV_TEST_KITS=1).
const path = require('node:path');
const { spawn } = require('node:child_process');
const electron = require('electron');

const args = process.argv.slice(2);
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
let entry = '.';
if (args[0] === '--probe') {
  args.shift();
  env.EV_PROBE = '1';
} else if (args[0] === '--smoke') {
  args.shift();
  entry = 'tools/smoke.js';
  env.EV_TEST_KITS = '1'; // the kit-update steps use the test-only kit 1.9.0
}
const files = args.map((f) => path.resolve(f));
const child = spawn(electron, [entry, ...files], { stdio: 'inherit', env, cwd: path.join(__dirname, '..') });
child.on('exit', (code, signal) => {
  if (entry !== '.' || env.EV_PROBE) console.log(`[start] Electron exited (code ${code}, signal ${signal})`);
  process.exit(code ?? 1);
});
