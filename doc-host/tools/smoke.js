'use strict';

// End-to-end smoke test of the workspace and the save loop, run as Electron's
// main script:
//   npm run smoke
// Opens copies of the fixtures in one workspace window, adds rows through the
// UI, saves, checks the files on disk, simulates an agent editing the
// behaviour, then closes, persists and restores the workspace. Everything,
// including workspace.json and the version store, lives in a temporary
// directory.
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const { isDeepStrictEqual } = require('node:util');
const { app, ipcMain, BaseWindow } = require('electron');
const { registerSchemePrivileges } = require('../src/protocol');
const { registerIpc } = require('../src/ipc');
const { Workspace, closeSummaryDetail } = require('../src/workspace');
const { buildMenu } = require('../src/menu');
const { docsInOrder, activeDocId, panesInOrder, paneOf, splitPane } = require('../src/workspace-model');
const { checkDocument } = require('../src/conformance');
const { parseDocument, buildDocument } = require('../src/frame');
const { pathKey } = require('../src/write');
const { findKit } = require('../kit');
const { describeStatus } = require('../src/status');
const { createUpdates } = require('../src/updates');
const { EventEmitter } = require('node:events');

registerSchemePrivileges();
// Keep running if a step closes a window, so its assertion can report it.
app.on('window-all-closed', () => {});

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const fixture = (name) => path.join(__dirname, '..', 'fixtures', `${name}.ev.html`);

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

async function exists(p) {
  return fs.access(p).then(() => true, () => false);
}

async function run(dir) {
  const filePath = path.join(dir, 'hours.ev.html');
  const storeDir = path.join(dir, 'store');
  const workspaceFile = path.join(dir, 'workspace.json');
  await fs.copyFile(fixture('hours-sheet'), filePath);
  const original = await fs.readFile(filePath, 'utf8');

  const workspace = new Workspace({ storeDir, workspaceFile, recordThumbnails: true });
  const menu = buildMenu({ workspace, isDev: false });
  workspace.menu = menu;
  registerIpc({ workspace });
  const hellos = []; // every page load that announced itself: { sender, loadId }
  ipcMain.on('doc:hello', (event, loadId) => hellos.push({ sender: event.sender.id, loadId }));
  assert.deepEqual(await workspace.restore(), { failed: [] }, 'no workspace.json yet: an empty workspace');

  // Sheets are answered by stubbing workspace.sheet (a real one would block).
  // The stub records every sheet it is asked to show; without an answer left
  // it returns null, as when no sheet can be shown.
  let sheets = [];
  const answer = (...responses) => {
    sheets = [];
    workspace.sheet = async (options) => {
      sheets.push(options);
      return responses.length ? responses.shift() : null;
    };
  };
  answer();

  const openDoc = async (p, options) => {
    const opened = await workspace.open(p, options);
    assert.ok(opened, `${path.basename(p)} opens`);
    await until(`${path.basename(p)} loaded`, () => !opened.view.webContents.isLoading());
    return opened;
  };
  const addRowTo = async (d, label) => {
    await d.view.webContents.executeJavaScript('document.getElementById("add").click()');
    await until(label, () => d.isDirty);
  };
  const addTodo = async (d, text) => {
    await d.view.webContents.executeJavaScript(`document.getElementById("text").value = ${JSON.stringify(text)};
      document.getElementById("add").click()`);
    await until(`to-do "${text}" added`, () => d.isDirty);
  };
  const dataOf = async (p) => JSON.parse(parseDocument(await fs.readFile(p, 'utf8')).parts.data);

  const doc = await openDoc(filePath);
  assert.equal(workspace.activeDocument(), doc);
  const wc = doc.view.webContents;
  const js = (code) => wc.executeJavaScript(code);
  const readDisk = () => fs.readFile(filePath, 'utf8');
  const addRow = (label) => addRowTo(doc, label);

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
  assert.match(workspace.win.getTitle(), /^• hours\.ev\.html$/);

  step('saving writes the row into the data block only');
  assert.equal(await doc.save(), true);
  const saved = await fs.readFile(filePath, 'utf8');
  assert.equal(checkDocument(saved).ok, true);
  const before = parseDocument(original).parts;
  const after = parseDocument(saved).parts;
  assert.deepEqual({ ...after, data: '' }, { ...before, data: '' }, 'everything but the data is unchanged');
  assert.equal(JSON.parse(after.data).rows.length, 1);
  assert.equal(doc.isDirty, false);
  assert.equal(workspace.win.getTitle(), 'hours.ev.html');

  step('the previous version is in the version store');
  const [entry] = await fs.readdir(storeDir);
  const versions = (await fs.readdir(path.join(storeDir, entry))).filter((n) => n.endsWith('.html'));
  assert.equal(versions.length, 1);
  assert.equal(await fs.readFile(path.join(storeDir, entry, versions[0]), 'utf8'), original);

  // An agent edits the style on disk (everything but the data stays).
  const restyle = async (rule, p = filePath) => {
    const parts = parseDocument(await fs.readFile(p, 'utf8')).parts;
    await fs.writeFile(p, buildDocument({ ...parts, style: `${parts.style}${rule}\n` }), 'utf8');
  };
  const h1Style = (property) => js(`getComputedStyle(document.querySelector("h1")).${property}`);

  step('an agent changes the behaviour on disk: a clean document reloads');
  const updates = []; // the status at every ui.update()
  const realUpdate = doc.ui.update;
  doc.ui.update = () => {
    updates.push({ fromDisk: !!doc.status.updatedFromDisk, at: Date.now() });
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

  step('Save in the close prompt keeps the document open if an edit came after the snapshot');
  const takeSnapshot = doc.requestSnapshot;
  doc.requestSnapshot = async function () {
    const snapshot = await takeSnapshot.call(this);
    await js('document.getElementById("add").click()');
    await until('edit after the snapshot', () => doc.latestChange > snapshot.changes);
    return snapshot;
  };
  answer(0, 0); // Save in the close prompt, then Keep mine in the conflict prompt
  assert.equal(await workspace.closeDocument(doc.id), false, 'closing is cancelled'); // what Cmd+W runs
  delete doc.requestSnapshot;
  assert.equal(workspace.documentById(doc.id), doc, 'the document stays open');
  assert.equal(doc.disposed, false);
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
  delete doc.requestSnapshot;
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
  // Put the file back: the document saves cleanly again for the steps below.
  await fs.rename(`${filePath}.moved`, filePath);
  answer();
  assert.equal(await doc.save(), true);
  assert.equal(doc.status.missing, false);
  assert.deepEqual(sheets, []);

  step('a third document from new sources (to-do list) opens, saves and reopens');
  const todoPath = path.join(dir, 'todo.ev.html');
  await fs.copyFile(fixture('todo-list'), todoPath);
  const todoOriginal = await fs.readFile(todoPath, 'utf8');
  const todo = await openDoc(todoPath);
  await addTodo(todo, 'Buy milk');
  assert.equal(await todo.save(), true);
  const todoSaved = parseDocument(await fs.readFile(todoPath, 'utf8')).parts;
  assert.deepEqual({ ...todoSaved, data: '' }, { ...parseDocument(todoOriginal).parts, data: '' },
    'everything but the data is unchanged');
  assert.deepEqual(JSON.parse(todoSaved.data).items, [{ text: 'Buy milk', done: false }]);
  assert.equal(await workspace.closeDocument(todo.id), true);
  assert.equal(todo.disposed, true);
  const reopened = await openDoc(todoPath);
  assert.notEqual(reopened, todo);
  assert.equal(await reopened.view.webContents.executeJavaScript('document.querySelector("#items li span").textContent'),
    'Buy milk');

  step('three documents open as tabs in one window');
  const otherPath = path.join(dir, 'other', 'hours.ev.html');
  await fs.mkdir(path.dirname(otherPath));
  await fs.copyFile(fixture('hours-sheet'), otherPath);
  const other = await openDoc(otherPath);
  assert.equal(BaseWindow.getAllWindows().length, 1, 'one window');
  assert.deepEqual(docsInOrder(workspace.model), [doc.id, reopened.id, other.id]);
  assert.equal(activeDocId(workspace.model), other.id, 'the last opened is active');
  assert.equal(workspace.activeDocument(), other);
  // One pane: right of the document list (240), below the tab strip (32);
  // only the selected document's view shows.
  const content = workspace.win.getContentBounds();
  const documentRect = { x: 240, y: 32, width: content.width - 240, height: content.height - 32 };
  for (const d of [doc, reopened, other]) {
    assert.equal(d.view.getVisible(), d === other, `${d.filePath} visible only if selected`);
    assert.deepEqual(d.view.getBounds(), documentRect);
  }

  step('opening an open document selects its tab');
  assert.equal(await workspace.open(filePath), doc);
  assert.equal(workspace.activeDocument(), doc);
  assert.deepEqual(docsInOrder(workspace.model), [doc.id, reopened.id, other.id], 'no new tab');
  assert.equal(doc.view.getVisible(), true);
  assert.equal(other.view.getVisible(), false);
  const otherSpelling = path.join(dir, 'HOURS.EV.HTML');
  if (await exists(otherSpelling)) { // a case-insensitive volume
    workspace.select(other.id);
    assert.equal(await workspace.open(otherSpelling), doc, 'found under another spelling');
    assert.equal(workspace.activeDocument(), doc);
  }
  assert.equal(workspace.registry.documents.size, 3);
  assert.deepEqual(sheets, []);

  step('Save acts on the active document only');
  answer();
  await addRowTo(doc, 'hours dirty');
  await addRowTo(other, 'other dirty');
  const hoursBeforeSave = await readDisk();
  const otherBeforeSave = await fs.readFile(otherPath, 'utf8');
  menu.getMenuItemById('save').click(); // File → Save, as Cmd+S runs it
  await until('the active document is saved', () => !doc.isDirty);
  assert.notEqual(await readDisk(), hoursBeforeSave, 'the active document was written');
  await wait(300); // time for a wrong save to land
  assert.equal(await fs.readFile(otherPath, 'utf8'), otherBeforeSave, 'the other document was not written');
  assert.equal(other.isDirty, true);
  assert.deepEqual(sheets, []);

  step('the title shows the active document and its unsaved marker');
  const folder = path.basename(dir);
  assert.equal(workspace.win.getTitle(), `hours.ev.html · ${folder}`);
  workspace.select(other.id);
  assert.equal(workspace.win.getTitle(), '• hours.ev.html · other');
  workspace.select(reopened.id);
  assert.equal(workspace.win.getTitle(), 'todo.ev.html');
  if (process.platform === 'darwin') {
    assert.equal(workspace.win.isDocumentEdited(), true, 'the close button shows that a document is dirty');
    assert.equal(workspace.win.getRepresentedFilename(), todoPath);
  }

  step('Cmd+W closes the active document after its prompt');
  workspace.select(other.id);
  answer(0); // Save
  menu.getMenuItemById('close').click(); // File → Close, as Cmd+W runs it
  await until('the document closed', () => other.disposed);
  assert.deepEqual(sheets.map((o) => [o.message, o.buttons]),
    [['Do you want to save the changes you made to hours.ev.html?', ['Save', "Don't save", 'Cancel']]]);
  assert.equal((await dataOf(otherPath)).rows.length, 1, 'written');
  assert.deepEqual(docsInOrder(workspace.model), [doc.id, reopened.id]);
  assert.equal(workspace.documentById(other.id), null);
  assert.equal(workspace.win.contentView.children.includes(other.view), false, 'its view left the window');
  assert.equal(workspace.activeDocument(), reopened, 'the tab to its left takes its place');
  assert.equal(reopened.view.getVisible(), true);
  if (process.platform === 'darwin') assert.equal(workspace.win.isDocumentEdited(), false);
  workspace.select(doc.id);
  assert.equal(workspace.win.getTitle(), 'hours.ev.html', 'one hours.ev.html left: no folder in its label');
  workspace.select(reopened.id);

  step('closing waits for a running save');
  // A slow save; an edit after its snapshot leaves the document dirty.
  await addTodo(reopened, 'Call Bob');
  reopened.requestSnapshot = async function () {
    const snapshot = await takeSnapshot.call(this);
    await addTodo(this, 'Edit after the snapshot');
    await until('edit after the snapshot', () => this.latestChange > snapshot.changes);
    await wait(500);
    return snapshot;
  };
  let written = false;
  const prompts = [];
  workspace.sheet = async (options) => {
    prompts.push({ message: options.message, afterWrite: written });
    return 2; // Cancel
  };
  const slowSave = reopened.save().then((ok) => {
    written = true;
    return ok;
  });
  assert.equal(await workspace.closeDocument(reopened.id), false, 'still dirty after the save: its prompt, cancelled');
  assert.equal(await slowSave, true);
  assert.deepEqual(prompts, [{ message: 'Do you want to save the changes you made to todo.ev.html?', afterWrite: true }]);
  assert.equal(workspace.documentById(reopened.id), reopened, 'the document stays');
  assert.deepEqual((await dataOf(todoPath)).items.map((i) => i.text), ['Buy milk', 'Call Bob']);
  // A slow save that leaves the document clean: closing waits, then closes without a prompt.
  reopened.requestSnapshot = async function () {
    const snapshot = await takeSnapshot.call(this);
    await wait(500);
    return snapshot;
  };
  answer();
  written = false;
  const cleanSave = reopened.save().then((ok) => {
    written = true;
    return ok;
  });
  assert.equal(await workspace.closeDocument(reopened.id), true);
  assert.equal(written, true, 'closing resolved after the write');
  assert.equal(await cleanSave, true);
  assert.deepEqual(sheets, [], 'no prompt for a clean document');
  assert.equal(reopened.disposed, true);
  assert.deepEqual((await dataOf(todoPath)).items.map((i) => i.text), ['Buy milk', 'Call Bob', 'Edit after the snapshot']);
  assert.deepEqual(docsInOrder(workspace.model), [doc.id]);

  step('Save all saves every document; a read-only one stops closing');
  const todo3 = await openDoc(todoPath);
  const other3 = await openDoc(otherPath);
  assert.deepEqual(docsInOrder(workspace.model), [doc.id, todo3.id, other3.id]);
  await addRowTo(doc, 'hours dirty');
  await addTodo(todo3, 'Save all');
  await addRowTo(other3, 'other dirty');
  workspace.select(doc.id);
  answer(0, 0); // Save all; OK in the "could not be saved" sheet
  await fs.chmod(otherPath, 0o444);
  try {
    assert.equal(await workspace.confirmCloseAll(), false);
  } finally {
    await fs.chmod(otherPath, 0o644);
  }
  const [summary] = sheets;
  assert.deepEqual(sheets.map((o) => o.message), [
    'Do you want to save the changes to 3 documents?',
    'hours.ev.html could not be saved. The file on disk was not changed.',
  ]);
  assert.equal(summary.detail,
    `hours.ev.html · ${folder}\ntodo.ev.html\nhours.ev.html · other\n\nYour changes will be lost if you don't save them.`);
  assert.deepEqual([summary.buttons, summary.defaultId, summary.cancelId], [['Save all', 'Review each…', 'Cancel'], 0, 2]);
  assert.equal(workspace.activeDocument(), other3, 'the read-only document is active');
  assert.deepEqual([doc.isDirty, todo3.isDirty, other3.isDirty], [false, false, true], 'the others were saved');
  assert.equal((await dataOf(todoPath)).items.at(-1).text, 'Save all');
  assert.equal(workspace.registry.documents.size, 3, 'nothing closed');
  // More than ten dirty documents: ten names, then the rest as a count.
  const twelve = Array.from({ length: 12 }, (_, i) => `d${i + 1}.ev.html`);
  assert.equal(closeSummaryDetail(twelve),
    [...twelve.slice(0, 10), 'and 2 more', '', "Your changes will be lost if you don't save them."].join('\n'));

  step('an edit during Save all gets its own summary before the window closes');
  // doc and todo3 are dirty, other3 is clean; while the first save is in
  // flight, other3 becomes dirty. confirmCloseAll is what quit() waits for
  // before it persists and exits (runQuit), so it must not return true yet.
  await other3.save();
  await addRowTo(doc, 'hours dirty');
  await addTodo(todo3, 'Save all, third edit');
  assert.deepEqual([doc.isDirty, todo3.isDirty, other3.isDirty], [true, true, false]);
  const firstDirty = workspace.openDocuments().find((d) => d.isDirty);
  const snapshotOf = firstDirty.requestSnapshot;
  let editedThird = null;
  firstDirty.requestSnapshot = async function () {
    const snapshot = await snapshotOf.call(this);
    editedThird = addRowTo(other3, 'third document dirty');
    await editedThird;
    return snapshot;
  };
  answer(0, 2); // Save all; then Cancel the prompt of the third document
  const closed = await workspace.confirmCloseAll();
  delete firstDirty.requestSnapshot;
  await editedThird;
  assert.equal(closed, false, 'cancelled: the window does not close');
  assert.equal(sheets.length, 2, 'the summary ran again for the newly dirty document');
  assert.equal(sheets[0].message, 'Do you want to save the changes to 2 documents?');
  assert.equal(sheets[1].message, 'Do you want to save the changes you made to hours.ev.html?');
  assert.deepEqual([doc.isDirty, todo3.isDirty, other3.isDirty], [false, false, true], 'the first two saved, the third kept');
  assert.equal(workspace.registry.documents.size, 3, 'nothing closed');
  await addRowTo(doc, 'hours dirty');
  await addTodo(todo3, 'Review each');

  step('Review each: Cancel keeps everything open');
  await addRowTo(doc, 'hours dirty');
  await addTodo(todo3, 'Review each');
  answer(1, 1, 2); // Review each; Don't save (hours); Cancel (to-do list)
  assert.equal(await workspace.confirmCloseAll(), false);
  assert.deepEqual(sheets.map((o) => o.message), [
    'Do you want to save the changes to 3 documents?',
    'Do you want to save the changes you made to hours.ev.html?',
    'Do you want to save the changes you made to todo.ev.html?',
  ]);
  assert.equal(workspace.activeDocument(), todo3, 'the document under review is active');
  for (const d of [doc, todo3, other3]) {
    assert.equal(workspace.documentById(d.id), d);
    assert.equal(d.isDirty, true, "Don't save takes effect only when the window closes");
  }

  step('an edit during the only prompt\'s Save is asked about before the window closes');
  // Only doc is dirty; while its save is in flight, todo3 becomes dirty.
  const cleanAll = async () => {
    for (const d of [doc, todo3, other3]) assert.equal(await d.save(), true);
    assert.deepEqual([doc.isDirty, todo3.isDirty, other3.isDirty], [false, false, false]);
  };
  // Dirties `target` while `source`'s next save is in flight.
  const editDuringSave = (source, target, edit) => {
    const take = source.requestSnapshot;
    const state = { done: null };
    source.requestSnapshot = async function () {
      const snapshot = await take.call(this);
      delete source.requestSnapshot;
      state.done = edit(target);
      await state.done;
      return snapshot;
    };
    return state;
  };
  await cleanAll();
  await addRowTo(doc, 'single dirty');
  const single = editDuringSave(doc, todo3, (d) => addTodo(d, 'during the single save'));
  answer(0, 2); // Save (hours); then Cancel the prompt of the to-do list
  assert.equal(await workspace.confirmCloseAll(), false, 'cancelled: the window does not close');
  await single.done;
  assert.deepEqual(sheets.map((o) => o.message), [
    'Do you want to save the changes you made to hours.ev.html?',
    'Do you want to save the changes you made to todo.ev.html?',
  ]);
  assert.deepEqual([doc.isDirty, todo3.isDirty], [false, true], 'hours saved, the to-do list kept');
  assert.equal(workspace.activeDocument(), todo3, 'the newly dirty document is under review');

  step('an edit during a Save in Review each is asked about before the window closes');
  await cleanAll();
  await addRowTo(doc, 'review dirty');
  await addTodo(todo3, 'review dirty');
  const review = editDuringSave(doc, other3, (d) => addRowTo(d, 'third document dirty'));
  answer(1, 0, 1, 2); // Review each; Save (hours); Don't save (to-do list); Cancel (third)
  assert.equal(await workspace.confirmCloseAll(), false, 'cancelled: the window does not close');
  await review.done;
  assert.equal(sheets.length, 4, 'the third document was asked about');
  assert.equal(sheets[0].message, 'Do you want to save the changes to 2 documents?');
  assert.equal(workspace.activeDocument(), other3, 'the third document is under review');
  assert.deepEqual([doc.isDirty, todo3.isDirty, other3.isDirty], [false, true, true]);

  step("a document answered Don't save is not asked again");
  await cleanAll();
  await addRowTo(doc, 'declined');
  await addTodo(todo3, 'declined');
  answer(1, 1, 1); // Review each; Don't save; Don't save
  assert.equal(await workspace.confirmCloseAll(), true, 'nothing else is dirty: the window may close');
  assert.equal(sheets.length, 3, 'each document was asked once');
  await cleanAll();
  await addTodo(todo3, 'declined alone');
  answer(1); // Don't save
  assert.equal(await workspace.confirmCloseAll(), true);
  assert.equal(sheets.length, 1, 'the one dirty document was asked once');
  assert.equal(todo3.isDirty, true, "Don't save discards nothing until the window closes");
  await addRowTo(doc, 'hours dirty');
  await addRowTo(other3, 'other dirty');
  workspace.select(todo3.id);
  answer();

  step('an external change to a hidden document shows no sheet');
  answer();
  assert.equal(doc.view.getVisible(), false, 'hours.ev.html is hidden');
  await restyle('h1 { text-decoration: underline; }');
  await until('updated while dirty', () => doc.status.updatedWhileDirty);
  assert.deepEqual(sheets, [], 'no sheet');
  assert.equal(workspace.activeDocument(), todo3, 'the active document stays');
  // Selected, its banner pushes it down; dismissed, it moves back up.
  workspace.select(doc.id);
  assert.equal(doc.view.getBounds().y, 32 + 36);
  await doc.onBannerAction('updated-while-dirty', 'dismiss');
  assert.equal(doc.view.getBounds().y, 32);

  step('the workspace is written and restored');
  // Two panes: the to-do list gets a pane of its own on the right.
  workspace.apply(splitPane(workspace.model, todo3.id, paneOf(workspace.model, todo3.id), 'right'));
  workspace.select(other3.id);
  await workspace.persist();
  const layoutOf = (ws) => panesInOrder(ws.model).map((pane) => ({
    tabs: pane.tabs.map((id) => ws.documentById(id).filePath),
    selected: ws.documentById(pane.selected).filePath,
  }));
  assert.deepEqual(layoutOf(workspace), [
    { tabs: [filePath, otherPath], selected: otherPath },
    { tabs: [todoPath], selected: todoPath },
  ]);
  const second = new Workspace({ storeDir, workspaceFile, recordThumbnails: true });
  try {
    assert.deepEqual(await second.restore(), { failed: [] });
    assert.deepEqual(layoutOf(second), layoutOf(workspace), 'same panes and tabs');
    assert.equal(second.model.root.direction, 'row');
    assert.deepEqual(second.model.root.sizes, workspace.model.root.sizes);
    assert.equal(second.activeDocument().filePath, otherPath, 'same active document');
    assert.deepEqual(second.model.list, workspace.model.list);
    assert.deepEqual(second.win.getBounds(), workspace.win.getNormalBounds(), 'same window bounds');
    assert.equal(second.win.isVisible(), true);
    assert.deepEqual(second.notices, []);
  } finally {
    second.dispose();
  }

  step('restore with missing and broken files names each once');
  const restoreDir = path.join(dir, 'restore');
  await fs.mkdir(restoreDir);
  const deleted = path.join(restoreDir, 'deleted.ev.html');
  await fs.copyFile(fixture('todo-list'), deleted);
  await fs.rm(deleted);
  const broken = path.join(restoreDir, 'broken.ev.html');
  const todoParts = parseDocument(await fs.readFile(fixture('todo-list'), 'utf8')).parts;
  await fs.writeFile(broken, buildDocument({ ...todoParts, docType: 'Not A Type' }));
  const plain = path.join(restoreDir, 'page.html');
  await fs.writeFile(plain, '<!doctype html><title>Plain</title><p>Plain page</p>\n');
  const good = path.join(restoreDir, 'list.ev.html');
  await fs.copyFile(fixture('todo-list'), good);
  const alias = path.join(restoreDir, 'alias.ev.html'); // the same file under another name
  await fs.symlink(good, alias);
  const listedFile = path.join(restoreDir, 'workspace.json');
  await fs.writeFile(listedFile, JSON.stringify({
    version: 1,
    window: { x: 80, y: 80, width: 900, height: 700 },
    list: { visible: false, mode: 'list', width: 240 }, // shown anyway: it holds the notice
    layout: {
      kind: 'split',
      direction: 'row',
      sizes: [0.5, 0.5],
      children: [
        { kind: 'pane', tabs: [deleted, broken, good], selected: good },
        { kind: 'pane', tabs: [plain, alias, good], selected: alias },
      ],
    },
    active: alias,
  }));
  const third = new Workspace({ storeDir, workspaceFile: listedFile });
  try {
    const { failed } = await third.restore();
    assert.deepEqual(failed, [
      { path: deleted, reason: 'moved or deleted' },
      { path: broken, reason: 'no longer follows the document specification' },
      { path: plain, reason: 'not an EverythingApp document' },
    ]);
    assert.deepEqual(third.notices, [{ kind: 'restore', failed }]);
    assert.equal(third.registry.documents.size, 1, 'the file listed twice opens once');
    assert.deepEqual(layoutOf(third), [{ tabs: [good], selected: good }]);
    assert.equal(third.activeDocument().filePath, good);
    assert.equal(third.win.isVisible(), true, 'the window shows');
    assert.deepEqual(third.win.getBounds(), { x: 80, y: 80, width: 900, height: 700 });
    // The host UI names each one at the top of the list, which shows while it does.
    assert.equal(third.model.list.visible, true);
    await third.hostUi.ready;
    const noticeItems = () => third.hostUi.view.webContents.executeJavaScript(
      '[...document.querySelectorAll("#notices li")].map((li) => li.textContent)');
    await until('the host UI shows the notice', async () => (await noticeItems()).length === 3);
    assert.deepEqual(await noticeItems(), [
      'deleted.ev.html — moved or deleted',
      'broken.ev.html — no longer follows the document specification',
      'page.html — not an EverythingApp document',
    ]);
  } finally {
    third.dispose();
  }

  // ---------- The host UI ----------
  const { hostUi } = workspace;
  const ui = (code) => hostUi.view.webContents.executeJavaScript(code);
  const tabSelector = (d) => `.strip .tab[data-doc-id="${d.id}"]`;
  const clickInUi = (selector) => ui(`document.querySelector(${JSON.stringify(selector)}).click()`);

  step('the host UI lists every document and draws a tab per document');
  await hostUi.ready;
  assert.equal(workspace.win.contentView.children[0], hostUi.view, 'the host UI lies beneath the documents');
  const contentSize = workspace.win.getContentBounds();
  assert.deepEqual(hostUi.view.getBounds(), { x: 0, y: 0, width: contentSize.width, height: contentSize.height });
  // p1: hours, other hours | p2: to-do list; all three dirty
  const strips = () => ui(`[...document.querySelectorAll('.strip')].map((s) =>
    [s.dataset.paneId, [...s.querySelectorAll('.tab')].map((t) => t.dataset.docId)])`);
  const expectedStrips = panesInOrder(workspace.model).map((pane) => [pane.id, pane.tabs]);
  assert.deepEqual(expectedStrips.map(([, tabs]) => tabs), [[doc.id, other3.id], [todo3.id]]);
  await until('the host UI draws the tabs', async () => isDeepStrictEqual(await strips(), expectedStrips));
  const entries = await ui(`[...document.querySelectorAll('#entries .entry')].map((e) =>
    [e.dataset.docId, e.querySelector('.label').textContent, !!e.querySelector('.dirty')])`);
  assert.deepEqual(entries, [
    [doc.id, `hours.ev.html · ${folder}`, true],
    [other3.id, 'hours.ev.html · other', true],
    [todo3.id, 'todo.ev.html', true],
  ]);
  assert.equal(await ui('document.querySelectorAll("#entries .separator").length'), 1, 'one separator between two panes');
  assert.deepEqual([doc, other3, todo3].map((d) => workspace.docTypeOf(d)), ['hours-sheet', 'hours-sheet', 'todo-list']);
  assert.equal(await ui('document.querySelectorAll(".divider").length'), 1);

  step('clicking a tab selects the document');
  assert.equal(activeDocId(workspace.model), other3.id);
  await clickInUi(tabSelector(doc));
  await until('the clicked tab is selected', () => activeDocId(workspace.model) === doc.id);
  assert.equal(doc.view.getVisible(), true);
  assert.equal(other3.view.getVisible(), false);
  await until('the host UI marks it selected',
    async () => (await ui(`document.querySelector('${tabSelector(doc)}').classList.contains('selected')`)) === true);

  step('a banner appears for a hidden document and its action works');
  answer();
  assert.equal(other3.view.getVisible(), false, 'the other hours sheet is hidden');
  assert.equal(other3.isDirty, true);
  await restyle('h1 { word-spacing: 2px; }', otherPath);
  await until('updated while dirty', () => other3.status.updatedWhileDirty);
  const badgeOf = (d) => ui(`document.querySelector('${tabSelector(d)} .badge')?.title ?? null`);
  await until('its tab shows the badge', async () => (await badgeOf(other3)) === 'Updated on disk');
  assert.equal(activeDocId(workspace.model), doc.id, 'the active document stays');
  await clickInUi(tabSelector(other3));
  await until('selected', () => activeDocId(workspace.model) === other3.id);
  const bannerRow = `.banners[data-pane-id="${paneOf(workspace.model, other3.id)}"]`;
  await until('the banner shows', async () => (await ui(`document.querySelector('${bannerRow} .banner[data-kind="updated-while-dirty"] .message')?.textContent`))
    === 'This document was updated on disk. Your data is unsaved.');
  assert.equal(other3.view.getBounds().y, 32 + 36, 'the banner pushes the document down');
  const generation3 = other3.generation;
  await ui(`[...document.querySelectorAll('${bannerRow} button')].find((b) => b.textContent === 'Reload and discard my changes').click()`);
  await until('reloaded without the unsaved changes',
    () => other3.generation === generation3 + 1 && !other3.isDirty && !other3.status.updatedWhileDirty);
  await until('the banner goes', async () => (await ui(`document.querySelectorAll('${bannerRow} .banner').length`)) === 0);
  assert.equal(other3.view.getBounds().y, 32);
  assert.equal(await badgeOf(other3), null);
  assert.deepEqual(sheets, [], 'no sheet');

  step('a document cannot send host-UI intents');
  const intentFrom = (senderId, payload) => ipcMain.emit('ui:intent', { sender: { id: senderId } }, payload);
  intentFrom(todo3.webContentsId, { type: 'close', docId: todo3.id });
  intentFrom(todo3.webContentsId, { type: 'select', docId: doc.id });
  intentFrom(todo3.webContentsId, { type: 'notice', kind: 'restore', action: 'dismiss' });
  await wait(300);
  assert.equal(workspace.documentById(todo3.id), todo3, 'still open');
  assert.deepEqual(sheets, [], 'not even its close prompt');
  assert.equal(activeDocId(workspace.model), other3.id, 'nothing was selected');
  // Nor can the host UI act as a document.
  const changesBefore = [doc, other3, todo3].map((d) => d.latestChange);
  ipcMain.emit('doc:dirty', { sender: { id: hostUi.webContentsId } }, { loadId: 'x', counter: 1e6 });
  assert.deepEqual([doc, other3, todo3].map((d) => d.latestChange), changesBefore);
  // The same intent from the host UI is carried out.
  intentFrom(hostUi.webContentsId, { type: 'select', docId: doc.id });
  assert.equal(activeDocId(workspace.model), doc.id);

  // ---------- Splitting and dragging ----------
  const children = () => workspace.win.contentView.children;
  const paneIds = () => panesInOrder(workspace.model).map((pane) => pane.id);
  const sendIntent = (payload) => intentFrom(hostUi.webContentsId, payload);
  const splitItem = (id) => menu.getMenuItemById(id);
  const bounds = (d) => d.view.getBounds();

  step('Split Right moves the active document into a new pane');
  workspace.select(doc.id);
  assert.deepEqual(panesInOrder(workspace.model).map((pane) => pane.tabs), [[doc.id, other3.id], [todo3.id]]);
  assert.equal(splitItem('split-right').enabled, true, 'the pane holds two tabs');
  assert.equal(splitItem('split-down').enabled, true);
  workspace.splitActive('right');
  assert.deepEqual(panesInOrder(workspace.model).map((pane) => pane.tabs), [[other3.id], [doc.id], [todo3.id]]);
  assert.equal(activeDocId(workspace.model), doc.id);
  assert.equal(bounds(doc).y, bounds(todo3).y, 'side by side');
  assert.ok(bounds(doc).x > bounds(other3).x + bounds(other3).width - 1, 'to the right of the other pane');
  assert.ok(bounds(todo3).x > bounds(doc).x + bounds(doc).width - 1, 'and to the left of the third');
  await until('the host UI draws three tab strips', async () => (await strips()).length === 3);

  step("Split Right is disabled for a pane's only tab");
  assert.equal(splitItem('split-right').enabled, false);
  assert.equal(splitItem('split-down').enabled, false);
  const unchanged = workspace.model;
  workspace.splitActive('right');
  assert.equal(workspace.model, unchanged, 'nothing happens');

  step('a split intent from the host UI splits; a move-tab intent moves back and the pane disappears');
  sendIntent({ type: 'split', docId: other3.id, paneId: paneOf(workspace.model, todo3.id), edge: 'bottom' });
  await until('split', () => panesInOrder(workspace.model).some((pane) => pane.tabs.includes(other3.id) && paneOf(workspace.model, todo3.id) !== pane.id));
  assert.equal(paneIds().length, 3, 'its old pane disappeared, the new one appeared');
  assert.equal(bounds(other3).x, bounds(todo3).x, 'below the to-do list');
  assert.ok(bounds(other3).y > bounds(todo3).y);
  sendIntent({ type: 'split', docId: doc.id, paneId: paneOf(workspace.model, doc.id), edge: 'left' });
  await wait(100);
  assert.equal(paneIds().length, 3, 'a split of a pane\'s only tab is ignored');
  sendIntent({ type: 'move-tab', docId: other3.id, paneId: paneOf(workspace.model, doc.id), index: 0 });
  await until('moved back', () => paneIds().length === 2);
  assert.deepEqual(panesInOrder(workspace.model).map((pane) => pane.tabs), [[other3.id, doc.id], [todo3.id]]);
  assert.equal(activeDocId(workspace.model), other3.id);
  assert.equal(splitItem('split-right').enabled, true);

  step('Cmd+\\ on a document or the host UI splits right once');
  const key = (contents, patch) => {
    let prevented = 0;
    contents.emit('before-input-event', { preventDefault: () => { prevented += 1; } },
      { type: 'keyDown', code: 'Backslash', alt: false, shift: false, meta: process.platform === 'darwin', control: process.platform !== 'darwin', ...patch });
    return prevented;
  };
  assert.equal(key(doc.view.webContents, { shift: true }), 0, 'with Shift it is not ours');
  assert.equal(key(doc.view.webContents, { type: 'keyUp' }), 0);
  assert.equal(paneIds().length, 2);
  assert.equal(key(other3.view.webContents), 1);
  assert.equal(paneIds().length, 3);
  sendIntent({ type: 'move-tab', docId: other3.id, paneId: paneOf(workspace.model, doc.id), index: 0 });
  await until('moved back', () => paneIds().length === 2);
  assert.equal(key(hostUi.view.webContents), 1);
  assert.equal(paneIds().length, 3);
  sendIntent({ type: 'move-tab', docId: other3.id, paneId: paneOf(workspace.model, doc.id), index: 0 });
  await until('moved back', () => paneIds().length === 2);

  step('a drag raises the host UI and ending it lowers it');
  assert.equal(children()[0], hostUi.view);
  sendIntent({ type: 'drag', active: true });
  await until('raised', () => children().at(-1) === hostUi.view);
  await until('the page drops its backgrounds', async () => (await ui('document.documentElement.classList.contains("dragging")')) === true);
  sendIntent({ type: 'drag', active: false });
  await until('lowered', () => children()[0] === hostUi.view);
  await until('the page draws its backgrounds again', async () => (await ui('document.documentElement.classList.contains("dragging")')) === false);
  sendIntent({ type: 'drag', active: true });
  await until('raised again', () => children().at(-1) === hostUi.view);
  sendIntent({ type: 'select', docId: doc.id }); // any other intent lowers it
  await until('lowered by another intent', () => children()[0] === hostUi.view);
  sendIntent({ type: 'drag', active: true });
  await until('raised for a divider', () => children().at(-1) === hostUi.view);
  const splitId = workspace.model.root.id;
  assert.equal(workspace.model.root.kind, 'split');
  sendIntent({ type: 'resize-split', splitId, sizes: [0.4, 0.6] });
  await until('resized', () => workspace.model.root.sizes[0] === 0.4);
  assert.equal(children().at(-1), hostUi.view, 'resizing keeps the host UI raised');
  sendIntent({ type: 'drag', active: false });
  await until('lowered', () => children()[0] === hostUi.view);

  step('a drag ends when the window loses focus');
  sendIntent({ type: 'drag', active: true });
  await until('raised', () => children().at(-1) === hostUi.view);
  workspace.win.emit('blur');
  assert.equal(children()[0], hostUi.view);
  assert.equal(hostUi.raised, false);

  step('a reload of the host UI while raised lowers it');
  sendIntent({ type: 'drag', active: true });
  await until('raised', () => children().at(-1) === hostUi.view);
  hostUi.view.webContents.reload();
  await until('lowered by the reload', () => children()[0] === hostUi.view && hostUi.raised === false);
  await until('the page is back with the newest state', async () => (await ui('document.querySelectorAll(".strip .tab").length')) > 0);

  // ---------- Thumbnails ----------
  // Whether an image has content depends on a display surface; the smoke test
  // counts what was asked for, through workspace.thumbnailCaptures.
  const captured = (from) => workspace.thumbnailCaptures.slice(from);
  const captureCount = () => workspace.thumbnailCaptures.length;
  // A pane with two tabs: one visible, one hidden.
  const paneWithTwo = panesInOrder(workspace.model).find((pane) => pane.tabs.length >= 2);
  assert.ok(paneWithTwo, 'a pane with two tabs');
  const shownId = paneWithTwo.selected;
  const hiddenId = paneWithTwo.tabs.find((id) => id !== shownId);
  const shownDoc = workspace.documentById(shownId);
  workspace.select(shownId);
  await wait(300); // let the captures of earlier steps settle

  step('switching tabs captures the document that was left');
  let mark = captureCount();
  workspace.select(hiddenId);
  assert.deepEqual(captured(mark), [[shownId, 'hidden']]);

  step('saving captures the document');
  workspace.select(shownId);
  mark = captureCount();
  assert.equal(await shownDoc.save(), true);
  assert.ok(captured(mark).some(([id, reason]) => id === shownId && reason === 'saved'), 'a save capture');

  step('an edit captures the visible document 2 seconds after the last change');
  await wait(100);
  mark = captureCount();
  const editedAt = Date.now();
  await shownDoc.view.webContents.executeJavaScript('document.getElementById("add").click()');
  await until('the edit is seen', () => shownDoc.isDirty);
  await wait(1200);
  assert.deepEqual(captured(mark).filter(([id]) => id === shownId), [], 'not yet');
  await until('the change capture', () => captured(mark).some(([id, reason]) => id === shownId && reason === 'changed'), 3000);
  assert.ok(Date.now() - editedAt >= 1900, 'after about 2 seconds of quiet');

  step('a hidden document is not captured for its changes');
  workspace.select(hiddenId);
  await wait(100);
  mark = captureCount();
  await workspace.documentById(shownId).view.webContents.executeJavaScript('document.getElementById("add").click()');
  await wait(2500);
  assert.deepEqual(captured(mark), []);

  step('the host UI gets every known thumbnail again after it reloads');
  const fakeUrl = 'data:image/jpeg;base64,/9j/AAAA';
  workspace.thumbnails.set(hiddenId, fakeUrl);
  workspace.setList({ mode: 'thumbnails' });
  hostUi.view.webContents.reload();
  const imgSrc = () => ui(`document.querySelector('#entries .entry[data-doc-id="${hiddenId}"] .thumb img')?.getAttribute('src') ?? null`);
  await until('the thumbnail is drawn again', async () => (await imgSrc()) === fakeUrl);
  assert.equal(await ui(`document.querySelectorAll('#entries .thumb img, #entries .thumb.placeholder').length`),
    workspace.openDocuments().length, 'a picture or a placeholder for each document');
  workspace.setList({ mode: 'list' });
  await until('list mode draws no pictures', async () => (await ui(`document.querySelectorAll('#entries img').length`)) === 0);

  step('the View menu marks the current list mode');
  const getMenuItemById = (id) => menu.getMenuItemById(id);
  const initialMode = workspace.model.list.mode;
  workspace.setList({ mode: 'list' });
  assert.equal(getMenuItemById('list-mode-list').checked, true, 'list mode is marked');
  assert.equal(getMenuItemById('list-mode-thumbnails').checked, false, 'thumbnails mode is not marked');
  workspace.setList({ mode: 'thumbnails' });
  assert.equal(getMenuItemById('list-mode-list').checked, false, 'list mode is not marked');
  assert.equal(getMenuItemById('list-mode-thumbnails').checked, true, 'thumbnails mode is marked');
  workspace.setList({ mode: initialMode });

  step('a first load is captured once, after a paint delay (hidden then shown, or visible at load)');
  const lateDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ev-late-'));
  const latePath = path.join(lateDir, 'late.ev.html');
  await fs.copyFile(fixture('todo-list'), latePath);
  mark = captureCount();
  const openedAt = Date.now();
  const lateDoc = await workspace.open(latePath); // loads hidden or visible; opening shows it
  assert.ok(lateDoc, 'late.ev.html opens');
  assert.equal(workspace.unshownLoads.has(lateDoc.id), false, 'the hidden load is taken up');
  assert.deepEqual(captured(mark).filter(([id]) => id === lateDoc.id), [], 'no load capture yet');
  await until('the load capture', () => captured(mark).some(([id, reason]) => id === lateDoc.id && reason === 'load'), 2000);
  assert.ok(Date.now() - openedAt >= 150, 'after the paint delay');
  await wait(400);
  assert.deepEqual(captured(mark).filter(([id]) => id === lateDoc.id), [[lateDoc.id, 'load']], 'exactly one');

  step('a reload of a hidden document is captured at once');
  workspace.select(shownId);
  await wait(50);
  assert.equal(workspace.shown.has(lateDoc.id), false, 'late.ev.html is hidden');
  mark = captureCount();
  workspace.rendered(lateDoc, 'reload');
  assert.deepEqual(captured(mark), [[lateDoc.id, 'reloaded']]);
  await fs.rm(lateDir, { recursive: true, force: true });

  step('the empty state appears when the last document closes');
  answer(1, 1); // Don't save (hours, to-do list); the other hours sheet is clean
  for (const d of workspace.openDocuments()) {
    await clickInUi(`${tabSelector(d)} .close`);
    await until(`${path.basename(d.filePath)} closed`, () => d.disposed);
  }
  assert.deepEqual(sheets.map((o) => o.message), [
    'Do you want to save the changes you made to hours.ev.html?',
    'Do you want to save the changes you made to todo.ev.html?',
  ]);
  assert.equal(workspace.registry.documents.size, 0);
  await until('the empty state shows', async () => (await ui('document.getElementById("empty").hidden')) === false);
  assert.equal(await ui('document.querySelectorAll(".strip .tab, #entries .entry").length'), 0);
  assert.equal(await ui('document.querySelector("#empty button").textContent'), 'Open…');
  assert.match(await ui('document.getElementById("empty").textContent'), /Drop a document here/);
  const emptyRect = await ui(`(() => {
    const r = document.getElementById('empty').getBoundingClientRect();
    return { x: r.x, y: r.y, width: r.width, height: r.height };
  })()`);
  assert.deepEqual(emptyRect, workspace.layout.panes[0].document, "in the single pane's document area");
  assert.equal(workspace.win.getTitle(), 'EverythingApp');

  step('an outdated kit shows its badge and banner');
  const kitDir = path.join(dir, 'kit');
  await fs.mkdir(kitDir);
  const notePath = path.join(kitDir, 'note.ev.html');
  await fs.copyFile(fixture('outdated-kit'), notePath);
  const noteOriginal = await fs.readFile(notePath, 'utf8');
  const note = await openDoc(notePath);
  const noteJs = (code) => note.view.webContents.executeJavaScript(code);
  const described = () => describeStatus(note.status, { name: note.name, filePath: notePath });
  assert.deepEqual(note.status.kitUpdate, { from: '1.0.0', to: '1.1.0' });
  assert.equal(described().badge, 'kit-update');
  assert.deepEqual(described().banners.map((b) => [b.kind, b.message]),
    [['kit-update', 'This document uses kit 1.0.0; 1.1.0 is available.']]);
  assert.equal(menu.getMenuItemById('update-kit').enabled, true);
  assert.equal(menu.getMenuItemById('undo-kit').enabled, false);
  await note.onBannerAction('kit-update', 'dismiss');
  assert.deepEqual(described().banners, [], 'Not now hides the banner');
  assert.equal(described().badge, 'kit-update', 'the badge stays');
  assert.equal(menu.getMenuItemById('update-kit').enabled, true, 'so does the menu item');

  step('Update kit with unsaved changes writes kit and data in one write');
  await noteJs(`(() => { const t = document.getElementById('text'); t.value = 'Remember the milk';
    t.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  await until('the note is dirty', () => note.isDirty);
  const beforeKit = parseDocument(noteOriginal).parts;
  const noteStore = path.join(storeDir, pathKey(notePath));
  const versionNames = async () => (await exists(noteStore) ? await fs.readdir(noteStore) : []).filter((n) => n.endsWith('.html'));
  assert.deepEqual(await versionNames(), []);
  const generationBefore = note.generation;
  const dataSection = async () => parseDocument(await fs.readFile(notePath, 'utf8')).parts.data;
  answer(0); // Update kit
  await note.onBannerAction('kit-update', 'update-kit');
  assert.deepEqual(sheets.map((o) => [o.message, o.detail, o.buttons, o.defaultId, o.cancelId]), [[
    'Update the kit of note.ev.html from 1.0.0 to 1.1.0?',
    'Only the kit is replaced. The previous file is kept in the version store. Your unsaved changes are saved with it.',
    ['Update kit', 'Cancel'], 0, 1,
  ]]);
  let afterKit = parseDocument(await fs.readFile(notePath, 'utf8')).parts;
  assert.equal(afterKit.kitVersion, '1.1.0');
  assert.equal(afterKit.kit, findKit('1.1.0').text);
  assert.equal(JSON.parse(afterKit.data).text, 'Remember the milk');
  assert.equal(afterKit.style, beforeKit.style);
  assert.equal(afterKit.script, beforeKit.script);
  assert.deepEqual({ ...afterKit, kit: '', kitVersion: '', data: '' }, { ...beforeKit, kit: '', kitVersion: '', data: '' });
  const stored = await versionNames();
  assert.equal(stored.length, 1, 'exactly one new version');
  assert.equal(await fs.readFile(path.join(noteStore, stored[0]), 'utf8'), noteOriginal, 'the previous file');
  assert.equal(note.isDirty, false);
  assert.ok(note.generation > generationBefore, 'the page reloaded');
  await until('the note reloaded', () => !note.view.webContents.isLoading());
  await until('the note shows its data', async () => (await noteJs('document.getElementById("text").value')) === 'Remember the milk');
  assert.equal(note.status.kitUpdate, null);
  const dataAfterUpdate = await dataSection();
  assert.deepEqual(note.status.kitUpdated, { from: '1.0.0', to: '1.1.0' });
  assert.deepEqual(described().banners.map((b) => [b.kind, b.message]), [['kit-updated', 'Kit updated to 1.1.0.']]);
  assert.equal(menu.getMenuItemById('update-kit').enabled, false);
  assert.equal(menu.getMenuItemById('undo-kit').enabled, true);

  step('Undo brings kit 1.0.0 back');
  answer();
  await note.onBannerAction('kit-updated', 'undo-kit');
  assert.deepEqual(sheets, [], 'no confirmation');
  afterKit = parseDocument(await fs.readFile(notePath, 'utf8')).parts;
  assert.equal(afterKit.kitVersion, '1.0.0');
  assert.equal(afterKit.kit, findKit('1.0.0').text);
  assert.equal(JSON.parse(afterKit.data).text, 'Remember the milk');
  assert.equal(note.status.kitUpdated, null);
  assert.deepEqual(note.status.kitUpdate, { from: '1.0.0', to: '1.1.0' });
  assert.equal(described().badge, 'kit-update');
  assert.equal(menu.getMenuItemById('undo-kit').enabled, false);
  assert.equal(menu.getMenuItemById('update-kit').enabled, true);
  assert.equal((await versionNames()).length, 2, 'Undo stored a second version');
  assert.equal(await dataSection(), dataAfterUpdate, 'a clean kit write leaves the data section byte-identical');
  await until('the note reloaded', () => !note.view.webContents.isLoading());

  step('Undo with unsaved changes asks first and saves them with it');
  answer(0); // Update kit (clean document)
  await note.updateKit();
  await until('the note reloaded', () => !note.view.webContents.isLoading());
  assert.equal(await dataSection(), dataAfterUpdate, 'the clean update keeps the data bytes');
  assert.equal((await versionNames()).length, 3);
  await noteJs(`(() => { const t = document.getElementById('text'); t.value = 'Edited after update';
    t.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  await until('the note is dirty after the update', () => note.isDirty);
  const beforeUndo = await fs.readFile(notePath, 'utf8');
  answer(1); // Cancel
  assert.equal(await note.undoKitUpdate(), false);
  assert.deepEqual(sheets.map((o) => [o.message, o.detail, o.buttons, o.defaultId, o.cancelId]), [[
    'Undo the kit update of note.ev.html?',
    'Kit 1.0.0 is restored. The previous file is kept in the version store. Your unsaved changes are saved with it.',
    ['Undo kit update', 'Cancel'], 0, 1,
  ]]);
  assert.equal(await fs.readFile(notePath, 'utf8'), beforeUndo, 'Cancel writes nothing');
  assert.equal((await versionNames()).length, 3);
  assert.equal(note.isDirty, true);
  answer(0); // Undo kit update
  assert.equal(await note.undoKitUpdate(), true);
  assert.equal(sheets.length, 1);
  afterKit = parseDocument(await fs.readFile(notePath, 'utf8')).parts;
  assert.equal(afterKit.kitVersion, '1.0.0');
  assert.equal(JSON.parse(afterKit.data).text, 'Edited after update');
  assert.equal((await versionNames()).length, 4);
  await until('the note reloaded', () => !note.view.webContents.isLoading());

  step('a kit update that hits a data conflict asks first');
  await noteJs(`(() => { const t = document.getElementById('text'); t.value = 'Mine';
    t.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  await until('the note is dirty again', () => note.isDirty);
  const onDisk = parseDocument(await fs.readFile(notePath, 'utf8')).parts;
  await fs.writeFile(notePath, buildDocument({ ...onDisk, data: JSON.stringify({ text: 'Theirs' }) }));
  await until('the data conflict is seen', () => note.status.dataConflict);
  const conflictFile = await fs.readFile(notePath, 'utf8');
  const versionsBefore = await versionNames();
  answer(0, 2); // Update kit, then Cancel at the conflict sheet
  await note.updateKit();
  assert.deepEqual(sheets.map((o) => o.message), [
    'Update the kit of note.ev.html from 1.0.0 to 1.1.0?',
    'The data in note.ev.html was changed on disk since you opened it.',
  ]);
  assert.equal(await fs.readFile(notePath, 'utf8'), conflictFile, 'nothing written');
  assert.deepEqual(await versionNames(), versionsBefore);
  assert.equal(note.isDirty, true);
  answer(1, 1); // Cancel the kit sheet: nothing happens at all
  await note.updateKit();
  assert.equal(sheets.length, 1);
  assert.equal(await fs.readFile(notePath, 'utf8'), conflictFile);
  answer(1);
  await workspace.closeDocument(note.id);
  assert.equal(note.disposed, true);

  step('a non-document from the system opens in the browser; a dropped one gets the sheet');
  const plainPage = path.join(dir, 'plain-page.html');
  await fs.writeFile(plainPage, '<!doctype html><title>Plain</title><p>Hello</p>\n');
  const handedOff = [];
  const realOpenInBrowser = workspace.openInBrowser;
  workspace.openInBrowser = async (p) => { handedOff.push(p); return true; };
  answer();
  assert.equal(await workspace.open(plainPage, { source: 'os' }), null);
  assert.deepEqual(handedOff, [plainPage]);
  assert.deepEqual(sheets, [], 'no sheet');
  answer(0);
  assert.equal(await workspace.open(plainPage), null);
  assert.deepEqual(handedOff, [plainPage], 'not handed off again');
  assert.deepEqual(sheets.map((o) => o.message), ['plain-page.html is not an EverythingApp document.']);
  workspace.openInBrowser = async () => false; // no browser found: the sheet after all
  answer(0);
  await workspace.open(plainPage, { source: 'os' });
  assert.deepEqual(sheets.map((o) => o.message), ['plain-page.html is not an EverythingApp document.']);
  workspace.openInBrowser = realOpenInBrowser;

  step('a downloaded host update becomes a notice; Restart Now goes through the close summary');
  // The last step: a confirmed quit disposes the workspace. The updater and
  // the app are fakes; workspace.exit goes through hostUpdates.exit as in main.js.
  const calls = [];
  const fakeUpdater = new EventEmitter();
  fakeUpdater.checkForUpdates = async () => ({});
  fakeUpdater.quitAndInstall = (isSilent, isForceRunAfter) => calls.push(['quitAndInstall', isSilent, isForceRunAfter]);
  const hostUpdates = createUpdates({
    updater: fakeUpdater,
    app: { getVersion: () => '0.1.0', isInApplicationsFolder: () => true, relaunch: () => calls.push('relaunch'), exit: (code) => calls.push(['exit', code]) },
    workspace,
    log: { write: async () => {} },
    dialog: null,
    packaged: true,
    platform: process.platform,
    probe: false,
  });
  workspace.exit = (options) => hostUpdates.exit(options);
  workspace.onNoticeAction = (kind, action) => hostUpdates.noticeAction(kind, action);
  for (const d of workspace.openDocuments()) assert.equal(await d.save(), true);
  const updPaths = ['update-a.ev.html', 'update-b.ev.html'].map((n) => path.join(dir, n));
  for (const p of updPaths) {
    await fs.copyFile(fixture('hours-sheet'), p);
    await addRowTo(await openDoc(p), `${path.basename(p)} dirty`);
  }
  fakeUpdater.emit('update-downloaded', { version: '0.2.0' });
  assert.deepEqual(workspace.notices, [{ kind: 'update', version: '0.2.0' }]);
  assert.equal(workspace.model.list.visible, true, 'the list shows the notice');
  const updNotice = () => workspace.hostUi.view.webContents.executeJavaScript(
    '[...document.querySelectorAll("#notices section")].map((s) => [s.querySelector("p").textContent, [...s.querySelectorAll("button")].map((b) => b.textContent)])');
  await until('the host UI shows the update notice', async () => (await updNotice()).length === 1);
  assert.deepEqual(await updNotice(), [['EverythingApp 0.2.0 is ready. It installs when you quit.', ['Restart Now', 'Later']]]);
  answer(2); // Cancel in the close summary
  hostUpdates.noticeAction('update', 'restart');
  await until('the close summary was asked', () => sheets.length === 1);
  await workspace.quitting;
  assert.equal(sheets[0].message, 'Do you want to save the changes to 2 documents?');
  assert.deepEqual(calls, [], 'cancelled: nothing installs');
  assert.equal(workspace.openDocuments().filter((d) => d.isDirty).length, 2, 'nothing closed');
  assert.deepEqual(workspace.notices, [{ kind: 'update', version: '0.2.0' }], 'the notice stays');
  answer(0); // Save all
  await workspace.quit({ restart: true });
  assert.deepEqual(calls, [['quitAndInstall', true, true]], 'the update installs and the host restarts');
  const rowsBefore = (await dataOf(fixture('hours-sheet'))).rows.length;
  for (const p of updPaths) assert.equal((await dataOf(p)).rows.length, rowsBefore + 1, 'saved first');

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
