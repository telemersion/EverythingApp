'use strict';

const crypto = require('node:crypto');
const { BaseWindow, dialog } = require('electron');
const { Document } = require('./document');
const { showError } = require('./errors');

// Until the workspace window (M2 Task 9): a document in a window of its own,
// as in M1. The window shows the document's view, its sheets one at a time,
// its title and dirty marker, and asks before closing it dirty.
class DocumentWindow extends Document {
  constructor({ filePath, html, parts, storeDir, registry, allowDevTools = false }) {
    super({
      id: crypto.randomBytes(16).toString('hex'),
      filePath,
      html,
      parts,
      storeDir,
      allowDevTools,
      ui: {
        sheet: (options) => this.sheet(options),
        update: () => this.updateTitle(),
        rendered: () => {},
      },
    });
    this.registry = registry;
    this.prompting = false;
    this.closeConfirmed = false;

    this.win = new BaseWindow({ width: 1100, height: 800, title: this.name });
    this.win.contentView.addChildView(this.view);
    this.layout();
    this.win.on('resize', () => this.layout());
    this.win.on('close', (event) => this.onClose(event));
    this.win.on('closed', () => this.dispose());
    if (process.platform === 'darwin') this.win.setRepresentedFilename(filePath);

    registry.add(this);
    this.updateTitle();
    // If the session cannot be locked down, the window goes away before the
    // caller reports the error: never a window without its proxy.
    this.ready = this.ready.catch((err) => {
      if (!this.win.isDestroyed()) this.win.destroy();
      throw err;
    });
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

  // One sheet at a time per document. Returns the button index, or null if
  // another sheet was already open.
  async sheet(options) {
    if (this.prompting || this.win.isDestroyed()) return null;
    this.prompting = true;
    try {
      const { response } = await dialog.showMessageBox(this.win, options);
      return response;
    } finally {
      this.prompting = false;
    }
  }

  // Closes only if nothing is left unsaved (confirmClose waits for saves).
  onClose(event) {
    if (this.closeConfirmed) return;
    if (!this.isDirty && !this.saving && !this.nextSave) return;
    event.preventDefault();
    this.confirmClose().then((ok) => {
      if (!ok || this.win.isDestroyed()) return;
      this.closeConfirmed = true;
      this.win.close();
    }).catch((err) => showError({ action: 'close', filePath: this.filePath, err }));
  }

  dispose() {
    super.dispose();
    this.registry.remove(this);
  }
}

module.exports = { DocumentWindow };
