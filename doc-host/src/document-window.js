'use strict';

const path = require('node:path');
const crypto = require('node:crypto');
const { BaseWindow, WebContentsView, session, dialog } = require('electron');
const { serveDocument } = require('./protocol');
const { hardenSession, hardenContents, WEB_PREFERENCES } = require('./security');
const { originFor } = require('./urls');

// One open document: its window, its sandboxed view, its file on disk.
// The main process owns the path; the document only ever sends data.
class DocumentWindow {
  constructor({ filePath, html, storeDir, registry }) {
    this.filePath = filePath;
    this.name = path.basename(filePath);
    this.storeDir = storeDir;
    this.registry = registry;
    this.html = html; // what the protocol handler serves
    this.prompting = false;

    const id = crypto.randomBytes(16).toString('hex');
    this.origin = originFor(id);
    this.session = session.fromPartition(`ev-doc-${id}`); // no "persist:" = in memory
    hardenSession(this.session, this.origin);
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

    this.win.on('closed', () => this.dispose());
    if (process.platform === 'darwin') this.win.setRepresentedFilename(filePath);

    registry.add(this);
    this.updateTitle();
    this.view.webContents.loadURL(`${this.origin}/`);
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
    this.win.setTitle(this.name);
  }

  // IPC from the preload; saving follows in the next task.
  onDirty() {}

  onSaveData() {}

  dispose() {
    this.registry.remove(this);
    if (!this.view.webContents.isDestroyed()) this.view.webContents.close();
    this.session.protocol.unhandle('ev-doc');
    this.session.clearStorageData().catch(() => {});
  }

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
}

module.exports = { DocumentWindow };
