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
const { SCHEME, originFor } = require('./urls');
const { showError } = require('./errors');

const SAVE_TIMEOUT_MS = 5000;

// One open document: its window, its sandboxed view, its file on disk.
// The main process owns the path; the document only ever sends data.
class DocumentWindow {
  constructor({ filePath, html, parts, storeDir, registry, allowDevTools = false }) {
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
    this.missingReported = false;           // "moved or deleted" shown for this disappearance
    this.watchErrorShown = null;            // key of the disk-check error last shown
    this.disposed = false;
    this.saving = null;                     // the running save
    this.nextSave = null;                   // the one save queued behind it
    this.generation = 0;                    // counts reloads of the page
    this.writes = 0;                        // counts our own writes
    this.prompting = false;
    this.closeConfirmed = false;
    this.pending = new Map();
    this.requestSeq = 0;

    const id = crypto.randomBytes(16).toString('hex');
    this.origin = originFor(id);
    this.session = session.fromPartition(`ev-doc-${id}`); // no "persist:" = in memory
    const hardened = hardenSession(this.session, this.origin, {
      allowDevTools,
      documentWebContentsId: () => this.webContentsId,
    });
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
    this.watcher = watchFile(filePath, () => this.onDiskChange()
      .catch((err) => this.reportWatchError(err)));
    if (process.platform === 'darwin') this.win.setRepresentedFilename(filePath);

    registry.add(this);
    this.updateTitle();
    // Resolves once the document has started loading (after the proxy is set).
    // If the session cannot be locked down, the window goes away before the
    // caller reports the error: never a window without its proxy.
    this.ready = hardened.then(() => {
      if (this.view.webContents.isDestroyed()) return;
      this.view.webContents.loadURL(`${this.origin}/`)
        .catch((err) => showError({ action: 'load', filePath, err }));
    }, (err) => {
      this.dispose();
      if (!this.win.isDestroyed()) this.win.destroy();
      throw err;
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

  // One save at a time. A save requested while one runs waits for it, then
  // saves again with a fresh snapshot; all waiting requests share that one
  // follow-up. If the running save fails, the follow-up is skipped (false).
  save() {
    if (!this.saving) {
      const run = this.doSave().finally(() => {
        if (this.saving === run) this.saving = null;
      });
      this.saving = run;
      return run;
    }
    if (!this.nextSave) {
      this.nextSave = this.saving.catch(() => false).then((ok) => {
        this.nextSave = null;
        return ok ? this.save() : false;
      });
    }
    return this.nextSave;
  }

  // Resolves once no save is running or queued.
  async settle() {
    while (this.saving || this.nextSave) await (this.nextSave || this.saving).catch(() => {});
  }

  async doSave() {
    // A reload while this save runs replaces the page and its counters;
    // then this save's results no longer apply to them.
    const generation = this.generation;
    for (;;) {
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
        if (choice === 1) return this.loadFromDisk();
      }
      let snapshot;
      let written;
      try {
        snapshot = await this.requestSnapshot();
        const problem = validateSnapshot(snapshot.json);
        if (problem) throw new Error(problem);
        // Refused if the data on disk is not the data we last saw (known).
        written = await writeDocument(this.filePath, snapshot.json,
          { storeDir: this.storeDir, expectedDataHash: this.known.data });
        this.writes++;
      } catch (err) {
        if (generation !== this.generation) return false;
        // Someone changed the data just before the write: ask, as if the
        // watcher had reported it.
        if (err.code === 'EV_DATA_CONFLICT' && await this.refreshKnown()) {
          this.diskDataChanged = true;
          continue;
        }
        if (err.code === 'ENOENT' && await this.isMissing()) {
          await this.reportMissing();
          return false;
        }
        await this.ask({
          type: 'error',
          message: `${this.name} could not be saved. The file on disk was not changed.`,
          detail: err.message,
          buttons: ['OK'],
        });
        return false;
      }
      // Defensive: a reload during a write is not reachable today
      // (reloadFromDisk awaits saves; onDiskChange skips while saving). Were
      // it to happen, the write above would have used the old known.data as
      // expectedDataHash and raised EV_DATA_CONFLICT rather than overwrite;
      // if it succeeded anyway, the page's counters and known state are the
      // reload's, not ours.
      if (generation !== this.generation) return true;
      this.acceptOnDisk(written);
      this.diskDataChanged = false;
      this.missingReported = false;
      this.savedChange = Math.max(this.savedChange, snapshot.changes);
      this.updateTitle();
      // Saving spliced our data into newer behaviour from disk: show it.
      // The save itself succeeded, whatever happens to this reload.
      if (this.known.behaviour !== this.running && !this.isDirty) {
        await this.loadFromDisk().catch((err) => showError({ action: 'reload', filePath: this.filePath, err }));
      }
      return true;
    }
  }

  // Re-reads what is on disk into known/knownFileHash. False if the file
  // cannot be read or no longer conforms.
  async refreshKnown() {
    try {
      const check = checkDocument(await fs.readFile(this.filePath));
      if (!check.ok) return false;
      this.acceptOnDisk(check.text);
      return true;
    } catch {
      return false;
    }
  }

  acceptOnDisk(html) {
    const check = checkDocument(html);
    this.known = sectionHashes(check.parts);
    this.knownFileHash = sha256(html);
  }

  // Waits for running saves, then replaces the page with the file on disk.
  async reloadFromDisk() {
    await this.settle();
    return this.loadFromDisk();
  }

  // Only for callers that hold the save turn (doSave) or have settled.
  async loadFromDisk() {
    let bytes;
    try {
      bytes = await fs.readFile(this.filePath);
    } catch (err) {
      await this.ask({ type: 'error', message: `${this.name} could not be read.`, detail: err.message, buttons: ['OK'] });
      return false;
    }
    const check = checkDocument(bytes);
    if (!check.ok) {
      await this.showReport(check.errors, 'The file on disk no longer follows the document specification. The open version keeps running; saving is refused until the file is fixed.');
      return false;
    }
    this.generation++;
    this.html = check.text;
    this.acceptOnDisk(check.text);
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
    await this.settle();
    if (this.isDirty) {
      const choice = await this.ask({
        type: 'question',
        message: `Do you want to save the changes you made to ${this.name} before reloading?`,
        buttons: ['Save and reload', 'Discard and reload', 'Cancel'],
        defaultId: 0,
        cancelId: 2,
      });
      if (choice === null || choice === 2) return;
      // As when closing: an edit after the snapshot (or a failed save) keeps
      // the page; the dirty marker shows why.
      if (choice === 0 && (!(await this.save()) || this.isDirty)) return;
    }
    await this.reloadFromDisk();
  }

  // ---------- External changes ----------

  async onDiskChange() {
    await this.settle();
    if (this.win.isDestroyed()) return;
    const { generation, writes } = this;
    let bytes;
    try {
      bytes = await fs.readFile(this.filePath);
    } catch (err) {
      if (err.code !== 'ENOENT') throw err;
      if (!this.missingReported) await this.reportMissing();
      return;
    }
    this.missingReported = false;
    this.watchErrorShown = null;
    // A save or reload ran while we read: it took care of the disk state, and
    // its own write triggers another check. known must only come from it.
    if (this.saving || this.writes !== writes || this.generation !== generation) return;
    // sha256 of the bytes equals sha256 of the text for UTF-8 files.
    const fileHash = sha256(bytes);
    if (fileHash === this.knownFileHash) return;
    this.knownFileHash = fileHash;

    const check = checkDocument(bytes);
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

  async isMissing() {
    try {
      await fs.access(this.filePath);
      return false;
    } catch (err) {
      return err.code === 'ENOENT';
    }
  }

  // Every failed save shows this; the watcher shows it once per disappearance
  // (counted only if it was shown, not skipped for another open dialog).
  async reportMissing() {
    const choice = await this.ask({
      type: 'warning',
      message: `${this.name} was moved or deleted.`,
      detail: `Your changes exist only in this window. Put the file back at ${this.filePath} and save again. ` +
        'The last saved version is in the version store.',
      buttons: ['OK'],
    });
    if (choice !== null) this.missingReported = true;
  }

  // Errors while checking the disk: the same error is shown once, until the
  // file can be read again.
  reportWatchError(err) {
    const key = (err && (err.code || err.message)) || String(err);
    if (this.watchErrorShown === key) return;
    this.watchErrorShown = key;
    showError({ action: 'check for changes to', filePath: this.filePath, err });
  }

  // ---------- Closing ----------

  onClose(event) {
    if (this.closeConfirmed) return;
    if (!this.isDirty && !this.saving && !this.nextSave) return;
    event.preventDefault();
    this.confirmClose().catch((err) => showError({ action: 'close', filePath: this.filePath, err }));
  }

  // Waits for running saves; closes only if nothing is left unsaved.
  async confirmClose() {
    await this.settle();
    if (this.isDirty) {
      const choice = await this.ask({
        type: 'question',
        message: `Do you want to save the changes you made to ${this.name}?`,
        detail: "Your changes will be lost if you don't save them.",
        buttons: ['Save', "Don't save", 'Cancel'],
        defaultId: 0,
        cancelId: 2,
      });
      if (choice === 2 || choice === null) return;
      // An edit after the snapshot (or a failed save) keeps the window open;
      // the dirty marker shows why.
      if (choice === 0) {
        await this.save();
        if (this.isDirty) return;
      }
    }
    if (this.win.isDestroyed()) return;
    this.closeConfirmed = true;
    this.win.close();
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.watcher.close();
    this.rejectPending(new Error('The document was closed.'));
    this.registry.remove(this);
    if (!this.view.webContents.isDestroyed()) this.view.webContents.close();
    this.session.protocol.unhandle(SCHEME);
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
