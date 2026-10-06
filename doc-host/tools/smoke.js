'use strict';

// End-to-end smoke test of the save loop, run as Electron's main script:
//   npm run smoke
// Opens a copy of the hours sheet, adds a row through the UI, saves,
// checks the file on disk, then simulates an agent editing the behaviour.
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const { app } = require('electron');
const { registerSchemePrivileges } = require('../src/protocol');
const { Registry } = require('../src/registry');
const { registerIpc } = require('../src/ipc');
const { openPath } = require('../src/open');
const { checkDocument } = require('../src/conformance');
const { parseDocument, buildDocument } = require('../src/frame');

registerSchemePrivileges();

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function until(label, condition, timeoutMs = 5000) {
  const start = Date.now();
  while (!(await condition())) {
    if (Date.now() - start > timeoutMs) throw new Error(`Timed out waiting for: ${label}`);
    await wait(50);
  }
}

function step(text) {
  console.log(`[smoke] ${text}`);
}

async function run(dir) {
  const filePath = path.join(dir, 'hours.ev.html');
  const storeDir = path.join(dir, 'store');
  await fs.copyFile(path.join(__dirname, '..', 'fixtures', 'hours-sheet.ev.html'), filePath);
  const original = await fs.readFile(filePath, 'utf8');

  const registry = new Registry();
  registerIpc({ registry, open: (p) => openPath(p, { registry, storeDir }) });
  const doc = await openPath(filePath, { registry, storeDir });
  assert.ok(doc, 'the fixture opens');
  const wc = doc.view.webContents;
  await until('page loaded', () => !wc.isLoading());
  const js = (code) => wc.executeJavaScript(code);

  step('the document runs hosted, without its own Save button');
  assert.equal(await js('!!document.getElementById("add") && !document.getElementById("save")'), true);

  step('adding a row marks the document dirty');
  await js('document.getElementById("add").click()');
  await until('dirty', () => doc.isDirty);
  assert.match(doc.win.getTitle(), /^• hours\.ev\.html$/);

  step('saving writes the row into the data block only');
  assert.equal(await doc.save(), true);
  const saved = await fs.readFile(filePath, 'utf8');
  assert.equal(checkDocument(saved).ok, true);
  const before = parseDocument(original).parts;
  const after = parseDocument(saved).parts;
  assert.deepEqual({ ...after, data: '' }, { ...before, data: '' }, 'everything but the data is unchanged');
  assert.equal(JSON.parse(after.data).rows.length, 1);
  assert.equal(doc.isDirty, false);
  assert.equal(doc.win.getTitle(), 'hours.ev.html');

  step('the previous version is in the version store');
  const [entry] = await fs.readdir(storeDir);
  const versions = (await fs.readdir(path.join(storeDir, entry))).filter((n) => n.endsWith('.html'));
  assert.equal(versions.length, 1);
  assert.equal(await fs.readFile(path.join(storeDir, entry, versions[0]), 'utf8'), original);

  step('an agent changes the behaviour on disk: a clean document reloads');
  const edited = buildDocument({ ...after, style: after.style + 'h1 { color: rgb(200, 0, 0); }\n' });
  await fs.writeFile(filePath, edited, 'utf8');
  await until('reloaded with the new style', async () =>
    !wc.isLoading() && (await js('getComputedStyle(document.querySelector("h1")).color')) === 'rgb(200, 0, 0)');
  assert.equal(await js('document.querySelectorAll("#rows tr").length'), 1, 'the saved row is still there');

  step('a data change on disk while dirty is never overwritten silently');
  await js('document.getElementById("add").click()');
  await until('dirty again', () => doc.isDirty);
  const external = buildDocument({ ...parseDocument(edited).parts, data: '{"rows":[]}' });
  await fs.writeFile(filePath, external, 'utf8');
  await until('conflict detected', () => doc.diskDataChanged);
  assert.equal(await fs.readFile(filePath, 'utf8'), external, 'the host did not write over the external content');

  step('all checks passed');
}

app.whenReady()
  .then(async () => {
    const dir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'ev-smoke-')));
    try {
      await run(dir);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  })
  .then(() => app.exit(0))
  .catch((err) => {
    console.error('[smoke] FAIL', err);
    app.exit(1);
  });
