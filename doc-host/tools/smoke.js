'use strict';

// End-to-end smoke test of the save loop, run as Electron's main script:
//   npm run smoke
// Opens a copy of the hours sheet, adds a row through the UI, saves,
// checks the file on disk, then simulates an agent editing the behaviour.
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const { app, ipcMain } = require('electron');
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
  const hellos = []; // every page load that announced itself: { sender, loadId }
  ipcMain.on('doc:hello', (event, loadId) => hellos.push({ sender: event.sender.id, loadId }));
  const doc = await openPath(filePath, { registry, storeDir });
  assert.ok(doc, 'the fixture opens');
  const wc = doc.view.webContents;
  await until('page loaded', () => !wc.isLoading());
  const js = (code) => wc.executeJavaScript(code);
  const readDisk = () => fs.readFile(filePath, 'utf8');
  const addRow = async (label) => {
    await js('document.getElementById("add").click()');
    await until(label, () => doc.isDirty);
  };

  step('the document runs hosted, without its own Save button');
  // Kit 1.1.0 hides the document's fallback Save button in the host.
  assert.equal(await js('!!document.getElementById("add") && getComputedStyle(document.getElementById("save")).display === "none"'), true);

  step('documents cannot show native dialogs');
  // A real dialog would block executeJavaScript: give up after 3 seconds.
  const dialogs = await Promise.race([
    js('(() => { const t = Date.now(); alert(1); return [confirm(1), Date.now() - t < 1000]; })()'),
    wait(3000).then(() => 'a dialog blocked the page'),
  ]);
  assert.deepEqual(dialogs, [false, true]);

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

  // Sheets are answered by stubbing doc.ui.sheet (a real one would block).
  // The stub records every sheet it is asked to show.
  const realSheet = doc.ui.sheet;
  let sheets = [];
  const answer = (...responses) => {
    sheets = [];
    doc.ui.sheet = async (options) => {
      sheets.push(options);
      return responses.shift() ?? null;
    };
  };
  const unstub = () => { doc.ui.sheet = realSheet; };
  // An agent edits the style on disk (everything but the data stays).
  const restyle = async (rule) => {
    const parts = parseDocument(await readDisk()).parts;
    await fs.writeFile(filePath, buildDocument({ ...parts, style: `${parts.style}${rule}\n` }), 'utf8');
  };
  const h1Style = (property) => js(`getComputedStyle(document.querySelector("h1")).${property}`);

  step('an agent changes the behaviour on disk: a clean document reloads');
  const updates = []; // the status at every ui.update()
  const realUpdate = doc.ui.update;
  doc.ui.update = () => {
    updates.push({ fromDisk: doc.status.updatedFromDisk, at: Date.now() });
    realUpdate();
  };
  const edited = buildDocument({ ...after, style: after.style + 'h1 { color: rgb(200, 0, 0); }\n' });
  await fs.writeFile(filePath, edited, 'utf8');
  await until('reloaded with the new style', async () =>
    !wc.isLoading() && (await h1Style('color')) === 'rgb(200, 0, 0)');
  assert.equal(await js('document.querySelectorAll("#rows tr").length'), 1, 'the saved row is still there');
  await until('iframes receive no pointer input after the reload', async () => (await js(`(() => {
    const frame = document.body.appendChild(document.createElement('iframe'));
    const value = getComputedStyle(frame).pointerEvents;
    frame.remove();
    return value;
  })()`)) === 'none');

  step('a clean reload shows "Updated from disk" for 4 seconds');
  await until('Updated from disk shows', () => doc.status.updatedFromDisk);
  await until('Updated from disk goes', () => !doc.status.updatedFromDisk, 6000);
  doc.ui.update = realUpdate;
  const shown = updates.findIndex((u) => u.fromDisk);
  const gone = updates.findIndex((u, i) => i > shown && !u.fromDisk);
  assert.ok(shown >= 0 && gone > shown, 'ui.update() ran when it showed and when it went');
  const shownMs = updates[gone].at - updates[shown].at;
  assert.ok(shownMs >= 3950 && shownMs < 4500, `shown for ${shownMs} ms`);

  step('a change signal from before a reload does not mark the new page dirty');
  const loadIds = () => hellos.filter((h) => h.sender === doc.webContentsId).map((h) => h.loadId);
  const dirtySignal = (loadId) =>
    ipcMain.emit('doc:dirty', { sender: { id: doc.webContentsId } }, { loadId, counter: 99 });
  const previous = loadIds().at(-1);
  assert.ok(previous, 'the page announced itself');
  dirtySignal(previous);
  assert.equal(doc.isDirty, true, 'the signal counts while its page is loaded');
  const announced = loadIds().length;
  assert.equal(await doc.reloadFromDisk(), true);
  await until('the new page announced itself', () => loadIds().length > announced);
  dirtySignal(previous);
  assert.equal(doc.isDirty, false);

  step('an external change to a dirty document becomes status, never a sheet');
  answer();
  await addRow('dirty again');
  await restyle('h1 { letter-spacing: 1px; }');
  await until('updated while dirty', () => doc.status.updatedWhileDirty);
  assert.deepEqual(sheets, [], 'no sheet');
  assert.equal(doc.isDirty, true, 'the page was not replaced');
  await doc.onBannerAction('updated-while-dirty', 'dismiss');
  assert.deepEqual(doc.status.dismissed, ['updated-while-dirty']);
  await doc.onBannerAction('updated-while-dirty', 'save-reload');
  assert.equal(doc.isDirty, false);
  assert.equal(doc.status.updatedWhileDirty, false);
  assert.deepEqual(doc.status.dismissed, [], 'a dismissal ends with its condition');
  assert.equal(await h1Style('letterSpacing'), '1px', 'the new style runs');
  assert.equal(await js('document.querySelectorAll("#rows tr").length'), 2, 'with our data');
  assert.deepEqual(sheets, [], 'no sheet');
  unstub();

  step('an edit that lands during an auto-reload becomes a banner');
  answer();
  // The automatic reload settles first; the edit lands right after that.
  const realReload = doc.reloadFromDisk;
  const realSettle = doc.settle;
  const autoReloads = [];
  doc.reloadFromDisk = async function (options) {
    this.settle = async function () {
      await realSettle.call(this);
      await addRow('edit during the reload');
    };
    try {
      const reloaded = await realReload.call(this, options);
      autoReloads.push(reloaded);
      return reloaded;
    } finally {
      delete this.settle;
    }
  };
  const generation = doc.generation;
  await restyle('h1 { font-style: italic; }');
  await until('updated while dirty', () => doc.status.updatedWhileDirty);
  delete doc.reloadFromDisk;
  assert.deepEqual(autoReloads, [false], 'the automatic reload stopped');
  assert.equal(doc.generation, generation, 'the page was not replaced');
  assert.equal(doc.isDirty, true);
  assert.deepEqual(sheets, [], 'no sheet');
  await doc.onBannerAction('updated-while-dirty', 'discard-reload');
  assert.equal(doc.isDirty, false);
  assert.equal(doc.status.updatedWhileDirty, false);
  assert.equal(doc.generation, generation + 1);
  assert.equal(await h1Style('fontStyle'), 'italic');
  unstub();

  step('a data change on disk while dirty is never overwritten silently');
  answer();
  await addRow('dirty again');
  const external = buildDocument({ ...parseDocument(await readDisk()).parts, data: '{"rows":[]}' });
  await fs.writeFile(filePath, external, 'utf8');
  await until('conflict detected', () => doc.status.dataConflict);
  assert.equal(await readDisk(), external, 'the host did not write over the external content');
  assert.deepEqual(sheets, [], 'no sheet');

  step('taking the version on disk resolves the conflict');
  answer(1); // Take the version on disk
  assert.equal(await doc.save(), true);
  assert.equal(doc.isDirty, false);
  assert.equal(doc.status.dataConflict, false);

  step('Keep mine in the banner writes our data without asking');
  answer();
  await addRow('dirty again');
  const theirs = buildDocument({ ...parseDocument(external).parts, data: '{"rows":[],"note":"theirs"}' });
  await fs.writeFile(filePath, theirs, 'utf8');
  await until('conflict detected', () => doc.status.dataConflict);
  await doc.onBannerAction('data-conflict', 'keep-mine');
  assert.deepEqual(sheets, [], 'no sheet');
  assert.equal(doc.status.dataConflict, false);
  assert.equal(doc.isDirty, false);
  assert.deepEqual(JSON.parse(parseDocument(await readDisk()).parts.data).rows.length, 1, 'our data replaced theirs');

  step('a data change on disk just before saving is caught at write time');
  await addRow('dirty again');
  const late = buildDocument({ ...parseDocument(external).parts, data: '{"rows":[],"note":"late"}' });
  await fs.writeFile(filePath, late, 'utf8');
  answer(2); // Cancel in the conflict prompt
  assert.equal(await doc.save(), false); // before the watcher's 200 ms debounce
  assert.equal(await readDisk(), late, 'the host did not write over the external content');
  assert.equal(doc.status.dataConflict, true);
  unstub();

  step('Save in the close prompt keeps the window open if an edit came after the snapshot');
  const takeSnapshot = doc.requestSnapshot;
  doc.requestSnapshot = async function () {
    const snapshot = await takeSnapshot.call(this);
    await js('document.getElementById("add").click()');
    await until('edit after the snapshot', () => doc.latestChange > snapshot.changes);
    return snapshot;
  };
  answer(0, 0); // Save in the close prompt, then Keep mine in the conflict prompt
  assert.equal(await doc.confirmClose(), false, 'closing is cancelled'); // what closing a dirty window runs
  doc.requestSnapshot = takeSnapshot;
  unstub();
  assert.equal(doc.win.isDestroyed(), false, 'the window stays open');
  assert.equal(doc.isDirty, true);
  assert.notEqual(await readDisk(), late, 'Keep mine wrote our data');

  step('Save and reload does not reload if an edit came after the snapshot');
  doc.requestSnapshot = async function () {
    const snapshot = await takeSnapshot.call(this);
    await js('document.getElementById("add").click()');
    await until('edit after the snapshot', () => doc.latestChange > snapshot.changes);
    return snapshot;
  };
  const beforeReload = doc.generation;
  answer(0); // Save and reload
  await doc.reloadInteractive(); // View → Reload on a dirty document
  doc.requestSnapshot = takeSnapshot;
  unstub();
  assert.equal(doc.generation, beforeReload, 'the page was not reloaded');
  assert.equal(doc.isDirty, true);

  step('a failed write leaves the original intact and shows an error');
  const versionCount = async () => (await fs.readdir(path.join(storeDir, entry))).filter((n) => n.endsWith('.html')).length;
  const beforeFailure = await readDisk();
  const versionsBeforeFailure = await versionCount();
  answer(0);
  await fs.chmod(filePath, 0o444);
  try {
    assert.equal(await doc.save(), false);
  } finally {
    await fs.chmod(filePath, 0o644);
    unstub();
  }
  assert.equal(await readDisk(), beforeFailure, 'the original is unchanged');
  assert.equal(await versionCount(), versionsBeforeFailure, 'no version was stored');
  assert.deepEqual(sheets.map((o) => [o.type, o.message, o.detail]),
    [['error', 'hours.ev.html could not be saved. The file on disk was not changed.', 'The file is read-only.']]);
  assert.equal(doc.isDirty, true);

  step('a moved file is reported once, not written again');
  answer(0, 0, 0);
  await fs.rename(filePath, `${filePath}.moved`);
  assert.equal(await doc.save(), false);
  await wait(500); // the watcher sees the rename too
  assert.deepEqual(sheets.map((o) => o.message), ['hours.ev.html was moved or deleted.']);
  assert.equal(doc.status.missing, true);
  await assert.rejects(fs.access(filePath), 'the file was not recreated');
  unstub();

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
