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

  const workspace = new Workspace({ storeDir, workspaceFile });
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
  const second = new Workspace({ storeDir, workspaceFile });
  try {
    assert.deepEqual(await second.restore(), { failed: [] });
    assert.deepEqual(layoutOf(second), layoutOf(workspace), 'same panes and tabs');
    assert.equal(second.model.root.direction, 'row');
    assert.deepEqual(second.model.root.sizes, workspace.model.root.sizes);
    assert.equal(second.activeDocument().filePath, otherPath, 'same active document');
    assert.deepEqual(second.model.list, workspace.model.list);
    assert.deepEqual(second.win.getBounds(), workspace.win.getNormalBounds(), 'same window bounds');
    assert.equal(second.win.isVisible(), true);
    assert.equal(second.notice, null);
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
    assert.deepEqual(third.notice, { failed });
    assert.equal(third.registry.documents.size, 1, 'the file listed twice opens once');
    assert.deepEqual(layoutOf(third), [{ tabs: [good], selected: good }]);
    assert.equal(third.activeDocument().filePath, good);
    assert.equal(third.win.isVisible(), true, 'the window shows');
    assert.deepEqual(third.win.getBounds(), { x: 80, y: 80, width: 900, height: 700 });
    // The host UI names each one at the top of the list, which shows while it does.
    assert.equal(third.model.list.visible, true);
    await third.hostUi.ready;
    const noticeItems = () => third.hostUi.view.webContents.executeJavaScript(
      '[...document.querySelectorAll("#notice li")].map((li) => li.textContent)');
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
  intentFrom(todo3.webContentsId, { type: 'dismiss-notice' });
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
