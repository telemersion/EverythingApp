'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { readDocumentFile } = require('../src/open');
const { makeDocument } = require('./helpers');

const FIXTURE = path.join(__dirname, '..', 'fixtures', 'hours-sheet.ev.html');

const tempDirs = [];

test.after(async () => {
  for (const dir of tempDirs) await fs.rm(dir, { recursive: true, force: true });
});

// realpath: the temporary directory may sit behind a symlink (/var → /private/var).
async function mkTemp() {
  const dir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'ev-open-')));
  tempDirs.push(dir);
  return dir;
}

test('readDocumentFile classifies files', async () => {
  const dir = await mkTemp();

  const good = path.join(dir, 'hours.ev.html');
  await fs.copyFile(FIXTURE, good);
  const document = await readDocumentFile(good);
  assert.equal(document.kind, 'document');
  assert.equal(document.filePath, good);
  assert.equal(document.check.ok, true);
  assert.equal(document.check.text, await fs.readFile(good, 'utf8'));
  assert.equal(document.check.parts.docType, 'hours-sheet');

  const plain = path.join(dir, 'page.html');
  await fs.writeFile(plain, '<!doctype html><title>Plain</title><p>Hello</p>\n');
  assert.deepEqual(await readDocumentFile(plain), { kind: 'not-document', filePath: plain });

  const broken = path.join(dir, 'broken.ev.html');
  await fs.writeFile(broken, makeDocument({ docType: 'Not A Type' }));
  const refused = await readDocumentFile(broken);
  assert.equal(refused.kind, 'refused');
  assert.equal(refused.filePath, broken);
  assert.match(refused.report, /^EverythingApp could not open broken\.ev\.html\.\n/);
  assert.ok(refused.report.includes(`File: ${broken}`), 'the report names the file');
  assert.ok(refused.report.includes('[field]'), 'the report lists the problem');
  assert.deepEqual(refused.codes, ['field']);

  const newer = path.join(dir, 'newer.ev.html');
  await fs.writeFile(newer, makeDocument({ api: '99' }));
  const tooNew = await readDocumentFile(newer);
  assert.equal(tooNew.kind, 'refused');
  assert.deepEqual(tooNew.codes, ['api-newer']);

  const missing = path.join(dir, 'gone.ev.html');
  const error = await readDocumentFile(missing);
  assert.equal(error.kind, 'error');
  assert.equal(error.filePath, missing);
  assert.equal(error.code, 'ENOENT');
  assert.match(error.message, /ENOENT/);

  const folder = path.join(dir, 'folder.ev.html');
  await fs.mkdir(folder);
  const notFile = await readDocumentFile(folder);
  assert.equal(notFile.kind, 'error');
  assert.equal(notFile.message, 'This is not a file.');
});

test('readDocumentFile resolves relative paths and symlinks', async () => {
  const dir = await mkTemp();
  const real = path.join(dir, 'hours.ev.html');
  await fs.copyFile(FIXTURE, real);
  const link = path.join(dir, 'link.ev.html');
  await fs.symlink(real, link);
  assert.equal((await readDocumentFile(link)).filePath, real);
  assert.equal((await readDocumentFile(path.relative(process.cwd(), real))).filePath, real);
});

test('readDocumentFile returns the path as stored on disk', async (t) => {
  const dir = await mkTemp();
  await fs.copyFile(FIXTURE, path.join(dir, 'hours.ev.html'));
  const upper = path.join(dir, 'HOURS.EV.HTML');
  const caseInsensitive = await fs.access(upper).then(() => true, () => false);
  if (!caseInsensitive) {
    t.skip('this volume is case-sensitive');
    return;
  }
  const result = await readDocumentFile(upper);
  assert.equal(result.kind, 'document');
  assert.equal(path.basename(result.filePath), 'hours.ev.html');
  assert.equal(result.filePath, path.join(dir, 'hours.ev.html'));
});
