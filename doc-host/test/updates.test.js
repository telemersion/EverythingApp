'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { createUpdates } = require('../src/updates');

function fakes({ inApplications = true, checkFails = null } = {}) {
  const calls = [];
  const updater = new EventEmitter();
  updater.checkForUpdates = async () => {
    calls.push('check');
    if (checkFails) throw checkFails;
    return {};
  };
  updater.quitAndInstall = (isSilent, isForceRunAfter) => calls.push(['quitAndInstall', isSilent, isForceRunAfter]);
  const app = {
    getVersion: () => '0.1.0',
    isInApplicationsFolder: () => inApplications,
    moveToApplicationsFolder: () => { calls.push('move'); return true; },
    relaunch: () => calls.push('relaunch'),
    exit: (code) => calls.push(['exit', code]),
  };
  const notices = [];
  const sheets = [];
  const workspace = {
    sheetAnswer: 1,
    setNotice: (n) => notices.push(['set', n]),
    removeNotice: (kind) => notices.push(['remove', kind]),
    sheet: async (options) => { sheets.push(options); return workspace.sheetAnswer; },
    showError: async ({ action, err }) => sheets.push({ error: action, message: err.message }),
    quit: async (opts) => calls.push(['quit', opts]),
  };
  const logged = [];
  const log = { write: async (message, err) => logged.push(err ? `${message}: ${err.message}` : message) };
  const dialog = { showMessageBox: async (options) => { sheets.push(options); return { response: dialog.answer }; }, answer: 1 };
  return { calls, updater, app, workspace, notices, sheets, log, logged, dialog };
}

function make(f, opts = {}) {
  return createUpdates({ updater: f.updater, app: f.app, workspace: f.workspace, log: f.log, dialog: f.dialog,
    packaged: true, platform: 'darwin', probe: false, ...opts });
}

test('the updater downloads on its own and installs on quit', () => {
  const f = fakes();
  make(f);
  assert.equal(f.updater.autoDownload, true);
  assert.equal(f.updater.autoInstallOnAppQuit, true);
});

test('checks once 2000 ms after start in a packaged build', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const f = fakes();
  make(f).start();
  t.mock.timers.tick(1999);
  assert.deepEqual(f.calls, []);
  t.mock.timers.tick(1);
  assert.deepEqual(f.calls, ['check']);
  t.mock.timers.tick(60000);
  assert.deepEqual(f.calls, ['check']);
});

test('never checks unpackaged', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const f = fakes();
  make(f, { packaged: false }).start();
  t.mock.timers.tick(5000);
  assert.deepEqual(f.calls, []);
});

test('no move offer and no check under EV_PROBE', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const f = fakes({ inApplications: false });
  const updates = make(f, { probe: true });
  await updates.offerMove();
  updates.start();
  t.mock.timers.tick(5000);
  assert.deepEqual(f.calls, []);
  assert.deepEqual(f.sheets, []);
});

test('no automatic check outside Applications on darwin', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const f = fakes({ inApplications: false });
  make(f).start();
  t.mock.timers.tick(5000);
  assert.deepEqual(f.calls, []);
});

test('outside Applications is fine on Windows', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const f = fakes({ inApplications: false });
  make(f, { platform: 'win32' }).start();
  t.mock.timers.tick(2000);
  assert.deepEqual(f.calls, ['check']);
});

test('downloaded sets the update notice', () => {
  const f = fakes();
  const updates = make(f);
  f.updater.emit('update-available', { version: '0.2.0' });
  assert.deepEqual(f.notices, []);
  f.updater.emit('update-downloaded', { version: '0.2.0' });
  assert.deepEqual(f.notices, [['set', { kind: 'update', version: '0.2.0' }]]);
  assert.deepEqual(updates.status(), { state: 'ready', version: '0.2.0' });
});

test('Later hides it for this version only', () => {
  const f = fakes();
  const updates = make(f);
  f.updater.emit('update-downloaded', { version: '0.2.0' });
  updates.noticeAction('update', 'dismiss');
  f.updater.emit('update-downloaded', { version: '0.2.0' });
  f.updater.emit('update-downloaded', { version: '0.3.0' });
  assert.deepEqual(f.notices, [
    ['set', { kind: 'update', version: '0.2.0' }],
    ['set', { kind: 'update', version: '0.3.0' }],
  ]);
});

test('Restart Now quits through the workspace with restart', () => {
  const f = fakes();
  const updates = make(f);
  updates.noticeAction('update', 'restart');
  assert.deepEqual(f.calls, [['quit', { restart: true }]]);
});

test('exit installs a ready update', () => {
  const f = fakes();
  const updates = make(f);
  f.updater.emit('update-downloaded', { version: '0.2.0' });
  updates.exit({ restart: false });
  assert.deepEqual(f.calls, [['quitAndInstall', true, false]]);
  assert.equal(f.updater.autoRunAppAfterInstall, false, 'a plain quit stays closed (macOS ignores the argument)');
});

test('exit with restart and a ready update', () => {
  const f = fakes();
  const updates = make(f);
  f.updater.emit('update-downloaded', { version: '0.2.0' });
  updates.exit({ restart: true });
  assert.deepEqual(f.calls, [['quitAndInstall', true, true]]);
  assert.equal(f.updater.autoRunAppAfterInstall, true);
});

test('exit without update', () => {
  const f = fakes();
  make(f).exit({ restart: false });
  assert.deepEqual(f.calls, [['exit', 0]]);
});

test('restart without update', () => {
  const f = fakes();
  make(f).exit({ restart: true });
  assert.deepEqual(f.calls, ['relaunch', ['exit', 0]]);
});

test('an automatic check error goes to the log, not a sheet', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const f = fakes({ checkFails: new Error('offline') });
  make(f).start();
  t.mock.timers.tick(2000);
  t.mock.timers.reset();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(f.sheets, []);
  assert.deepEqual(f.logged, ['update check failed: offline']);
});

test('a manual check error shows the error sheet', async () => {
  const f = fakes({ checkFails: new Error('offline') });
  await make(f).checkNow();
  assert.deepEqual(f.sheets, [{ error: 'check for updates', message: 'offline' }]);
});

test('a manual check answers with the sheet for the status', async () => {
  const f = fakes();
  f.updater.checkForUpdates = async () => { f.updater.emit('update-not-available', {}); return {}; };
  await make(f).checkNow();
  assert.equal(f.sheets[0].message, "You're up to date.");
  assert.equal(f.sheets[0].detail, 'EverythingApp 0.1.0 is the newest version.');
});

test('a manual check unpackaged says so without checking', async () => {
  const f = fakes();
  await make(f, { packaged: false }).checkNow();
  assert.deepEqual(f.calls, []);
  assert.equal(f.sheets[0].message, 'Updates are only available in installed builds.');
});

test('the ready sheet\'s Restart Now restarts', async () => {
  const f = fakes();
  const updates = make(f);
  f.updater.checkForUpdates = async () => { f.updater.emit('update-downloaded', { version: '0.2.0' }); return {}; };
  f.workspace.sheetAnswer = 0;
  await updates.checkNow();
  assert.deepEqual(f.sheets.at(-1).buttons, ['Restart Now', 'Later']);
  assert.deepEqual(f.calls.at(-1), ['quit', { restart: true }]);
});

test('Move to Applications: offered on darwin outside Applications', async () => {
  const f = fakes({ inApplications: false });
  f.dialog.answer = 0;
  assert.equal(await make(f).offerMove(), true, 'moved: the caller stops starting up');
  assert.equal(f.sheets[0].message, 'Move EverythingApp to the Applications folder?');
  assert.equal(f.sheets[0].detail, 'Updates only work from there.');
  assert.deepEqual(f.sheets[0].buttons, ['Move', 'Not Now']);
  assert.deepEqual(f.calls, ['move']);
});

test('Move to Applications: Not Now, already there, or not macOS', async () => {
  const notNow = fakes({ inApplications: false });
  assert.equal(await make(notNow).offerMove(), false);
  assert.deepEqual(notNow.calls, []);
  const there = fakes({ inApplications: true });
  await make(there).offerMove();
  assert.deepEqual(there.sheets, []);
  const win = fakes({ inApplications: false });
  await make(win, { platform: 'win32' }).offerMove();
  assert.deepEqual(win.sheets, []);
});

test('a failing move is logged and the start goes on', async () => {
  const f = fakes({ inApplications: false });
  f.dialog.answer = 0;
  f.app.moveToApplicationsFolder = () => { throw new Error('read-only'); };
  assert.equal(await make(f).offerMove(), false);
  assert.deepEqual(f.logged, ['moving to Applications failed: read-only']);
});

test('a move that does not happen lets the start go on', async () => {
  const f = fakes({ inApplications: false });
  f.dialog.answer = 0;
  f.app.moveToApplicationsFolder = () => false;
  assert.equal(await make(f).offerMove(), false);
});

test('on macOS the update is ready only once Squirrel has it', () => {
  const f = fakes();
  const nativeUpdater = new EventEmitter();
  const updates = make(f, { nativeUpdater });
  f.updater.emit('update-downloaded', { version: '0.2.0' });
  assert.deepEqual(f.notices, [], 'downloaded, but Squirrel has not fetched it yet');
  assert.notEqual(updates.status().state, 'ready');
  updates.exit({ restart: true });
  assert.deepEqual(f.calls, ['relaunch', ['exit', 0]], 'not ready: nothing to install yet');
  nativeUpdater.emit('update-downloaded');
  assert.deepEqual(f.notices, [['set', { kind: 'update', version: '0.2.0' }]]);
  assert.deepEqual(updates.status(), { state: 'ready', version: '0.2.0' });
});

test('a later check keeps the downloaded update ready', () => {
  const f = fakes();
  const updates = make(f);
  f.updater.emit('update-downloaded', { version: '0.2.0' });
  f.updater.emit('checking-for-update');
  f.updater.emit('update-available', { version: '0.2.0' });
  assert.deepEqual(updates.status(), { state: 'ready', version: '0.2.0' });
});
