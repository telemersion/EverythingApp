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
// Keep running if a step closes the window, so its assertion can report it.
app.on('window-all-closed', () => {});

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// A condition that throws or rejects (e.g. executeJavaScript while the page
// reloads) counts as not yet true.
async function until(label, condition, timeoutMs = 5000) {
  const start = Date.now();
  while (!(await Promise.resolve().then(condition).catch(() => false))) {
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
  await until('iframes receive no pointer input after the reload', async () => (await js(`(() => {
    const frame = document.body.appendChild(document.createElement('iframe'));
    const value = getComputedStyle(frame).pointerEvents;
    frame.remove();
    return value;
  })()`)) === 'none');

  step('a data change on disk while dirty is never overwritten silently');
  await js('document.getElementById("add").click()');
  await until('dirty again', () => doc.isDirty);
  const external = buildDocument({ ...parseDocument(edited).parts, data: '{"rows":[]}' });
  await fs.writeFile(filePath, external, 'utf8');
  await until('conflict detected', () => doc.diskDataChanged);
  assert.equal(await fs.readFile(filePath, 'utf8'), external, 'the host did not write over the external content');

  // Dialogs are answered by stubbing doc.ask (it would block on a real dialog).
  const answer = (...responses) => { doc.ask = async () => responses.shift() ?? null; };
  const realAsk = doc.ask;

  step('taking the version on disk resolves the conflict');
  answer(1); // Take the version on disk
  assert.equal(await doc.save(), true);
  assert.equal(doc.isDirty, false);
  assert.equal(doc.diskDataChanged, false);

  step('a data change on disk just before saving is caught at write time');
  await js('document.getElementById("add").click()');
  await until('dirty again', () => doc.isDirty);
  const late = buildDocument({ ...parseDocument(external).parts, data: '{"rows":[],"note":"late"}' });
  await fs.writeFile(filePath, late, 'utf8');
  answer(2); // Cancel in the conflict prompt
  assert.equal(await doc.save(), false); // before the watcher's 200 ms debounce
  assert.equal(await fs.readFile(filePath, 'utf8'), late, 'the host did not write over the external content');
  assert.equal(doc.diskDataChanged, true);
  doc.ask = realAsk;

  step('Save in the close prompt keeps the window open if an edit came after the snapshot');
  const takeSnapshot = doc.requestSnapshot;
  doc.requestSnapshot = async function () {
    const snapshot = await takeSnapshot.call(this);
    await js('document.getElementById("add").click()');
    await until('edit after the snapshot', () => doc.latestChange > snapshot.changes);
    return snapshot;
  };
  answer(0, 0); // Save in the close prompt, then Keep mine in the conflict prompt
  await doc.confirmClose(); // what closing a dirty window runs
  doc.requestSnapshot = takeSnapshot;
  doc.ask = realAsk;
  assert.equal(doc.win.isDestroyed(), false, 'the window stays open');
  assert.equal(doc.isDirty, true);
  assert.notEqual(await fs.readFile(filePath, 'utf8'), late, 'Keep mine wrote our data');

  step('Save and reload does not reload if an edit came after the snapshot');
  doc.requestSnapshot = async function () {
    const snapshot = await takeSnapshot.call(this);
    await js('document.getElementById("add").click()');
    await until('edit after the snapshot', () => doc.latestChange > snapshot.changes);
    return snapshot;
  };
  const generation = doc.generation;
  answer(0); // Save and reload
  await doc.reloadInteractive(); // View → Reload on a dirty document
  doc.requestSnapshot = takeSnapshot;
  doc.ask = realAsk;
  assert.equal(doc.generation, generation, 'the page was not reloaded');
  assert.equal(doc.isDirty, true);

  step('a failed write leaves the original intact and shows an error');
  const versionCount = async () => (await fs.readdir(path.join(storeDir, entry))).filter((n) => n.endsWith('.html')).length;
  const beforeFailure = await fs.readFile(filePath, 'utf8');
  const versionsBeforeFailure = await versionCount();
  const errors = [];
  doc.ask = async (options) => { errors.push(options); return 0; };
  await fs.chmod(filePath, 0o444);
  try {
    assert.equal(await doc.save(), false);
  } finally {
    await fs.chmod(filePath, 0o644);
    doc.ask = realAsk;
  }
  assert.equal(await fs.readFile(filePath, 'utf8'), beforeFailure, 'the original is unchanged');
  assert.equal(await versionCount(), versionsBeforeFailure, 'no version was stored');
  assert.deepEqual(errors.map((o) => [o.type, o.message, o.detail]),
    [['error', 'hours.ev.html could not be saved. The file on disk was not changed.', 'The file is read-only.']]);
  assert.equal(doc.isDirty, true);

  step('a moved file is reported once, not written again');
  const shown = [];
  doc.ask = async (options) => { shown.push(options.message); return 0; };
  await fs.rename(filePath, `${filePath}.moved`);
  assert.equal(await doc.save(), false);
  await wait(500); // the watcher sees the rename too
  assert.deepEqual(shown, ['hours.ev.html was moved or deleted.']);
  await assert.rejects(fs.access(filePath), 'the file was not recreated');
  doc.ask = realAsk;

  step('a third document from new sources (to-do list) opens, saves and reopens');
  const todoPath = path.join(dir, 'todo.ev.html');
  await fs.copyFile(path.join(__dirname, '..', 'fixtures', 'todo-list.ev.html'), todoPath);
  const todoOriginal = await fs.readFile(todoPath, 'utf8');
  const openTodo = async () => {
    const todo = await openPath(todoPath, { registry, storeDir });
    assert.ok(todo, 'the to-do list opens');
    await until('to-do list loaded', () => !todo.view.webContents.isLoading());
    return todo;
  };
  const todo = await openTodo();
  await todo.view.webContents.executeJavaScript(`document.getElementById("text").value = "Buy milk";
    document.getElementById("add").click()`);
  await until('to-do list dirty', () => todo.isDirty);
  assert.equal(await todo.save(), true);
  const todoSaved = parseDocument(await fs.readFile(todoPath, 'utf8')).parts;
  assert.deepEqual({ ...todoSaved, data: '' }, { ...parseDocument(todoOriginal).parts, data: '' },
    'everything but the data is unchanged');
  assert.deepEqual(JSON.parse(todoSaved.data).items, [{ text: 'Buy milk', done: false }]);
  todo.win.close();
  await until('to-do list closed', () => todo.win.isDestroyed());
  const reopened = await openTodo();
  assert.notEqual(reopened, todo);
  assert.equal(await reopened.view.webContents.executeJavaScript('document.querySelector("#items li span").textContent'),
    'Buy milk');

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
