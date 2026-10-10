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
const { parseDocument } = require('./frame');
const { Document } = require('./document');
const { Registry } = require('./registry');
const { HostUi } = require('./host-ui');
const { createThumbnailTriggers } = require('./thumbnail-triggers');
const { captureThumbnail } = require('./thumbnails');
const { buildUiState } = require('./ui-state');
const { showErrorSheet } = require('./errors');
const { updateMenu } = require('./menu');

const DEFAULT_SIZE = { width: 1280, height: 860 };
// Above the 200 px that workspace.json requires of the saved bounds.
const MIN_SIZE = { minWidth: 400, minHeight: 300 };
const SUMMARY_NAMES = 10;
const THUMBNAIL_MARGIN = 16; // thumbnail width = list width - 16

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

// What the error sheet says when an intent from the host UI fails.
const INTENT_ACTIONS = {
  select: 'show',
  close: 'close',
  banner: 'carry out the banner action for',
  'open-dialog': 'show the open dialog',
  'open-files': 'open the dropped files',
  list: 'change the document list',
  'resize-split': 'resize the panes',
  'move-tab': 'move',
  split: 'split the panes for',
  notice: 'answer the notice',
};

// The one window of the host. It holds every open document as a tab in a
// pane (workspace-model.js), lays out their views (layout.js), shows every
// prompt as a sheet on itself, and asks before quitting with unsaved
// changes. Each pane shows its selected document; the others stay hidden.
// The host UI (host-ui.js) lies beneath the documents and draws the list,
// tab strips, banner rows and empty state in the space the layout keeps
// free; it gets the state after every apply() and reports intents
// (handleIntent).
class Workspace {
  constructor({ storeDir, workspaceFile, allowDevTools = false, recordThumbnails = false }) {
    this.storeDir = storeDir;
    this.workspaceFile = workspaceFile;
    this.allowDevTools = allowDevTools;
    this.registry = new Registry();
    this.model = wm.createModel();
    this.layout = null;          // the last computeLayout()
    this.menu = null;            // the application menu, if one is installed (menu.js)
    this.notices = [];           // workspace notices (restore failures, a ready host update), shown until dismissed
    this.onNoticeAction = () => {}; // (kind, action) for every notice button (main.js sets it)
    this.checkForUpdates = async () => {}; // Help → Check for Updates… (main.js sets it)
    this.showLog = async () => {};        // Help → Show Log (main.js sets it)
    // The end of a confirmed quit; main.js replaces it so a ready update installs.
    this.exit = ({ restart = false } = {}) => {
      if (restart) app.relaunch();
      app.exit(0);
    };
    this.docTypes = new WeakMap(); // Document → { html, docType } of its running page
    this.prompting = false;      // a sheet is open
    this.restoring = false;
    this.pendingOpens = [];      // open() calls that arrived during restore()
    this.quitting = null;        // the running quit()
    this.quitConfirmed = false;
    // Thumbnails: the newest data URL per document (memory only), when to
    // capture (thumbnail-triggers.js), and every capture asked for (the smoke
    // test reads thumbnailCaptures).
    this.thumbnails = new Map();
    this.recordThumbnails = recordThumbnails; // only the smoke test asks for the log
    this.thumbnailCaptures = [];
    this.captureSeq = new Map();  // docId → the newest capture asked for
    this.shown = new Set();       // ids of the documents whose view is visible
    this.unshownLoads = new Set(); // loaded while hidden, not captured: captured when first shown
    this.thumbnailTriggers = createThumbnailTriggers({
      capture: (docId, reason) => this.captureThumbnail(docId, reason),
      captureHidden: false, // a view never shown cannot be captured
      shown: (docId) => this.shown.has(docId) && !!this.documentById(docId),
    });

    // Hidden until restore() has given it its bounds.
    this.win = new BaseWindow({ ...DEFAULT_SIZE, ...MIN_SIZE, title: 'EverythingApp', show: false });
    this.win.on('resize', () => this.apply(this.model));
    // A drag never outlives the window's focus: the host UI goes back beneath the documents.
    this.win.on('blur', () => this.hostUi.lower());
    // Closing the window quits (close summary first).
    this.win.on('close', (event) => {
      if (this.quitConfirmed) return;
      event.preventDefault();
      this.quit();
    });
    // The first child of the window; document views go above it.
    this.hostUi = new HostUi({
      win: this.win,
      onIntent: (intent) => this.handleIntent(intent),
      onLoad: () => this.sendThumbnails(),
      allowDevTools,
    });
    this.hostUi.ready.catch((err) => this.showError({ action: 'show the document list and tabs', err }));
    // Split Right's shortcut, for layouts where the menu accelerator does not fire.
    this.onInput = (event, input) => this.handleInput(event, input);
    this.hostUi.view.webContents.on('before-input-event', this.onInput);
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
    // restore() has not finished: its model replaces any tab added now.
    if (this.restoring) {
      this.pendingOpens.push({ rawPath, paneId });
      return null;
    }
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
    } else if ((result.codes || []).includes('api-newer')) {
      // A document for a newer host: the update check may bring one.
      const choice = await this.sheet({
        type: 'warning',
        message: `EverythingApp refused to open ${name}.`,
        detail: result.report,
        buttons: ['Check for Updates', 'Copy report', 'OK'],
        defaultId: 0,
        cancelId: 2,
      });
      if (choice === 0) await this.checkForUpdates();
      if (choice === 1) clipboard.writeText(result.report);
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
        rendered: (reason) => this.rendered(doc, reason),
      },
    });
    // Every accepted change of a document that is on screen.
    const onDirty = doc.onDirty.bind(doc);
    doc.onDirty = (payload) => {
      const before = doc.latestChange;
      onDirty(payload);
      if (doc.latestChange !== before) this.thumbnailTriggers.changed(doc.id, this.shown.has(doc.id));
    };
    this.registry.add(doc);
    doc.view.setVisible(false);
    doc.view.webContents.on('before-input-event', this.onInput);
    // Document views go above the host-UI view, which comes first.
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
    this.thumbnailTriggers.forget(doc.id);
    this.thumbnails.delete(doc.id);
    this.captureSeq.delete(doc.id);
    this.shown.delete(doc.id);
    this.unshownLoads.delete(doc.id);
    this.registry.remove(doc);
    if (!doc.view.webContents.isDestroyed()) doc.view.webContents.removeListener('before-input-event', this.onInput);
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

  // Sets the model, lays out the views, updates the title and the menu, and
  // sends the host UI its new state. While a notice exists, the list that
  // holds it is shown.
  apply(model) {
    this.model = this.notices.length > 0 && !model.list.visible ? wm.setList(model, { visible: true }) : model;
    if (this.win.isDestroyed()) return;
    this.layoutViews();
    this.updateTitle();
    if (this.menu) updateMenu(this.menu, this);
    this.pushUiState();
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
    this.hostUi.view.setBounds({ x: 0, y: 0, width, height });
    for (const { paneId, document: rect } of this.layout.panes) {
      const pane = wm.findNode(this.model, paneId);
      for (const docId of pane.tabs) {
        const doc = this.documentById(docId);
        if (!doc) continue;
        doc.view.setBounds(rect);
        const visible = docId === pane.selected;
        doc.view.setVisible(visible);
        this.visibilityChanged(docId, visible);
      }
    }
    // A document in no pane (closing) is not shown, and not captured.
    const inPane = new Set(this.layout.panes.flatMap(({ paneId }) => wm.findNode(this.model, paneId).tabs));
    for (const docId of [...this.shown]) if (!inPane.has(docId)) this.shown.delete(docId);
  }

  // ---------- Thumbnails ----------

  // A document became visible or hidden (called for every document on every layout).
  visibilityChanged(docId, visible) {
    const was = this.shown.has(docId);
    if (visible === was) return;
    if (visible) {
      this.shown.add(docId);
      // Its first load went uncaptured because the view was hidden; the view
      // has not painted yet, so the capture waits a moment.
      if (this.unshownLoads.delete(docId)) this.thumbnailTriggers.firstShown(docId);
    } else {
      this.shown.delete(docId);
      this.thumbnailTriggers.hidden(docId);
    }
  }

  // Document.ui.rendered: the page loaded, saved or reloaded.
  rendered(doc, reason) {
    if (reason === 'load') {
      if (this.shown.has(doc.id)) this.thumbnailTriggers.loaded(doc.id, true);
      else this.unshownLoads.add(doc.id);
    } else if (reason === 'save') {
      this.thumbnailTriggers.saved(doc.id);
    } else if (reason === 'reload') {
      this.thumbnailTriggers.reloaded(doc.id);
    }
  }

  // Captures the document's view at the list's thumbnail width in device
  // pixels, keeps the newest result per document and sends it to the host UI.
  // A failed capture keeps the thumbnail it had. Never rejects.
  async captureThumbnail(docId, reason) {
    if (this.recordThumbnails) this.thumbnailCaptures.push([docId, reason]);
    const doc = this.documentById(docId);
    if (!doc || this.win.isDestroyed()) return;
    const seq = (this.captureSeq.get(docId) || 0) + 1;
    this.captureSeq.set(docId, seq);
    const scale = screen.getDisplayMatching(this.win.getBounds()).scaleFactor || 1;
    const width = Math.round((this.model.list.width - THUMBNAIL_MARGIN) * scale);
    const dataUrl = await captureThumbnail(doc.view.webContents, { width });
    // Closed meanwhile, or a newer capture was asked for.
    if (dataUrl === null || this.captureSeq.get(docId) !== seq || this.documentById(docId) !== doc) return;
    this.thumbnails.set(docId, dataUrl);
    this.hostUi.pushThumbnail(docId, dataUrl);
  }

  // The host UI page (re)loaded: it knows no thumbnails.
  sendThumbnails() {
    for (const [docId, dataUrl] of this.thumbnails) this.hostUi.pushThumbnail(docId, dataUrl);
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

  // View → Split Right / Split Down: the active document moves into a new
  // pane on that side of its pane. Nothing happens when it is not allowed.
  splitActive(edge) {
    const docId = wm.activeDocId(this.model);
    const paneId = docId === null ? null : wm.paneOf(this.model, docId);
    if (paneId === null) return;
    this.splitTab(docId, paneId, edge);
  }

  // docId into a new pane at the edge of paneId, if canSplit.
  splitTab(docId, paneId, edge) {
    if (!wm.canSplit(this.model, docId, paneId)) return;
    this.applyAndFocus(wm.splitPane(this.model, docId, paneId, edge));
  }

  // Cmd+\ (Ctrl+\ elsewhere) is Split Right. The menu accelerator did not
  // fire on a Swiss German layout, so every web contents of the window
  // reports key presses here; preventDefault also stops the accelerator, so
  // the split never runs twice.
  handleInput(event, input) {
    const modifier = process.platform === 'darwin' ? input.meta : input.control;
    if (input.type !== 'keyDown' || input.code !== 'Backslash' || !modifier || input.alt || input.shift) return;
    event.preventDefault();
    this.splitActive('right');
  }

  setList(changes) {
    this.apply(wm.setList(this.model, changes));
  }

  // ---------- Host UI ----------

  // The document type of the page a document runs; read again only after
  // the page was replaced.
  docTypeOf(doc) {
    let known = this.docTypes.get(doc);
    if (!known || known.html !== doc.html) {
      known = { html: doc.html, docType: parseDocument(doc.html).parts?.docType ?? '' };
      this.docTypes.set(doc, known);
    }
    return known.docType;
  }

  pushUiState() {
    this.hostUi.pushState(buildUiState({
      model: this.model,
      layout: this.layout,
      documents: this.openDocuments().map((doc) => ({
        id: doc.id, path: doc.filePath, docType: this.docTypeOf(doc), status: doc.status,
      })),
      notices: this.notices,
      platform: process.platform,
    }));
  }

  // An intent from the host UI, checked by ipc.js (ui-intents.js). Anything
  // that goes wrong is shown as an error sheet. Never rejects.
  async handleIntent(intent) {
    const doc = intent.docId === undefined ? null : this.documentById(intent.docId);
    // The host UI stays on top only while a drag runs. Any other intent means
    // it has ended or never will (a divider drag's own resize-split excepted).
    if (intent.type !== 'drag' && intent.type !== 'resize-split') this.hostUi.lower();
    try {
      switch (intent.type) {
        case 'select':
          this.select(intent.docId);
          break;
        case 'close':
          await this.closeDocument(intent.docId);
          break;
        case 'banner':
          if (doc) await doc.onBannerAction(intent.kind, intent.action);
          break;
        case 'open-dialog':
          await this.openDialog(); // into the focused pane
          break;
        case 'open-files':
          for (const p of intent.paths) await this.open(p);
          break;
        case 'list':
          this.setList({ visible: intent.visible, mode: intent.mode, width: intent.width });
          break;
        case 'resize-split':
          this.apply(wm.resizeSplit(this.model, intent.splitId, intent.sizes));
          break;
        case 'notice':
          if (intent.action === 'dismiss') this.removeNotice(intent.kind);
          this.onNoticeAction(intent.kind, intent.action);
          break;
        case 'move-tab':
          if (doc) this.applyAndFocus(wm.moveTab(this.model, intent.docId, intent.paneId, intent.index));
          break;
        case 'split':
          if (doc) this.splitTab(intent.docId, intent.paneId, intent.edge);
          break;
        case 'drag':
          if (intent.active) this.hostUi.raise();
          else this.hostUi.lower();
          break;
        default:
          break;
      }
    } catch (err) {
      await this.showError({ action: INTENT_ACTIONS[intent.type] || 'do that with', filePath: doc?.filePath, err });
    }
  }

  // ---------- Notices ----------

  // Shows a workspace notice, replacing any notice of the same kind.
  setNotice(notice) {
    this.notices = [...this.notices.filter((n) => n.kind !== notice.kind), notice];
    if (!this.restoring) this.apply(this.model);
  }

  removeNotice(kind) {
    if (!this.notices.some((n) => n.kind === kind)) return;
    this.notices = this.notices.filter((n) => n.kind !== kind);
    if (!this.restoring) this.apply(this.model);
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
    await showErrorSheet((options) => this.sheet(options), { action, filePath, err },
      { copy: (text) => clipboard.writeText(text) });
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
  // unsaved, or the user chose "Don't save" for what is. Whatever a choice
  // saved, documents can be edited while it ran: anything dirty that was not
  // answered "Don't save" in this summary gets asked about before it returns.
  async confirmCloseAll() {
    const declined = new Set();
    for (;;) {
      if (!(await this.closeSummary(declined))) return false;
      await Promise.all(this.openDocuments().map((doc) => doc.settle()));
      if (!this.openDocuments().some((doc) => doc.isDirty && !declined.has(doc))) return true;
    }
  }

  // One pass of the close summary over the dirty documents not in declined;
  // adds the documents answered "Don't save" to it. True if it did not stop
  // the close.
  async closeSummary(declined) {
    const docs = this.openDocuments();
    await Promise.all(docs.map((doc) => doc.settle()));
    const dirty = docs.filter((doc) => doc.isDirty && !declined.has(doc));
    if (dirty.length === 0) return true;
    if (dirty.length === 1) {
      this.select(dirty[0].id);
      const answer = await dirty[0].promptSave();
      if (answer === 'discard') declined.add(dirty[0]);
      return answer !== 'cancel';
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
        const answer = await doc.promptSave();
        if (answer === 'cancel') return false;
        if (answer === 'discard') declined.add(doc);
      }
      return true;
    }
    return false;
  }

  // Close Window, Quit, Restart Now (restart: the host starts again): the
  // close summary, then workspace.json, then exit. A second request while one
  // runs joins it. Never rejects.
  quit({ restart = false } = {}) {
    if (!this.quitting) {
      this.quitting = this.runQuit({ restart })
        .catch((err) => this.showError({ action: 'quit', err }))
        .finally(() => { this.quitting = null; });
    }
    return this.quitting;
  }

  async runQuit({ restart }) {
    if (!(await this.confirmCloseAll())) return;
    this.quitConfirmed = true;
    try {
      await this.persist();
    } catch (err) {
      await this.showError({ action: 'save the workspace to', filePath: this.workspaceFile, err });
    }
    this.dispose();
    this.exit({ restart });
  }

  // Closes every document, the host UI and the window, without asking.
  dispose() {
    for (const doc of [...this.registry.documents]) this.forget(doc);
    this.hostUi.dispose();
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
  // named once in failed (also kept as the restore notice for the host UI).
  async restore() {
    this.restoring = true;
    const failed = [];
    try {
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
        this.notices = this.notices.filter((n) => n.kind !== 'restore');
        if (failed.length > 0) this.notices.push({ kind: 'restore', failed });
        // The window shows once the host UI can draw in it (a failure to load
        // it is reported by the constructor).
        await this.hostUi.ready.catch(() => {});
        if (!this.win.isDestroyed()) this.win.show();
      }
      this.applyAndFocus(this.model);
    } finally {
      // Opens that arrived during restore() open whatever happened to it.
      for (const { rawPath, paneId } of this.pendingOpens.splice(0)) await this.open(rawPath, { paneId });
    }
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
