'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const { app, BaseWindow, dialog, clipboard, screen } = require('electron');
const wm = require('./workspace-model');
const { computeLayout, bannerRowHeight, neighbourPane } = require('./layout');
const { describeStatus } = require('./status');
const { documentLabels } = require('./labels');
const {
  toWorkspaceFile, pathsInFile, modelFromWorkspaceFile, fitBounds, readWorkspaceFile, writeWorkspaceFile,
} = require('./workspace-file');
const { readDocumentFile } = require('./open');
const { Document } = require('./document');
const { Registry } = require('./registry');
const { errorBox } = require('./errors');
const { updateMenu } = require('./menu');

const DEFAULT_SIZE = { width: 1280, height: 860 };
// Above the 200 px that workspace.json requires of the saved bounds.
const MIN_SIZE = { minWidth: 400, minHeight: 300 };
const SUMMARY_NAMES = 10;

// The detail of the close summary: up to ten labels, then the rest as a count.
function closeSummaryDetail(labels) {
  const lines = labels.slice(0, SUMMARY_NAMES);
  if (labels.length > SUMMARY_NAMES) lines.push(`and ${labels.length - SUMMARY_NAMES} more`);
  return [...lines, '', "Your changes will be lost if you don't save them."].join('\n');
}

// Why a path of workspace.json did not open (readDocumentFile result).
function restoreReason(result) {
  if (result.kind === 'not-document') return 'not an EverythingApp document';
  if (result.kind === 'refused') return 'no longer follows the document specification';
  return result.code === 'ENOENT' ? 'moved or deleted' : `could not be read: ${result.message}`;
}

// The one window of the host. It holds every open document as a tab in a
// pane (workspace-model.js), lays out their views (layout.js), shows every
// prompt as a sheet on itself, and asks before quitting with unsaved
// changes. Each pane shows its selected document; the others stay hidden.
// The host UI (tab strips, banner rows, document list; Task 10) will draw in
// the space the layout keeps free; until then that space is blank and tabs
// are switched from the menu.
class Workspace {
  constructor({ storeDir, workspaceFile, allowDevTools = false }) {
    this.storeDir = storeDir;
    this.workspaceFile = workspaceFile;
    this.allowDevTools = allowDevTools;
    this.registry = new Registry();
    this.model = wm.createModel();
    this.layout = null;          // the last computeLayout()
    this.hostUi = null;          // Task 10
    this.menu = null;            // the application menu, if one is installed (menu.js)
    this.notice = null;          // { failed } from restore(), for the host UI (Task 10)
    this.prompting = false;      // a sheet is open
    this.restoring = false;
    this.quitting = null;        // the running quit()
    this.quitConfirmed = false;

    // Hidden until restore() has given it its bounds.
    this.win = new BaseWindow({ ...DEFAULT_SIZE, ...MIN_SIZE, title: 'EverythingApp', show: false });
    this.win.on('resize', () => this.apply(this.model));
    // Closing the window quits (close summary first).
    this.win.on('close', (event) => {
      if (this.quitConfirmed) return;
      event.preventDefault();
      this.quit();
    });
  }

  // ---------- Queries ----------

  documentById(docId) {
    for (const doc of this.registry.documents) if (doc.id === docId) return doc;
    return null;
  }

  activeDocument() {
    const docId = wm.activeDocId(this.model);
    return docId === null ? null : this.documentById(docId);
  }

  // The documents with a tab, in pane and tab order.
  openDocuments() {
    return wm.docsInOrder(this.model).map((docId) => this.documentById(docId)).filter(Boolean);
  }

  // File name, or "name · folder" when two open documents share it.
  labels() {
    return documentLabels(this.openDocuments().map((doc) => doc.filePath));
  }

  // ---------- Opening ----------

  // Opens a file as a new tab in paneId (default: the focused pane), or
  // selects its tab if it is open already. Anything that is not a conforming
  // document gets a sheet. Never rejects.
  async open(rawPath, { paneId } = {}) {
    try {
      const result = await readDocumentFile(rawPath);
      const existing = result.kind === 'error' ? null : this.registry.byPath(result.filePath);
      if (existing) {
        this.select(existing.id);
        return existing;
      }
      if (result.kind !== 'document') {
        await this.refuse(result);
        return null;
      }
      const doc = await this.load(result);
      let model = wm.addTab(this.model, doc.id, { paneId });
      // The pane closed while the file was read: the focused pane instead.
      if (model === this.model) model = wm.addTab(this.model, doc.id);
      this.applyAndFocus(model);
      return doc;
    } catch (err) {
      await this.showError({ action: 'open', filePath: rawPath, err });
      return null;
    }
  }

  // The M1 messages for files that do not open.
  async refuse(result) {
    const name = path.basename(result.filePath);
    if (result.kind === 'error') {
      await this.sheet({ type: 'error', message: `${name} could not be opened.`, detail: result.message, buttons: ['OK'] });
    } else if (result.kind === 'not-document') {
      await this.sheet({
        type: 'info',
        message: `${name} is not an EverythingApp document.`,
        detail: 'EverythingApp opens HTML documents that contain <meta name="ev-host-api">.',
        buttons: ['OK'],
      });
    } else {
      const choice = await this.sheet({
        type: 'warning',
        message: `EverythingApp refused to open ${name}.`,
        detail: result.report,
        buttons: ['Copy report', 'OK'],
        defaultId: 1,
        cancelId: 1,
      });
      if (choice === 0) clipboard.writeText(result.report);
    }
  }

  // A Document for a conforming file (readDocumentFile result): registered,
  // its view in the window but hidden, no tab yet.
  async load({ filePath, check }) {
    const doc = new Document({
      id: crypto.randomBytes(16).toString('hex'), // also the id of its ev-doc:// origin
      filePath,
      html: check.text,
      parts: check.parts,
      storeDir: this.storeDir,
      allowDevTools: this.allowDevTools,
      ui: {
        sheet: (options) => this.sheet(options),
        update: () => this.apply(this.model),
        rendered: () => {}, // thumbnails: Task 12
      },
    });
    this.registry.add(doc);
    doc.view.setVisible(false);
    // Document views go above the host-UI view (Task 10), which comes first.
    this.win.contentView.addChildView(doc.view);
    // Clicking into a document focuses its pane.
    doc.view.webContents.on('focus', () => {
      const paneId = wm.paneOf(this.model, doc.id);
      if (paneId !== null && paneId !== this.model.focusedPaneId) this.focusPane(paneId);
    });
    try {
      await doc.ready;
    } catch (err) {
      this.forget(doc);
      throw err;
    }
    return doc;
  }

  // Removes a document from the window and the registry, and disposes it.
  forget(doc) {
    this.registry.remove(doc);
    if (!this.win.isDestroyed()) this.win.contentView.removeChildView(doc.view);
    doc.dispose();
  }

  async openDialog({ paneId } = {}) {
    const options = {
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'EverythingApp documents', extensions: ['html', 'htm'] }, { name: 'All files', extensions: ['*'] }],
    };
    const result = this.win.isVisible()
      ? await dialog.showOpenDialog(this.win, options)
      : await dialog.showOpenDialog(options);
    if (result.canceled) return;
    for (const p of result.filePaths) await this.open(p, { paneId });
  }

  // ---------- Model and layout ----------

  // Sets the model, lays out the views, updates the title and the menu. The
  // host UI (Task 10) will be drawn here too.
  apply(model) {
    this.model = model;
    if (this.win.isDestroyed()) return;
    this.layoutViews();
    this.updateTitle();
    if (this.menu) updateMenu(this.menu, this);
  }

  // apply(), then the keyboard goes to the active document.
  applyAndFocus(model) {
    this.apply(model);
    const doc = this.activeDocument();
    if (doc && !doc.view.webContents.isDestroyed()) doc.view.webContents.focus();
  }

  // Each pane's selected document is visible in the pane's document area,
  // below its banners; every other document is hidden there.
  layoutViews() {
    const { width, height } = this.win.getContentBounds();
    const bannerHeight = (paneId) => {
      const pane = wm.findNode(this.model, paneId);
      const doc = pane && pane.selected !== null ? this.documentById(pane.selected) : null;
      if (!doc) return 0;
      return bannerRowHeight(describeStatus(doc.status, { name: doc.name, filePath: doc.filePath }).banners.length);
    };
    this.layout = computeLayout(this.model, { width, height }, { bannerHeight });
    for (const { paneId, document: rect } of this.layout.panes) {
      const pane = wm.findNode(this.model, paneId);
      for (const docId of pane.tabs) {
        const doc = this.documentById(docId);
        if (!doc) continue;
        doc.view.setBounds(rect);
        doc.view.setVisible(docId === pane.selected);
      }
    }
  }

  updateTitle() {
    const active = this.activeDocument();
    this.win.setTitle(active ? `${active.isDirty ? '• ' : ''}${this.labels().get(active.filePath)}` : 'EverythingApp');
    if (process.platform === 'darwin') {
      this.win.setDocumentEdited([...this.registry.documents].some((doc) => doc.isDirty));
      this.win.setRepresentedFilename(active ? active.filePath : '');
    }
  }

  select(docId) {
    if (!this.documentById(docId)) return;
    this.applyAndFocus(wm.selectTab(this.model, docId));
  }

  focusPane(paneId) {
    this.apply(wm.focusPane(this.model, paneId));
  }

  // Window → Next Tab / Previous Tab, Select Tab, Focus Pane; View → Document List.
  cycleTab(delta) {
    this.applyAndFocus(wm.cycleTab(this.model, delta));
  }

  selectTabAt(index) {
    this.applyAndFocus(wm.selectTabAt(this.model, index));
  }

  focusNeighbour(direction) {
    const paneId = this.layout && neighbourPane(this.layout, this.model.focusedPaneId, direction);
    if (paneId) this.applyAndFocus(wm.focusPane(this.model, paneId));
  }

  setList(changes) {
    this.apply(wm.setList(this.model, changes));
  }

  // ---------- Sheets ----------

  // One sheet at a time, on the workspace window. Returns the button index,
  // or null if a sheet is already open or the window is gone.
  async sheet(options) {
    if (this.prompting || this.win.isDestroyed()) return null;
    this.prompting = true;
    try {
      const { response } = this.win.isVisible()
        ? await dialog.showMessageBox(this.win, options)
        : await dialog.showMessageBox(options);
      return response;
    } finally {
      this.prompting = false;
    }
  }

  // An unexpected error, as a sheet with the error report ("Copy report");
  // logged if no sheet can be shown. Never rejects.
  async showError({ action, filePath, err }) {
    const { report, options } = errorBox({ action, filePath, err });
    try {
      const choice = await this.sheet(options);
      if (choice === 0) clipboard.writeText(report);
      if (choice === null) console.error(report);
    } catch (sheetErr) {
      console.error(report, sheetErr);
    }
  }

  // ---------- Closing ----------

  // File → Close: the document's own prompt if it is dirty (after waiting
  // for a running save). True if it closed.
  async closeDocument(docId) {
    const doc = this.documentById(docId);
    if (!doc) return false;
    if (!(await doc.confirmClose())) return false;
    if (this.documentById(docId) !== doc) return true; // closed meanwhile
    const wasActive = this.activeDocument() === doc;
    const model = wm.removeTab(this.model, docId);
    if (wasActive) this.applyAndFocus(model);
    else this.apply(model);
    this.forget(doc);
    return true;
  }

  // The close summary. True if the window may close: nothing is left
  // unsaved, or the user chose "Don't save" for what is.
  async confirmCloseAll() {
    const docs = this.openDocuments();
    await Promise.all(docs.map((doc) => doc.settle()));
    const dirty = docs.filter((doc) => doc.isDirty);
    if (dirty.length === 0) return true;
    if (dirty.length === 1) {
      this.select(dirty[0].id);
      return (await dirty[0].promptSave()) !== 'cancel';
    }
    const labels = this.labels();
    const choice = await this.sheet({
      type: 'question',
      message: `Do you want to save the changes to ${dirty.length} documents?`,
      detail: closeSummaryDetail(dirty.map((doc) => labels.get(doc.filePath))),
      buttons: ['Save all', 'Review each…', 'Cancel'],
      defaultId: 0,
      cancelId: 2,
    });
    if (choice === 0) {
      // A failure, a cancelled conflict prompt or an edit after the snapshot
      // stops here: what was saved stays saved, nothing closes.
      for (const doc of dirty) {
        if (!(await doc.save()) || doc.isDirty) {
          this.select(doc.id);
          return false;
        }
      }
      return true;
    }
    if (choice === 1) {
      // "Don't save" takes effect only if the window really closes.
      for (const doc of dirty) {
        this.select(doc.id);
        if ((await doc.promptSave()) === 'cancel') return false;
      }
      return true;
    }
    return false;
  }

  // Close Window, Quit: the close summary, then workspace.json, then exit.
  // A second request while one runs joins it. Never rejects.
  quit() {
    if (!this.quitting) {
      this.quitting = this.runQuit()
        .catch((err) => this.showError({ action: 'quit', err }))
        .finally(() => { this.quitting = null; });
    }
    return this.quitting;
  }

  async runQuit() {
    if (!(await this.confirmCloseAll())) return;
    this.quitConfirmed = true;
    try {
      await this.persist();
    } catch (err) {
      await this.showError({ action: 'save the workspace to', filePath: this.workspaceFile, err });
    }
    this.dispose();
    app.exit(0);
  }

  // Closes every document and the window, without asking.
  dispose() {
    for (const doc of [...this.registry.documents]) this.forget(doc);
    if (!this.win.isDestroyed()) this.win.destroy();
  }

  // ---------- workspace.json ----------

  // Writes workspace.json. Not while restore() runs: the model is not the
  // user's workspace yet.
  async persist() {
    if (this.restoring || this.win.isDestroyed()) return;
    const value = toWorkspaceFile(this.model, {
      pathOf: (docId) => this.documentById(docId).filePath,
      window: this.win.getNormalBounds(),
    });
    await fs.mkdir(path.dirname(this.workspaceFile), { recursive: true });
    await writeWorkspaceFile(this.workspaceFile, value);
  }

  // Reopens the documents, layout and window bounds of workspace.json, every
  // file checked again, then shows the window. A file that does not open is
  // named once in failed (also kept as this.notice for the host UI).
  async restore() {
    this.restoring = true;
    const failed = [];
    try {
      const value = await readWorkspaceFile(this.workspaceFile);
      if (value) {
        const ids = new Map(); // saved path → doc id, or null
        for (const p of pathsInFile(value)) ids.set(p, await this.restoreOne(p, failed));
        this.apply(modelFromWorkspaceFile(value, (p) => ids.get(p) ?? null));
        const bounds = fitBounds(value.window, screen.getAllDisplays());
        if (bounds) this.win.setBounds(bounds);
      }
    } finally {
      this.restoring = false;
      this.notice = failed.length > 0 ? { failed } : null;
      if (!this.win.isDestroyed()) this.win.show();
    }
    this.applyAndFocus(this.model);
    return { failed };
  }

  // Opens one path of workspace.json without a tab. Its doc id, or null.
  async restoreOne(p, failed) {
    const result = await readDocumentFile(p);
    if (result.kind !== 'document') {
      failed.push({ path: p, reason: restoreReason(result) });
      return null;
    }
    // Another spelling (or a symlink) of a file restored already: it opens
    // once, so only its first path gets the doc id.
    if (this.registry.byPath(result.filePath)) return null;
    try {
      return (await this.load(result)).id;
    } catch (err) {
      failed.push({ path: p, reason: `could not be read: ${err.message}` });
      return null;
    }
  }
}

module.exports = { Workspace, closeSummaryDetail };
