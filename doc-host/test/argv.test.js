'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathsFromArgv } = require('../src/argv');

test('development: skips electron and the app folder', () => {
  const argv = ['/x/Electron', '.', 'a.ev.html', '--inspect', '/abs/b.html'];
  assert.deepEqual(pathsFromArgv(argv, { isPackaged: false, cwd: '/work' }), [path.resolve('/work', 'a.ev.html'), path.resolve('/abs/b.html')]);
});

test('packaged: skips only the executable', () => {
  assert.deepEqual(pathsFromArgv(['/App', 'c.html'], { isPackaged: true, cwd: '/w' }), [path.resolve('/w', 'c.html')]);
});
