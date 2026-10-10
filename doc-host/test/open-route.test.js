'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { nonDocumentAction } = require('../src/open-route');
const { openInBrowser } = require('../src/browser');

test('a non-document from the system goes to the browser, anything else gets the sheet', () => {
  assert.equal(nonDocumentAction('os'), 'browser');
  assert.equal(nonDocumentAction('user'), 'sheet');
  assert.equal(nonDocumentAction(undefined), 'sheet');
});

function fakes({ handler = { name: 'Google Chrome', path: '/Applications/Google Chrome.app' }, exe = '/Applications/EverythingApp.app/Contents/MacOS/EverythingApp' } = {}) {
  const spawned = [];
  const app = {
    getApplicationInfoForProtocol: async () => {
      if (handler instanceof Error) throw handler;
      return handler;
    },
    getPath: (name) => (name === 'exe' ? exe : null),
  };
  const spawn = (command, args, options) => {
    spawned.push([command, args, options]);
    return { unref: () => spawned.push('unref') };
  };
  return { app, spawn, spawned };
}

test('darwin opens the file with the https handler, not the file association', async () => {
  const f = fakes();
  assert.equal(await openInBrowser('/tmp/a.html', { app: f.app, spawn: f.spawn, platform: 'darwin' }), true);
  assert.deepEqual(f.spawned, [['open', ['-a', '/Applications/Google Chrome.app', '/tmp/a.html'], { detached: true, stdio: 'ignore' }], 'unref']);
});

test('win32 starts the browser with the path', async () => {
  const f = fakes({ handler: { name: 'Microsoft Edge', path: 'C:\\Program Files\\Edge\\msedge.exe' }, exe: 'C:\\Users\\a\\AppData\\Local\\Programs\\EverythingApp\\EverythingApp.exe' });
  assert.equal(await openInBrowser('C:\\docs\\a.html', { app: f.app, spawn: f.spawn, platform: 'win32' }), true);
  assert.deepEqual(f.spawned, [['C:\\Program Files\\Edge\\msedge.exe', ['C:\\docs\\a.html'], { detached: true, stdio: 'ignore' }], 'unref']);
});

test('EverythingApp as the https handler is never used', async () => {
  const f = fakes({ handler: { name: 'EverythingApp', path: '/Applications/EverythingApp.app' } });
  assert.equal(await openInBrowser('/tmp/a.html', { app: f.app, spawn: f.spawn, platform: 'darwin' }), false);
  assert.deepEqual(f.spawned, []);
});

test('no handler, or a failing lookup, opens nothing', async () => {
  for (const handler of [new Error('none'), { name: '', path: '' }, null]) {
    const f = fakes({ handler });
    assert.equal(await openInBrowser('/tmp/a.html', { app: f.app, spawn: f.spawn, platform: 'darwin' }), false);
    assert.deepEqual(f.spawned, []);
  }
});
