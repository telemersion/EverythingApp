'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { volumeRoot, planCleanup, runCleanup, CAP_BYTES, ORPHAN_DAYS } = require('../src/cleanup');

const DAY = 24 * 60 * 60 * 1000;
const MB = 1024 * 1024;
const now = new Date('2026-10-10T12:00:00.000Z');
const daysAgo = (n) => new Date(now.getTime() - n * DAY).toISOString();

// An entry for planCleanup: versions are named by day, oldest first.
function entry(dir, state, { orphanedSince, versions = [['2026-10-01', 1]] } = {}) {
  return {
    dir,
    state,
    meta: { path: `/docs/${dir}.ev.html`, ...(orphanedSince ? { orphanedSince } : {}) },
    versions: versions.map(([day, mb]) => ({ file: `${dir}/${day}T00-00-00-000Z.html`, bytes: mb * MB })),
  };
}

const empty = { mark: [], unmark: [], removeEntries: [], removeVersions: [] };

test('constants: 500 MB and 90 days', () => {
  assert.equal(CAP_BYTES, 500 * 1024 * 1024);
  assert.equal(ORPHAN_DAYS, 90);
});

test('volumeRoot', () => {
  assert.equal(volumeRoot('/Volumes/Ddrive/03_personal/a.ev.html', 'darwin'), '/Volumes/Ddrive');
  assert.equal(volumeRoot('/Users/x/a.ev.html', 'darwin'), '/');
  assert.equal(volumeRoot('D:\\docs\\a.ev.html', 'win32'), 'D:\\');
  assert.equal(volumeRoot('\\\\srv\\share\\a.ev.html', 'win32'), '\\\\srv\\share\\');
  assert.equal(volumeRoot('/media/x/a.ev.html', 'linux'), '/');
});

test('marks a missing entry once', () => {
  assert.deepEqual(planCleanup([entry('a', 'missing')], { now }), { ...empty, mark: ['a'] });
  assert.deepEqual(planCleanup([entry('a', 'missing', { orphanedSince: daysAgo(3) })], { now }), empty);
});

test('unmarks an entry whose file is back', () => {
  assert.deepEqual(planCleanup([entry('a', 'live', { orphanedSince: daysAgo(3) })], { now }), { ...empty, unmark: ['a'] });
});

test('leaves an unreachable entry alone', () => {
  assert.deepEqual(planCleanup([entry('a', 'unreachable', { orphanedSince: daysAgo(200) })], { now }), empty);
  assert.deepEqual(planCleanup([entry('b', 'unreachable')], { now }), empty);
});

test('removes an entry orphaned 90 days ago, keeps one orphaned 89 days ago', () => {
  assert.deepEqual(planCleanup([entry('a', 'missing', { orphanedSince: daysAgo(90) })], { now }), { ...empty, removeEntries: ['a'] });
  assert.deepEqual(planCleanup([entry('a', 'missing', { orphanedSince: daysAgo(89) })], { now }), empty);
});

test('cap removes the oldest orphan first', () => {
  const plan = planCleanup([
    entry('young', 'missing', { orphanedSince: daysAgo(5), versions: [['2026-10-01', 200]] }),
    entry('old', 'missing', { orphanedSince: daysAgo(30), versions: [['2026-09-01', 200]] }),
    entry('live', 'live', { versions: [['2026-08-01', 150], ['2026-10-09', 100]] }),
  ], { now });
  assert.deepEqual(plan, { ...empty, removeEntries: ['old'] }); // 650 MB → 450 MB
});

test('cap removes the oldest versions of live entries next', () => {
  const plan = planCleanup([
    entry('orphan', 'missing', { versions: [['2026-10-01', 100]] }),
    entry('a', 'live', { versions: [['2026-07-01', 150], ['2026-10-09', 100]] }),
    entry('b', 'unreachable', { versions: [['2026-06-01', 150], ['2026-10-08', 150]] }),
  ], { now });
  // 650 MB: the orphan goes (550), then b's June version (400).
  assert.deepEqual(plan, {
    ...empty,
    mark: ['orphan'],
    removeEntries: ['orphan'],
    removeVersions: ['b/2026-06-01T00-00-00-000Z.html'],
  });
});

test('cap never removes a newest version', () => {
  const plan = planCleanup([
    entry('big', 'live', { versions: [['2026-08-01', 300], ['2026-09-01', 300], ['2026-10-01', 300]] }),
  ], { now });
  assert.deepEqual(plan.removeVersions, ['big/2026-08-01T00-00-00-000Z.html', 'big/2026-09-01T00-00-00-000Z.html']);
  assert.deepEqual(plan.removeEntries, []);
});

// ---------- runCleanup on a real store ----------

const tempDirs = [];
test.after(async () => {
  for (const dir of tempDirs) await fs.rm(dir, { recursive: true, force: true });
});

async function mkTemp() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ev-cleanup-'));
  tempDirs.push(dir);
  return dir;
}

async function storeEntry(storeDir, name, meta, versions = ['2026-10-01T00-00-00-000Z.html']) {
  const dir = path.join(storeDir, name);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, 'meta.json'), typeof meta === 'string' ? meta : JSON.stringify(meta));
  for (const v of versions) await fs.writeFile(path.join(dir, v), 'version');
  return dir;
}

function fakeLog() {
  const lines = [];
  return { lines, write: async (message, err) => { lines.push(err ? `${message}: ${err.message}` : message); } };
}

test('an open document\'s entry is live', async () => {
  const root = await mkTemp();
  const storeDir = path.join(root, 'versions');
  const gone = path.join(root, 'moved-while-open.ev.html');
  const dir = await storeEntry(storeDir, 'open', { path: gone, orphanedSince: daysAgo(120) });
  const log = fakeLog();
  await runCleanup({ storeDir, now, openPaths: new Set([gone]), log });
  const meta = JSON.parse(await fs.readFile(path.join(dir, 'meta.json'), 'utf8'));
  assert.equal(meta.orphanedSince, undefined);
  assert.ok((await fs.readdir(dir)).includes('2026-10-01T00-00-00-000Z.html'));
});

test('runCleanup marks, deletes old orphans and leaves a broken meta.json alone', async () => {
  const root = await mkTemp();
  const storeDir = path.join(root, 'versions');
  const live = path.join(root, 'live.ev.html');
  await fs.writeFile(live, 'doc');
  const liveDir = await storeEntry(storeDir, 'live', { path: live });
  const newDir = await storeEntry(storeDir, 'new-orphan', { path: path.join(root, 'gone', 'a.ev.html') });
  const oldDir = await storeEntry(storeDir, 'old-orphan', { path: path.join(root, 'b.ev.html'), orphanedSince: daysAgo(91) });
  const brokenDir = await storeEntry(storeDir, 'broken', '{ not json');
  const log = fakeLog();

  const result = await runCleanup({ storeDir, now, openPaths: new Set(), log });

  assert.deepEqual(result, { removedEntries: 1, removedVersions: 0 });
  const newMeta = JSON.parse(await fs.readFile(path.join(newDir, 'meta.json'), 'utf8'));
  assert.equal(newMeta.orphanedSince, now.toISOString());
  await assert.rejects(fs.access(oldDir));
  await fs.access(liveDir);
  await fs.access(brokenDir);
  assert.ok(log.lines.some((l) => l.includes('broken')), log.lines.join('\n'));
  assert.ok(log.lines.some((l) => l.startsWith('clean-up:')), log.lines.join('\n'));
});

test('runCleanup with no store does nothing', async () => {
  const root = await mkTemp();
  const result = await runCleanup({ storeDir: path.join(root, 'versions'), now, openPaths: new Set(), log: fakeLog() });
  assert.deepEqual(result, { removedEntries: 0, removedVersions: 0 });
});
