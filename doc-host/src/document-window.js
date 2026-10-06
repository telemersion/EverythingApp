'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { BaseWindow, WebContentsView, session, dialog, clipboard } = require('electron');
const { checkDocument, formatReport } = require('./conformance');
const { validateSnapshot } = require('./validate');
const { writeDocument, sha256 } = require('./write');
const { sectionHashes, classifyChange, watchFile } = require('./watch');
const { serveDocument } = require('./protocol');
const { hardenSession, hardenContents, WEB_PREFERENCES } = require('./security');
const { originFor } = require('./urls');

const SAVE_TIMEOUT_MS = 5000;

// One open document: its window, its sandboxed view, its file on disk.
// The main process owns the path; the document only ever sends data.
class DocumentWindow {
  constructor({ filePath, html, parts, storeDir, registry }) {
    this.filePath = filePath;
    this.name = path.basename(filePath);
    this.storeDir = storeDir;
    this.registry = registry;

    this.html = html;                       // what the protocol handler serves
    this.known = sectionHashes(parts);      // what we believe is on disk
    this.running = this.known.behaviour;    // behaviour running in the view
    this.knownFileHash = sha256(html);

    this.latestChange = 0;                  // highest markDirty() counter seen
    this.savedChange = 0;                   // counter covered by the last write
    this.diskDataChanged = false;
    this.saving = null;
    this.prompting = false;
    this.closeConfirmed = false;
    this.pending = new Map();
    this.requestSeq = 0;

    const id = crypto.randomBytes(16).toString('hex');
    this.origin = originFor(id);
    this.session = session.fromPartition(`ev-doc-${id}`); // no "persist:" = in memory
    const hardened = hardenSession(this.session, this.origin);
    serveDocument(this.session, this.origin, () => this.html);

    this.win = new BaseWindow({ width: 1100, height: 800, title: this.name });
    this.view = new WebContentsView({
      webPreferences: { ...WEB_PREFERENCES, session: this.session, preload: path.join(__dirname, 'preload.js') },
    });
    this.webContentsId = this.view.webContents.id;
    this.win.contentView.addChildView(this.view);
    this.layout();
    this.win.on('resize', () => this.layout());
    hardenContents(this.view.webContents);

    this.win.on('close', (event) => this.onClose(event));
    this.win.on('closed', () => this.dispose());
    this.watcher = watchFile(filePath, () => this.onDiskChange());
    if (process.platform === 'darwin') this.win.setRepresentedFilename(filePath);

    registry.add(this);
    this.updateTitle();
    // Resolves once the document has started loading (after the proxy is set).
    this.ready = hardened.then(() => {
      if (!this.view.webContents.isDestroyed()) this.view.webContents.loadURL(`${this.origin}/`);
    });
  }

  get isDirty() {
    return this.latestChange > this.savedChange;
  }

  layout() {
    const { width, height } = this.win.getContentBounds();
    this.view.setBounds({ x: 0, y: 0, width, height });
  }

  focus() {
    if (this.win.isMinimized()) this.win.restore();
    this.win.focus();
  }

  updateTitle() {
    if (this.win.isDestroyed()) return;
    this.win.setTitle(`${this.isDirty ? '• ' : ''}${this.name}`);
    if (process.platform === 'darwin') this.win.setDocumentEdited(this.isDirty);
  }

  // ---------- IPC from the preload ----------

  onDirty(counter) {
    if (!Number.isSafeInteger(counter) || counter <= this.latestChange) return;
    this.latestChange = counter;
    this.updateTitle();
  }

  onSaveData(payload) {
    if (!payload || typeof payload !== 'object') return;
    const request = this.pending.get(payload.requestId);
    if (!request) return;
    this.pending.delete(payload.requestId);
    clearTimeout(request.timer);
    if (payload.error) request.reject(new Error(String(payload.error)));
    else request.resolve({ json: payload.json, changes: Number(payload.changes) || 0 });
  }

  requestSnapshot() {
    const requestId = ++this.requestSeq;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(requestId);
        reject(new Error('The document did not answer the save request.'));
      }, SAVE_TIMEOUT_MS);
      this.pending.set(requestId, { resolve, reject, timer });
      this.view.webContents.send('doc:request-save', requestId);
    });
  }

  rejectPending(reason) {
    for (const { reject, timer } of this.pending.values()) {
      clearTimeout(timer);
      reject(reason);
    }
    this.pending.clear();
  }

  // ---------- Saving ----------

  save() {
    if (!this.saving) this.saving = this.doSave().finally(() => { this.saving = null; });
    return this.saving;
  }

  async doSave() {
    if (this.diskDataChanged) {
      const choice = await this.ask({
        type: 'warning',
        message: `The data in ${this.name} was changed on disk since you opened it.`,
        detail: 'Keep mine overwrites the data on disk with yours. Take the version on disk discards your changes.',
        buttons: ['Keep mine', 'Take the version on disk', 'Cancel'],
        defaultId: 2,
        cancelId: 2,
      });
      if (choice === null || choice === 2) return false;
      if (choice === 1) return this.reloadFromDisk();
    }
    try {
      const snapshot = await this.requestSnapshot();
      const problem = validateSnapshot(snapshot.json);
      if (problem) throw new Error(problem);
      const written = await writeDocument(this.filePath, snapshot.json, { storeDir: this.storeDir });
      this.acceptOnDisk(written);
      this.diskDataChanged = false;
      this.savedChange = Math.max(this.savedChange, snapshot.changes);
      this.updateTitle();
      // Saving spliced our data into newer behaviour from disk: show it.
      if (this.known.behaviour !== this.running && !this.isDirty) await this.reloadFromDisk();
      return true;
    } catch (err) {
      await this.ask({
        type: 'error',
        message: `${this.name} could not be saved. The file on disk was not changed.`,
        detail: err.message,
        buttons: ['OK'],
      });
      return false;
    }
  }

  acceptOnDisk(html) {
    const check = checkDocument(html);
    this.known = sectionHashes(check.parts);
    this.knownFileHash = sha256(html);
  }

  async reloadFromDisk() {
    let html;
    try {
      html = await fs.readFile(this.filePath, 'utf8');
    } catch (err) {
      await this.ask({ type: 'error', message: `${this.name} could not be read.`, detail: err.message, buttons: ['OK'] });
      return false;
    }
    const check = checkDocument(html);
    if (!check.ok) {
      await this.showReport(check.errors, 'The file on disk no longer follows the document specification. The open version keeps running; saving is refused until the file is fixed.');
      return false;
    }
    this.html = html;
    this.acceptOnDisk(html);
    this.running = this.known.behaviour;
    this.latestChange = 0;
    this.savedChange = 0;
    this.diskDataChanged = false;
    this.rejectPending(new Error('The document was reloaded.'));
    await this.view.webContents.loadURL(`${this.origin}/`);
    this.updateTitle();
    return true;
  }

  // View → Reload
  async reloadInteractive() {
    if (this.isDirty) {
      const choice = await this.ask({
        type: 'question',
        message: `Reload ${this.name} and discard your unsaved changes?`,
        buttons: ['Reload', 'Cancel'],
        defaultId: 1,
        cancelId: 1,
      });
      if (choice !== 0) return;
    }
    await this.reloadFromDisk();
  }

  // ---------- External changes ----------

  async onDiskChange() {
    if (this.saving) await this.saving;
    if (this.win.isDestroyed()) return;
    let html;
    try {
      html = await fs.readFile(this.filePath, 'utf8');
    } catch {
      return; // gone for now (moved, or mid-replace); nothing to compare
    }
    if (sha256(html) === this.knownFileHash) return;
    this.knownFileHash = sha256(html);

    const check = checkDocument(html);
    if (!check.ok) {
      await this.showReport(check.errors, 'The file was changed on disk and no longer follows the document specification. The open version keeps running; saving is refused until the file is fixed.');
      return;
    }
    const onDisk = sectionHashes(check.parts);
    const change = classifyChange(this.known, onDisk);
    if (!change.behaviour && !change.data) return;
    this.known = onDisk;

    if (!this.isDirty) {
      await this.reloadFromDisk();
      return;
    }
    if (change.data) {
      this.diskDataChanged = true; // resolved by the conflict prompt on the next save
      return;
    }
    const choice = await this.ask({
      type: 'info',
      message: `${this.name} was updated on disk.`,
      detail: 'Its behaviour changed (for example, an agent edited it). Your data is unsaved.',
      buttons: ['Save my data and reload', 'Reload and discard my changes', 'Later'],
      defaultId: 0,
      cancelId: 2,
    });
    if (choice === 0) await this.save();
    else if (choice === 1) await this.reloadFromDisk();
  }

  // ---------- Closing ----------

  onClose(event) {
    if (this.closeConfirmed || !this.isDirty) return;
    event.preventDefault();
    this.confirmClose();
  }

  async confirmClose() {
    const choice = await this.ask({
      type: 'question',
      message: `Do you want to save the changes you made to ${this.name}?`,
      detail: "Your changes will be lost if you don't save them.",
      buttons: ['Save', "Don't save", 'Cancel'],
      defaultId: 0,
      cancelId: 2,
    });
    if (choice === 2 || choice === null) return;
    if (choice === 0 && !(await this.save())) return;
    this.closeConfirmed = true;
    this.win.close();
  }

  dispose() {
    this.watcher.close();
    this.rejectPending(new Error('The document was closed.'));
    this.registry.remove(this);
    if (!this.view.webContents.isDestroyed()) this.view.webContents.close();
    this.session.protocol.unhandle('ev-doc');
    this.session.clearStorageData().catch(() => {});
  }

  // ---------- Dialogs ----------

  // One dialog at a time per document. Returns the button index, or null if
  // another dialog was already open.
  async ask(options) {
    if (this.prompting || this.win.isDestroyed()) return null;
    this.prompting = true;
    try {
      const { response } = await dialog.showMessageBox(this.win, options);
      return response;
    } finally {
      this.prompting = false;
    }
  }

  async showReport(errors, intro) {
    const report = formatReport(this.filePath, errors);
    const choice = await this.ask({ type: 'warning', message: intro, detail: report, buttons: ['Copy report', 'OK'], defaultId: 1 });
    if (choice === 0) clipboard.writeText(report);
  }
}

module.exports = { DocumentWindow };
