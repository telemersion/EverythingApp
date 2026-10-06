'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { pathKey, selectVersionsToDelete, writeDocument } = require('../src/write');
const { splice } = require('../src/splice');
const { makeDocument } = require('./helpers');

const tempDirs = [];

// Every test works in its own mkdtemp directory; all are removed afterwards.
test.after(async () => {
  for (const dir of tempDirs) {
    await fs.chmod(dir, 0o755).catch(() => {});
    await fs.rm(dir, { recursive: true, force: true });
  }
});

async function mkTemp(prefix) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

async function setup() {
  const dir = await mkTemp('ev-write-');
  const filePath = path.join(dir, 'sample.ev.html');
  const storeDir = path.join(dir, 'store');
  await fs.writeFile(filePath, makeDocument(), 'utf8');
  return { dir, filePath, storeDir };
}

test('writeDocument changes only the data block and returns the new content', async () => {
  const { filePath, storeDir } = await setup();
  const original = await fs.readFile(filePath, 'utf8');
  const result = await writeDocument(filePath, '{"rows":[{"hours":3}]}', { storeDir });
  const onDisk = await fs.readFile(filePath, 'utf8');
  assert.equal(onDisk, splice(original, '{"rows":[{"hours":3}]}'));
  assert.equal(result, onDisk);
});

test('writeDocument keeps the previous file and meta.json in the version store', async () => {
  const { filePath, storeDir } = await setup();
  const original = await fs.readFile(filePath, 'utf8');
  await writeDocument(filePath, '{"rows":[]}', { storeDir, now: new Date('2026-10-06T10:00:00.000Z') });
  const entry = path.join(storeDir, pathKey(filePath));
  const names = (await fs.readdir(entry)).sort();
  assert.deepEqual(names, ['2026-10-06T10-00-00-000Z.html', 'meta.json']);
  assert.equal(await fs.readFile(path.join(entry, names[0]), 'utf8'), original);
  const meta = JSON.parse(await fs.readFile(path.join(entry, 'meta.json'), 'utf8'));
  assert.equal(meta.fileName, 'sample.ev.html');
  assert.equal(meta.docType, 'test-doc');
  assert.equal(meta.lastSeen, '2026-10-06T10:00:00.000Z');
});

test('two saves in the same millisecond keep both versions', async () => {
  const { filePath, storeDir } = await setup();
  const now = new Date('2026-10-06T10:00:00.000Z');
  await writeDocument(filePath, '{"n":1}', { storeDir, now });
  await writeDocument(filePath, '{"n":2}', { storeDir, now });
  const names = await fs.readdir(path.join(storeDir, pathKey(filePath)));
  assert.equal(names.filter((n) => n.endsWith('.html')).length, 2);
});

test('writeDocument leaves no .tmp file behind', async () => {
  const { dir, filePath, storeDir } = await setup();
  await writeDocument(filePath, '{}', { storeDir });
  assert.deepEqual((await fs.readdir(dir)).sort(), ['sample.ev.html', 'store']);
});

test('a non-conforming file on disk is not touched', async () => {
  const { filePath, storeDir } = await setup();
  const broken = makeDocument().replace('<head>\n', '<head>\n  <meta name="x" content="y">\n');
  await fs.writeFile(filePath, broken, 'utf8');
  await assert.rejects(writeDocument(filePath, '{}', { storeDir }), /no longer follows the document specification/);
  assert.equal(await fs.readFile(filePath, 'utf8'), broken);
});

test('invalid JSON is rejected before anything is written', async () => {
  const { filePath, storeDir } = await setup();
  const original = await fs.readFile(filePath, 'utf8');
  await assert.rejects(writeDocument(filePath, '{nope', { storeDir }), SyntaxError);
  assert.equal(await fs.readFile(filePath, 'utf8'), original);
  await assert.rejects(fs.access(storeDir));
});

test('a write that cannot create the .tmp file leaves the original intact', {
  skip: process.platform === 'win32' && 'chmod does not make folders read-only on Windows',
}, async () => {
  const { dir } = await setup();
  const storeDir = await mkTemp('ev-store-ro-');
  const target = path.join(dir, 'locked.ev.html');
  await fs.writeFile(target, makeDocument(), 'utf8');
  const original = await fs.readFile(target, 'utf8');
  await fs.chmod(dir, 0o555); // read-only folder: the .tmp file cannot be created
  try {
    await assert.rejects(writeDocument(target, '{}', { storeDir }));
  } finally {
    await fs.chmod(dir, 0o755);
  }
  assert.equal(await fs.readFile(target, 'utf8'), original);
  assert.ok(!(await fs.readdir(dir)).some((n) => n.endsWith('.tmp')));
});

test('selectVersionsToDelete keeps the newest 20 plus one per day for 30 days', () => {
  const now = new Date('2026-10-31T12:00:00.000Z');
  const names = [];
  // Oct 1–31, three saves a day.
  for (let day = 1; day <= 31; day++) {
    for (const hour of ['08', '12', '16']) {
      names.push(`2026-10-${String(day).padStart(2, '0')}T${hour}-00-00-000Z.html`);
    }
  }
  names.push('meta.json');
  const doomed = selectVersionsToDelete(names, now);
  const kept = names.filter((n) => n.endsWith('.html') && !doomed.includes(n));
  // Newest 20 cover Oct 25 (16h) to Oct 31; one per day for Oct 2–24.
  assert.equal(kept.length, 20 + 23);
  assert.ok(!kept.includes('2026-10-01T16-00-00-000Z.html'), 'older than 30 days');
  assert.ok(kept.includes('2026-10-02T16-00-00-000Z.html'));
  assert.ok(!kept.includes('2026-10-02T08-00-00-000Z.html'));
  assert.ok(!doomed.includes('meta.json'));
});
