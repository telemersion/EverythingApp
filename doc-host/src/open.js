'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { isDocument, checkDocument, formatReport } = require('./conformance');

const MAX_FILE_BYTES = 60 * 1024 * 1024;

// Reads a file the user wants to open and says what it is. Never throws.
//   { kind: 'document', filePath, check }      conforming; check.text and check.parts feed the Document
//   { kind: 'not-document', filePath }          no <meta name="ev-host-api">
//   { kind: 'refused', filePath, report, codes }  a document that does not conform (codes: its problems' codes)
//   { kind: 'error', filePath: rawPath, message, code }   could not be read (code: err.code, e.g. 'ENOENT')
// filePath is the real path: documents are compared by it (registry.byPath).
async function readDocumentFile(rawPath) {
  let filePath;
  let bytes;
  try {
    // realpath returns the case stored on disk on macOS (APFS, verified
    // 2026-10-07), so one file opened under two spellings is found by
    // byPath; Windows is checked by hand in Task 14.
    filePath = await fs.realpath(path.resolve(rawPath));
    const stat = await fs.stat(filePath);
    if (!stat.isFile()) throw new Error('This is not a file.');
    if (stat.size > MAX_FILE_BYTES) throw new Error('The file is larger than 60 MB.');
    bytes = await fs.readFile(filePath);
  } catch (err) {
    return { kind: 'error', filePath: rawPath, message: err.message, code: err.code };
  }
  if (!isDocument(bytes)) return { kind: 'not-document', filePath };
  const check = checkDocument(bytes);
  if (!check.ok) {
    return { kind: 'refused', filePath, report: formatReport(filePath, check.errors), codes: check.errors.map((e) => e.code) };
  }
  return { kind: 'document', filePath, check };
}

module.exports = { readDocumentFile };
