'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { WebContentsView, session, clipboard } = require('electron');
const { checkDocument, formatReport } = require('./conformance');
const { validateSnapshot } = require('./validate');
const { writeDocument, sha256 } = require('./write');
const { sectionHashes, classifyChange, watchFile } = require('./watch');
const { serveDocument } = require('./protocol');
const { hardenSession, hardenContents, WEB_PREFERENCES } = require('./security');
const { SCHEME, originFor } = require('./urls');
const { errorBox, formatErrorReport } = require('./errors');
const { emptyStatus, describeStatus } = require('./status');
const { LoadTags } = require('./load-tags');

const SAVE_TIMEOUT_MS = 5000;
const UPDATED_FROM_DISK_MS = 4000;

// One open document: its sandboxed view, its file on disk, its status. It
// knows nothing about windows: whoever shows it passes ui, and it asks the
// user only through ui.sheet() when the user just did something. Things that
// happen to the document in the background only change its status.
// The main process owns the path; the document only ever sends data.
//
// ui = {
//   sheet(options) → Promise<number | null>  // a message box; null if none could be shown
//   update()                                  // status (or the dirty marker) changed
//   rendered(reason)                          // 'load' | 'save' | 'reload'
// }
class Document {
  constructor({ id, filePath, html, parts, storeDir, ui, allowDevTools = false }) {
    this.id = id;                           // also the origin id of its ev-doc:// origin
    this.filePath = filePath;
    this.name = path.basename(filePath);
    this.storeDir = storeDir;
    this.ui = ui;
    this.status = emptyStatus();

    this.html = html;                       // what the protocol handler serves
    this.known = sectionHashes(parts);      // what we believe is on disk
    this.running = this.known.outsideData;  // everything outside the data, as running in the view
    this.knownFileHash = sha256(html);

    this.latestChange = 0;                  // highest markDirty() counter seen
    this.savedChange = 0;                   // counter covered by the last write
    this.disposed = false;
    this.saving = null;                     // the running save
    this.nextSave = null;                   // the one save queued behind it
    this.nextKeepMine = false;              // that queued save keeps mine
    this.generation = 0;                    // counts reloads of the page
    this.writes = 0;                        // counts our own writes
    this.pending = new Map();
    this.requestSeq = 0;
    this.tags = new LoadTags();
    this.fromDiskTimer = null;              // ends "Updated from disk"

    this.origin = originFor(id);
    this.session = session.fromPartition(`ev-doc-${id}`); // no "persist:" = in memory
    const hardened = hardenSession(this.session, this.origin, {
      allowDevTools,
      documentWebContentsId: () => this.webContentsId,
    });
    serveDocument(this.session, this.origin, () => this.html);

    this.view = new WebContentsView({
      webPreferences: { ...WEB_PREFERENCES, session: this.session, preload: path.join(__dirname, 'preload.js') },
    });
    this.webContentsId = this.view.webContents.id;
    hardenContents(this.view.webContents);

    this.watcher = watchFile(filePath, () => this.onDiskChange()
      .catch((err) => this.reportWatchError(err)));
    // Resolves once the document has started loading (after the proxy is set).
    // If the session cannot be locked down, the document is disposed before
    // the caller reports the error: never a view without its proxy.
    this.ready = hardened.then(() => {
      if (this.view.webContents.isDestroyed()) return;
      this.view.webContents.loadURL(`${this.origin}/`)
        .then(() => this.ui.rendered('load'), (err) => this.reportError('load', err));
    }, (err) => {
      this.dispose();
      throw err;
    });
  }

  get isDirty() {
    return this.latestChange > this.savedChange;
  }

  // ---------- Status ----------

  // The banner of every kind whose condition holds, dismissed or not.
  holdingBanners() {
    return describeStatus({ ...this.status, dismissed: [] }, { name: this.name, filePath: this.filePath }).banners;
  }

  // Changes status fields; status.dirty always follows isDirty. A kind whose
  // condition no longer holds leaves the dismissed list, so it shows again
  // when it comes back. Tells the UI if anything changed.
  setStatus(changes = {}) {
    let changed = false;
    for (const [key, value] of Object.entries({ ...changes, dirty: this.isDirty })) {
      if (this.status[key] === value) continue;
      this.status[key] = value;
      changed = true;
    }
    const holding = new Set(this.holdingBanners().map((banner) => banner.kind));
    const dismissed = this.status.dismissed.filter((kind) => holding.has(kind));
    if (dismissed.length !== this.status.dismissed.length) {
      this.status.dismissed = dismissed;
      changed = true;
    }
    if (changed && !this.disposed) this.ui.update();
  }

  // A clean automatic reload: "Updated from disk" for a few seconds. Another
  // one in that time starts the time again.
  showUpdatedFromDisk() {
    clearTimeout(this.fromDiskTimer);
    this.setStatus({ updatedFromDisk: true });
    this.fromDiskTimer = setTimeout(() => {
      this.fromDiskTimer = null;
      this.setStatus({ updatedFromDisk: false });
    }, UPDATED_FROM_DISK_MS);
  }

  // ---------- IPC from the preload ----------

  onHello(loadId) {
    this.tags.hello(loadId);
  }

  onDirty(payload) {
    if (!payload || typeof payload !== 'object' || !this.tags.accepts(payload.loadId)) return;
    const { counter } = payload;
    if (!Number.isSafeInteger(counter) || counter <= this.latestChange) return;
    this.latestChange = counter;
    this.setStatus();
  }

  onSaveData(payload) {
    if (!payload || typeof payload !== 'object' || !this.tags.accepts(payload.loadId)) return;
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

  // Files the user dropped on the page: absolute paths, and only from the
  // current page load. The workspace opens them.
  droppedPaths(payload) {
    if (!payload || typeof payload !== 'object' || !this.tags.accepts(payload.loadId)
      || !Array.isArray(payload.paths)) return [];
    return payload.paths.filter((p) => typeof p === 'string' && path.isAbsolute(p));
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
  // follow-up (which keeps mine if any of them asked to). If the running
  // save fails, the follow-up is skipped (false).
  save({ keepMine = false } = {}) {
    if (!this.saving) {
      const run = this.doSave({ keepMine }).finally(() => {
        if (this.saving === run) this.saving = null;
      });
      this.saving = run;
      return run;
    }
    this.nextKeepMine = this.nextKeepMine || keepMine;
    if (!this.nextSave) {
      this.nextSave = this.saving.catch(() => false).then((ok) => {
        this.nextSave = null;
        const keep = this.nextKeepMine;
        this.nextKeepMine = false;
        return ok ? this.save({ keepMine: keep }) : false;
      });
    }
    return this.nextSave;
  }

  // Resolves once no save is running or queued.
  async settle() {
    while (this.saving || this.nextSave) await (this.nextSave || this.saving).catch(() => {});
  }

  async doSave({ keepMine = false } = {}) {
    // A reload while this save runs replaces the page and its counters;
    // then this save's results no longer apply to them.
    const generation = this.generation;
    // Keep mine (banner): our data replaces the data on disk as it is now,
    // without asking again. A change after this point is caught at write time.
    if (keepMine) {
      await this.refreshKnown();
      this.setStatus({ dataConflict: false });
    }
    for (;;) {
      if (this.status.dataConflict) {
        const choice = await this.ui.sheet({
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
          this.setStatus({ dataConflict: true });
          continue;
        }
        if (err.code === 'ENOENT' && await this.isMissing()) {
          this.setStatus({ missing: true });
          await this.reportMissing();
          return false;
        }
        await this.ui.sheet({
          type: 'error',
          message: `${this.name} could not be saved. The file on disk was not changed.`,
          detail: err.message,
          buttons: ['OK'],
        });
        return false;
      }
      this.ui.rendered('save');
      // Defensive: a reload during a write is not reachable today
      // (reloadFromDisk awaits saves; onDiskChange skips while saving). Were
      // it to happen, the write above would have used the old known.data as
      // expectedDataHash and raised EV_DATA_CONFLICT rather than overwrite;
      // if it succeeded anyway, the page's counters and known state are the
      // reload's, not ours.
      if (generation !== this.generation) return true;
      this.acceptOnDisk(written);
      this.savedChange = Math.max(this.savedChange, snapshot.changes);
      // The write read the file and found it conforming.
      this.setStatus({ dataConflict: false, missing: false, nonConforming: null, checkError: null });
      // Saving spliced our data into newer outside data from disk: show it.
      // The save itself succeeded, whatever happens to this reload.
      if (this.known.outsideData !== this.running && !this.isDirty) {
        await this.loadFromDisk().catch((err) => this.reportError('reload', err));
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
      this.setStatus({ missing: false, nonConforming: null, checkError: null });
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
  // ifClean (the automatic reload): a document that is dirty by then keeps
  // its page, and the result is false.
  async reloadFromDisk({ ifClean = false } = {}) {
    await this.settle();
    if (ifClean && this.isDirty) return false;
    return this.loadFromDisk({ ifClean });
  }

  // Only for callers that hold the save turn (doSave) or have settled.
  async loadFromDisk({ ifClean = false } = {}) {
    let bytes;
    try {
      bytes = await fs.readFile(this.filePath);
    } catch (err) {
      if (err.code === 'ENOENT') this.setStatus({ missing: true });
      // The automatic reload runs in the background: no sheet.
      if (ifClean) {
        if (err.code !== 'ENOENT') this.reportWatchError(err);
        return false;
      }
      await this.ui.sheet({ type: 'error', message: `${this.name} could not be read.`, detail: err.message, buttons: ['OK'] });
      return false;
    }
    const check = checkDocument(bytes);
    this.setStatus({
      missing: false,
      checkError: null,
      nonConforming: check.ok ? null : formatReport(this.filePath, check.errors, { context: 'open-document' }),
    });
    if (!check.ok) return false;
    // An edit that landed while the file was read keeps the page.
    if (ifClean && this.isDirty) return false;
    this.generation++;
    this.html = check.text;
    this.acceptOnDisk(check.text);
    this.running = this.known.outsideData;
    this.latestChange = 0;
    this.savedChange = 0;
    this.rejectPending(new Error('The document was reloaded.'));
    this.setStatus({ updatedWhileDirty: false, dataConflict: false });
    this.tags.begin();
    await this.view.webContents.loadURL(`${this.origin}/`);
    this.ui.rendered('reload');
    return true;
  }

  // View → Reload
  async reloadInteractive() {
    await this.settle();
    if (this.isDirty) {
      const choice = await this.ui.sheet({
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
    if (this.disposed) return;
    const { generation, writes } = this;
    let bytes;
    try {
      bytes = await fs.readFile(this.filePath);
    } catch (err) {
      if (err.code !== 'ENOENT') throw err;
      this.setStatus({ missing: true });
      return;
    }
    this.setStatus({ missing: false, checkError: null });
    // A save or reload ran while we read: it took care of the disk state, and
    // its own write triggers another check. known must only come from it.
    if (this.saving || this.writes !== writes || this.generation !== generation) return;
    // sha256 of the bytes equals sha256 of the text for UTF-8 files.
    // Unchanged bytes also leave nonConforming as it is.
    const fileHash = sha256(bytes);
    if (fileHash === this.knownFileHash) return;
    this.knownFileHash = fileHash;

    const check = checkDocument(bytes);
    if (!check.ok) {
      this.setStatus({ nonConforming: formatReport(this.filePath, check.errors, { context: 'open-document' }) });
      return;
    }
    this.setStatus({ nonConforming: null });
    const onDisk = sectionHashes(check.parts);
    const change = classifyChange(this.known, onDisk);
    if (!change.outsideData && !change.data) return;
    this.known = onDisk;

    if (!this.isDirty) {
      if (await this.reloadFromDisk({ ifClean: true })) {
        this.showUpdatedFromDisk();
        return;
      }
      // An edit landed during the reload: the page stays, and the change
      // counts as one that arrived while dirty.
      if (!this.isDirty) return;
    }
    if (change.data) {
      this.setStatus({ dataConflict: true }); // resolved in its banner or by the conflict prompt on the next save
      return;
    }
    this.setStatus({ updatedWhileDirty: true });
  }

  async isMissing() {
    try {
      await fs.access(this.filePath);
      return false;
    } catch (err) {
      return err.code === 'ENOENT';
    }
  }

  // Every failed save shows this; the watcher only sets status.missing.
  async reportMissing() {
    await this.ui.sheet({
      type: 'warning',
      message: `${this.name} was moved or deleted.`,
      detail: `Your changes exist only in this window. Put the file back at ${this.filePath} and save again. ` +
        'The last saved version is in the version store.',
      buttons: ['OK'],
    });
  }

  // An unexpected error after the user did something (the page failed to
  // load, or to reload after a save): the error report as a sheet. Nothing
  // once the document is closed (closing aborts a load). Never rejects.
  async reportError(action, err) {
    if (this.disposed) return;
    const { report, options } = errorBox({ action, filePath: this.filePath, err });
    try {
      if (await this.ui.sheet(options) === 0) clipboard.writeText(report);
    } catch (sheetErr) {
      console.error(report, sheetErr);
    }
  }

  // Errors while checking the disk: the status keeps the newest report
  // until the file can be read again.
  reportWatchError(err) {
    this.setStatus({ checkError: formatErrorReport({ action: 'check for changes to', filePath: this.filePath, err }) });
  }

  // ---------- Closing ----------

  // The close prompt. 'cancel' also when the save fails or an edit came
  // after the snapshot; the dirty marker shows why.
  async promptSave() {
    const choice = await this.ui.sheet({
      type: 'question',
      message: `Do you want to save the changes you made to ${this.name}?`,
      detail: "Your changes will be lost if you don't save them.",
      buttons: ['Save', "Don't save", 'Cancel'],
      defaultId: 0,
      cancelId: 2,
    });
    if (choice === 1) return 'discard';
    if (choice !== 0) return 'cancel';
    if (!(await this.save()) || this.isDirty) return 'cancel';
    return 'saved';
  }

  // Waits for running saves; true if the document may close.
  async confirmClose() {
    await this.settle();
    if (!this.isDirty) return true;
    return (await this.promptSave()) !== 'cancel';
  }

  // ---------- Banners ----------

  // action is an action id of the kind's banner, or 'dismiss'. Only kinds
  // that hold, and only actions their banner offers: a click on a banner
  // that has just gone does nothing.
  async onBannerAction(kind, action) {
    const banner = this.holdingBanners().find((b) => b.kind === kind);
    if (!banner) return;
    if (action === 'dismiss') {
      if (banner.dismissLabel !== null && !this.status.dismissed.includes(kind)) {
        this.setStatus({ dismissed: [...this.status.dismissed, kind] });
      }
      return;
    }
    if (!banner.actions.some((a) => a.id === action)) return;
    switch (action) {
      case 'copy-report':
        clipboard.writeText(kind === 'non-conforming' ? this.status.nonConforming : this.status.checkError);
        return;
      case 'keep-mine':
        await this.save({ keepMine: true });
        return;
      case 'take-disk':
      case 'discard-reload':
        await this.reloadFromDisk();
        return;
      case 'save-reload':
        await this.save(); // reloads newer outside data once clean
        return;
      default:
        // update-kit, undo-kit: Task 13
    }
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.watcher.close();
    clearTimeout(this.fromDiskTimer);
    this.rejectPending(new Error('The document was closed.'));
    if (!this.view.webContents.isDestroyed()) this.view.webContents.close();
    this.session.protocol.unhandle(SCHEME);
    this.session.clearStorageData().catch(() => {});
  }
}

module.exports = { Document };
