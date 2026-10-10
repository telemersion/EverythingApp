'use strict';

// The kit-update tests need an older kit: the test-only kit 1.9.0.
process.env.EV_TEST_KITS = '1';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { pathKey, selectVersionsToDelete, writeDocument } = require('../src/write');
const { splice } = require('../src/splice');
const { parseDocument } = require('../src/frame');
const { findKit, currentKit } = require('../kit');
const { sectionHashes } = require('../src/watch');
const { makeDocument, makeParts } = require('./helpers');

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
  assert.deepEqual(await fs.readdir(storeDir), [], 'no version was stored');
});

test('a save keeps the file permissions', { skip: process.platform === 'win32' && 'POSIX modes' }, async () => {
  const { filePath, storeDir } = await setup();
  await fs.chmod(filePath, 0o600);
  await writeDocument(filePath, '{"n":1}', { storeDir });
  assert.equal((await fs.stat(filePath)).mode & 0o7777, 0o600);
});

test('a read-only file is refused and stays unchanged', { skip: process.platform === 'win32' && 'POSIX modes' }, async () => {
  const { filePath, storeDir } = await setup();
  const original = await fs.readFile(filePath, 'utf8');
  await fs.chmod(filePath, 0o444);
  await assert.rejects(writeDocument(filePath, '{"n":1}', { storeDir }), /The file is read-only\./);
  assert.equal(await fs.readFile(filePath, 'utf8'), original);
  assert.equal((await fs.stat(filePath)).mode & 0o7777, 0o444);
  await assert.rejects(fs.access(storeDir), 'no version was stored');
  await fs.chmod(filePath, 0o644); // so the clean-up can remove it everywhere
});

test('a file that is not valid UTF-8 is refused and stays unchanged', async () => {
  const { filePath, storeDir } = await setup();
  const [head, tail] = makeDocument({ script: '\n// f\u00e4hrt\n' }).split('f\u00e4hrt');
  const bytes = Buffer.concat([Buffer.from(head, 'utf8'), Buffer.from('f\u00e4hrt', 'latin1'), Buffer.from(tail, 'utf8')]);
  await fs.writeFile(filePath, bytes);
  await assert.rejects(writeDocument(filePath, '{}', { storeDir }), /not valid UTF-8/);
  assert.deepEqual(await fs.readFile(filePath), bytes);
});

test('saves of an unchanged file store its version once', async () => {
  const { filePath, storeDir } = await setup();
  await writeDocument(filePath, '{"n":1}', { storeDir, now: new Date('2026-10-06T10:00:00.000Z') });
  await writeDocument(filePath, '{"n":1}', { storeDir, now: new Date('2026-10-06T10:00:01.000Z') });
  await writeDocument(filePath, '{"n":1}', { storeDir, now: new Date('2026-10-06T10:00:02.000Z') });
  const names = (await fs.readdir(path.join(storeDir, pathKey(filePath)))).filter((n) => n.endsWith('.html'));
  // The original, then the file with {"n":1} once (the third save finds it again).
  assert.deepEqual(names.sort(), ['2026-10-06T10-00-00-000Z.html', '2026-10-06T10-00-01-000Z.html']);
});

test('writeDocument writes when the data on disk has the expected hash', async () => {
  const { filePath, storeDir } = await setup();
  const expectedDataHash = sectionHashes(makeParts()).data;
  await writeDocument(filePath, '{"n":1}', { storeDir, expectedDataHash });
  assert.match(await fs.readFile(filePath, 'utf8'), /\{"n":1\}/);
});

test('writeDocument refuses with EV_DATA_CONFLICT when the data on disk changed', async () => {
  const { filePath, storeDir } = await setup();
  const original = await fs.readFile(filePath, 'utf8');
  const expectedDataHash = sectionHashes(makeParts({ data: '{"rows":[]}' })).data;
  await assert.rejects(writeDocument(filePath, '{"n":1}', { storeDir, expectedDataHash }), { code: 'EV_DATA_CONFLICT' });
  assert.equal(await fs.readFile(filePath, 'utf8'), original);
  await assert.rejects(fs.access(storeDir), 'no version was stored');
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

async function setupOutdated() {
  const dir = await mkTemp('ev-write-');
  const filePath = path.join(dir, 'old.ev.html');
  const storeDir = path.join(dir, 'store');
  const old = findKit('1.9.0');
  await fs.writeFile(filePath, makeDocument({ kitVersion: old.version, kit: old.text }), 'utf8');
  return { dir, filePath, storeDir };
}

async function storedVersions(filePath, storeDir) {
  const entry = path.join(storeDir, pathKey(filePath));
  const names = (await fs.readdir(entry)).filter((n) => n.endsWith('.html'));
  return Promise.all(names.map((n) => fs.readFile(path.join(entry, n), 'utf8')));
}

test('writeDocument with a kit and no data replaces only the kit and keeps the previous file', async () => {
  const { filePath, storeDir } = await setupOutdated();
  const original = await fs.readFile(filePath, 'utf8');
  const result = await writeDocument(filePath, null, { storeDir, kit: currentKit() });
  const onDisk = await fs.readFile(filePath, 'utf8');
  assert.equal(result, onDisk);
  assert.deepEqual(parseDocument(onDisk).parts, {
    ...parseDocument(original).parts,
    kitVersion: '2.0.0',
    kit: currentKit().text,
  });
  assert.deepEqual(await storedVersions(filePath, storeDir), [original]);
});

test('writeDocument with a kit and data replaces both in one write', async () => {
  const { filePath, storeDir } = await setupOutdated();
  const original = await fs.readFile(filePath, 'utf8');
  await writeDocument(filePath, '{"rows":[]}', { storeDir, kit: currentKit() });
  const onDisk = await fs.readFile(filePath, 'utf8');
  assert.deepEqual(parseDocument(onDisk).parts, {
    ...parseDocument(original).parts,
    data: '{"rows":[]}',
    kitVersion: '2.0.0',
    kit: currentKit().text,
  });
  assert.deepEqual(await storedVersions(filePath, storeDir), [original]);
});

test('writeDocument with neither data nor kit is refused and changes nothing', async () => {
  const { filePath, storeDir } = await setup();
  const original = await fs.readFile(filePath, 'utf8');
  await assert.rejects(writeDocument(filePath, null, { storeDir }), { name: 'TypeError', message: 'Nothing to write.' });
  assert.equal(await fs.readFile(filePath, 'utf8'), original);
  await assert.rejects(fs.readdir(storeDir), { code: 'ENOENT' });
});

test('a kit equal to the current kit still writes and stores a version', async () => {
  const { filePath, storeDir } = await setup();
  const original = await fs.readFile(filePath, 'utf8');
  await writeDocument(filePath, null, { storeDir, kit: currentKit() });
  assert.equal(await fs.readFile(filePath, 'utf8'), original);
  assert.deepEqual(await storedVersions(filePath, storeDir), [original]);
});

test('a kit write checks the expected data hash like a save', async () => {
  const { filePath, storeDir } = await setupOutdated();
  const original = await fs.readFile(filePath, 'utf8');
  await assert.rejects(
    writeDocument(filePath, null, { storeDir, kit: currentKit(), expectedDataHash: 'not-the-hash' }),
    { code: 'EV_DATA_CONFLICT' },
  );
  assert.equal(await fs.readFile(filePath, 'utf8'), original);
  const good = sectionHashes(parseDocument(original).parts).data;
  await writeDocument(filePath, null, { storeDir, kit: currentKit(), expectedDataHash: good });
  assert.equal(parseDocument(await fs.readFile(filePath, 'utf8')).parts.kitVersion, '2.0.0');
});
