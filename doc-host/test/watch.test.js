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
