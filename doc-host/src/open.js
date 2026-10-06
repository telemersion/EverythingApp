'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { dialog, clipboard } = require('electron');
const { isDocument, checkDocument, formatReport } = require('./conformance');
const { DocumentWindow } = require('./document-window');

const MAX_FILE_BYTES = 60 * 1024 * 1024;

// Opens a file in the host: refuses anything that is not a conforming
// document, focuses the window if the document is already open.
async function openPath(rawPath, { registry, storeDir }) {
  let filePath;
  let bytes;
  try {
    filePath = await fs.realpath(path.resolve(rawPath));
    const stat = await fs.stat(filePath);
    if (!stat.isFile()) throw new Error('This is not a file.');
    if (stat.size > MAX_FILE_BYTES) throw new Error('The file is larger than 60 MB.');
    bytes = await fs.readFile(filePath);
  } catch (err) {
    await dialog.showMessageBox({ type: 'error', message: `${path.basename(rawPath)} could not be opened.`, detail: err.message });
    return null;
  }

  const open = registry.byPath(filePath);
  if (open) {
    open.focus();
    return open;
  }

  if (!isDocument(bytes)) {
    await dialog.showMessageBox({
      type: 'info',
      message: `${path.basename(filePath)} is not an EverythingApp document.`,
      detail: 'EverythingApp opens HTML documents that contain <meta name="ev-host-api">.',
    });
    return null;
  }

  const check = checkDocument(bytes);
  if (!check.ok) {
    const report = formatReport(filePath, check.errors);
    const { response } = await dialog.showMessageBox({
      type: 'warning',
      message: `EverythingApp refused to open ${path.basename(filePath)}.`,
      detail: report,
      buttons: ['Copy report', 'OK'],
      defaultId: 1,
    });
    if (response === 0) clipboard.writeText(report);
    return null;
  }

  const doc = new DocumentWindow({ filePath, html: check.text, parts: check.parts, storeDir, registry });
  await doc.ready;
  return doc;
}

module.exports = { openPath };
