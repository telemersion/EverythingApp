'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { sectionHashes, classifyChange, watchFile } = require('../src/watch');
const { makeParts } = require('./helpers');

test('a data change is not a behaviour change', () => {
  const before = sectionHashes(makeParts());
  const after = sectionHashes(makeParts({ data: '{"rows":[]}' }));
  assert.deepEqual(classifyChange(before, after), { behaviour: false, data: true });
});

test('script, style and title changes are behaviour changes', () => {
  const before = sectionHashes(makeParts());
  for (const change of [{ script: '\n// v2\n' }, { style: '\n/* v2 */\n' }, { title: 'Renamed' }]) {
    assert.deepEqual(classifyChange(before, sectionHashes(makeParts(change))), { behaviour: true, data: false });
  }
});

test('identical parts are no change', () => {
  assert.deepEqual(classifyChange(sectionHashes(makeParts()), sectionHashes(makeParts())), { behaviour: false, data: false });
});

test('watchFile reports a replaced file once, debounced, and ignores siblings', async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ev-watch-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'doc.ev.html');
  await fs.writeFile(file, 'v1');
  let calls = 0;
  const watcher = watchFile(file, () => { calls++; }, { debounceMs: 50 });
  try {
    // macOS reports the file's own creation late; let that settle first.
    await new Promise((r) => setTimeout(r, 300));
    calls = 0;
    await fs.writeFile(path.join(dir, 'other.txt'), 'x');
    await new Promise((r) => setTimeout(r, 150));
    assert.equal(calls, 0, 'sibling files are ignored');
    await fs.writeFile(`${file}.tmp`, 'v2');
    await fs.rename(`${file}.tmp`, file);
    await new Promise((r) => setTimeout(r, 300));
    assert.equal(calls, 1);
  } finally {
    watcher.close();
  }
});

// A stand-in for fs.watch whose watchers can be made to fail on demand.
function fakeWatch() {
  const { EventEmitter } = require('node:events');
  const watchers = [];
  const watch = (_dir, listener) => {
    const watcher = new EventEmitter();
    watcher.on('change', listener); // as fs.watch does
    watcher.closed = false;
    watcher.close = () => { watcher.closed = true; };
    watchers.push(watcher);
    return watcher;
  };
  return { watch, watchers };
}

test('a watcher error reports a possible change once and watches again', async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ev-watch-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const { watch, watchers } = fakeWatch();
  let calls = 0;
  const watcher = watchFile(path.join(dir, 'doc.ev.html'), () => { calls++; }, { debounceMs: 20, watch });
  try {
    watchers[0].emit('error', new Error('boom'));
    assert.equal(watchers[0].closed, true, 'the dead watcher is closed');
    assert.equal(watchers.length, 2, 'the folder still exists: a new watcher started');
    assert.equal(calls, 0, 'debounced');
    await new Promise((r) => setTimeout(r, 60));
    assert.equal(calls, 1);
  } finally {
    watcher.close();
  }
  assert.equal(watchers[1].closed, true);
});

test('repeated watcher errors restart with a growing delay, not in a loop', async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ev-watch-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const { watch, watchers } = fakeWatch();
  const watcher = watchFile(path.join(dir, 'doc.ev.html'), () => {}, { debounceMs: 20, retryMs: 40, watch });
  try {
    watchers[0].emit('error', new Error('boom'));
    assert.equal(watchers.length, 2, 'the first error restarts at once');
    watchers[1].emit('error', new Error('boom again'));
    assert.equal(watchers.length, 2, 'a second error in a row waits');
    await new Promise((r) => setTimeout(r, 60));
    assert.equal(watchers.length, 3, 'restarted after the delay');
    watchers[2].emit('change', 'change', 'other.txt'); // the new watcher works
    watchers[2].emit('error', new Error('later'));
    assert.equal(watchers.length, 4, 'a working watcher resets the delay');
  } finally {
    watcher.close();
  }
});

test('a watcher error after close does nothing', async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ev-watch-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const { watch, watchers } = fakeWatch();
  let calls = 0;
  const watcher = watchFile(path.join(dir, 'doc.ev.html'), () => { calls++; }, { debounceMs: 20, watch });
  watcher.close();
  watchers[0].emit('error', new Error('late'));
  await new Promise((r) => setTimeout(r, 60));
  assert.equal(calls, 0, 'no change reported');
  assert.equal(watchers.length, 1, 'no new watcher');
});

test('a watcher error on a missing folder reports once and stops watching', async () => {
  const { watch, watchers } = fakeWatch();
  let calls = 0;
  const missing = path.join(os.tmpdir(), `ev-watch-missing-${process.pid}-${Date.now()}`, 'doc.ev.html');
  const watcher = watchFile(missing, () => { calls++; }, { debounceMs: 20, watch });
  watchers[0].emit('error', new Error('gone'));
  assert.equal(watchers.length, 1, 'no new watcher');
  await new Promise((r) => setTimeout(r, 60));
  assert.equal(calls, 1);
  watcher.close();
});
