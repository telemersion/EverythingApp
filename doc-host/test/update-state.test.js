'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { nextStatus, noticeFor, manualCheckSheet } = require('../src/update-state');

const idle = { state: 'idle' };

test('updater events move the status', () => {
  assert.deepEqual(nextStatus(idle, { type: 'checking' }), { state: 'checking' });
  assert.deepEqual(nextStatus({ state: 'checking' }, { type: 'available', version: '0.2.0' }), { state: 'downloading', version: '0.2.0' });
  assert.deepEqual(nextStatus({ state: 'checking' }, { type: 'not-available' }), { state: 'current' });
  assert.deepEqual(nextStatus({ state: 'downloading', version: '0.2.0' }, { type: 'downloaded', version: '0.2.0' }), { state: 'ready', version: '0.2.0' });
  assert.deepEqual(nextStatus({ state: 'checking' }, { type: 'error', message: 'offline' }), { state: 'error', message: 'offline' });
});

test('a ready update stays ready', () => {
  const ready = { state: 'ready', version: '0.2.0' };
  for (const event of [{ type: 'checking' }, { type: 'not-available' }, { type: 'error', message: 'offline' }]) {
    assert.deepEqual(nextStatus(ready, event), ready, event.type);
  }
  assert.deepEqual(nextStatus(ready, { type: 'available', version: '0.2.0' }), ready, 'the same version again');
  assert.deepEqual(nextStatus(ready, { type: 'available', version: '0.3.0' }), { state: 'downloading', version: '0.3.0' });
  assert.deepEqual(nextStatus(ready, { type: 'downloaded', version: '0.3.0' }), { state: 'ready', version: '0.3.0' });
});

test('noticeFor: only a ready update that was not dismissed', () => {
  assert.deepEqual(noticeFor({ state: 'ready', version: '0.2.0' }, null), { kind: 'update', version: '0.2.0' });
  assert.equal(noticeFor({ state: 'ready', version: '0.2.0' }, '0.2.0'), null);
  assert.deepEqual(noticeFor({ state: 'ready', version: '0.3.0' }, '0.2.0'), { kind: 'update', version: '0.3.0' });
  assert.equal(noticeFor({ state: 'downloading', version: '0.2.0' }, null), null);
});

const base = { currentVersion: '0.1.0', packaged: true, inApplications: true, platform: 'darwin' };

test('manual check sheets', () => {
  assert.deepEqual(manualCheckSheet({ ...base, packaged: false, status: idle }),
    { message: 'Updates are only available in installed builds.', detail: '', buttons: ['OK'] });
  assert.deepEqual(manualCheckSheet({ ...base, inApplications: false, status: idle }),
    { message: "Updates can't install from here.", detail: 'Move EverythingApp to the Applications folder, then open it from there.', buttons: ['OK'] });
  assert.deepEqual(manualCheckSheet({ ...base, status: { state: 'current' } }),
    { message: "You're up to date.", detail: 'EverythingApp 0.1.0 is the newest version.', buttons: ['OK'] });
  assert.deepEqual(manualCheckSheet({ ...base, status: { state: 'downloading', version: '0.2.0' } }),
    { message: 'EverythingApp 0.2.0 is downloading.', detail: 'It installs when you quit. You can keep working.', buttons: ['OK'] });
  assert.deepEqual(manualCheckSheet({ ...base, status: { state: 'ready', version: '0.2.0' } }),
    { message: 'EverythingApp 0.2.0 is ready.', detail: 'It installs when you quit.', buttons: ['Restart Now', 'Later'], action: 'restart' });
});

test('outside Applications only matters on macOS', () => {
  assert.equal(manualCheckSheet({ ...base, platform: 'win32', inApplications: false, status: { state: 'current' } }).message, "You're up to date.");
});

test('an error is not a sheet descriptor', () => {
  assert.equal(manualCheckSheet({ ...base, status: { state: 'error', message: 'offline' } }), null);
});
