'use strict';

// Open documents, findable by web contents (IPC sender), window and path.
class Registry {
  constructor() {
    this.documents = new Set();
  }

  add(doc) {
    this.documents.add(doc);
  }

  remove(doc) {
    this.documents.delete(doc);
  }

  bySender(webContentsId) {
    for (const doc of this.documents) if (doc.webContentsId === webContentsId) return doc;
    return null;
  }

  byWindow(win) {
    for (const doc of this.documents) if (doc.win === win) return doc;
    return null;
  }

  byPath(filePath) {
    for (const doc of this.documents) if (doc.filePath === filePath) return doc;
    return null;
  }
}

module.exports = { Registry };
