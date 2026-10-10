'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { checkDocument } = require('./conformance');
const { sha256 } = require('./hash');
const { splice, replaceKit, setDocId } = require('./splice');
const { sectionHashes } = require('./watch');

const KEEP_LATEST = 20;
const KEEP_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

// One folder per document in the version store, keyed by its absolute path.
function pathKey(filePath) {
  return sha256(path.resolve(filePath)).slice(0, 32);
}

// Version files are named by their UTC timestamp, so names sort by time.
function versionFileName(now) {
  return now.toISOString().replace(/[:.]/g, '-') + '.html';
}

// Keeps the newest KEEP_LATEST versions plus the newest version of each of
// the last KEEP_DAYS days. Returns the names to delete.
function selectVersionsToDelete(names, now, { keepLatest = KEEP_LATEST, keepDays = KEEP_DAYS } = {}) {
  const sorted = names.filter((n) => n.endsWith('.html')).sort();
  const keep = new Set(sorted.slice(-keepLatest));
  const newestPerDay = new Map();
  for (const name of sorted) newestPerDay.set(name.slice(0, 10), name);
  const firstDay = new Date(now.getTime() - (keepDays - 1) * DAY_MS).toISOString().slice(0, 10);
  for (const [day, name] of newestPerDay) if (day >= firstDay) keep.add(name);
  return sorted.filter((n) => !keep.has(n));
}

// Keeps content in the version store, unless it equals the newest stored
// version (saving an unchanged file twice keeps one copy). Returns the path
// of the version that holds the content. docId: the id of the document as
// written (the stored version may still have none), or null.
async function storeVersion({ storeDir, filePath, content, parts, now, docId = parts.docId || null }) {
  const dir = path.join(storeDir, pathKey(filePath));
  await fs.mkdir(dir, { recursive: true });
  const stored = (await fs.readdir(dir)).filter((n) => n.endsWith('.html')).sort();
  const newest = stored[stored.length - 1];
  let name;
  if (newest && sha256(await fs.readFile(path.join(dir, newest))) === sha256(content)) {
    name = newest;
  } else {
    name = versionFileName(now);
    for (let n = 1; await exists(path.join(dir, name)); n++) {
      name = versionFileName(now).replace('.html', `-${n}.html`);
    }
    await fs.writeFile(path.join(dir, name), content, 'utf8');
  }
  const meta = {
    path: path.resolve(filePath),
    fileName: path.basename(filePath),
    docType: parts.docType,
    docId,
    dataHash: sha256(parts.data),
    lastSeen: now.toISOString(),
  };
  await fs.writeFile(path.join(dir, 'meta.json'), JSON.stringify(meta, null, 2) + '\n', 'utf8');
  for (const old of selectVersionsToDelete(await fs.readdir(dir), now)) {
    await fs.unlink(path.join(dir, old));
  }
  return path.join(dir, name);
}

async function exists(p) {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

// Writes new data into a document on disk:
// 1. read the current file and check that it still conforms (and, with
//    expectedDataHash, that its data is still the data we last saw) and
//    that it is writable,
// 2. splice the data into it (unless json is null) and replace its kit
//    (when a kit is given); at least one of the two is required; with
//    docId, fill in the document id if the file has none yet,
// 3. write <name>.tmp next to it with the same permissions and flush it,
// 4. keep the current file in the version store,
// 5. rename <name>.tmp over the original.
// Any error leaves the original untouched. Returns the new file content.
async function writeDocument(filePath, json, { storeDir, now = new Date(), expectedDataHash, kit, docId }) {
  if (json === null && !kit) throw new TypeError('Nothing to write.');
  const check = checkDocument(await fs.readFile(filePath));
  if (!check.ok) {
    throw new Error('The file on disk no longer follows the document specification, so it was not changed: ' +
      check.errors.map((e) => e.message).join(' '));
  }
  if (expectedDataHash !== undefined && sectionHashes(check.parts).data !== expectedDataHash) {
    const err = new Error('The data on disk was changed by someone else since it was last read.');
    err.code = 'EV_DATA_CONFLICT';
    throw err;
  }
  // The rename would replace a read-only file all the same: refuse it here.
  const { mode } = await fs.stat(filePath);
  try {
    await fs.access(filePath, fs.constants.W_OK);
  } catch (err) {
    if (err.code === 'ENOENT') throw err;
    throw new Error('The file is read-only.');
  }
  const current = check.text;
  let next = json === null ? current : splice(current, json);
  if (kit) next = replaceKit(next, kit);
  if (docId && !check.parts.docId) next = setDocId(next, docId);

  const tmp = `${filePath}.tmp`;
  try {
    const handle = await fs.open(tmp, 'w');
    try {
      await handle.writeFile(next, 'utf8');
      await handle.sync();
      await handle.chmod(mode & 0o7777);
    } finally {
      await handle.close();
    }
    await storeVersion({ storeDir, filePath, content: current, parts: check.parts, now,
      docId: check.parts.docId || docId || null });
    await fs.rename(tmp, filePath);
  } catch (err) {
    await fs.rm(tmp, { force: true });
    throw err;
  }
  return next;
}

module.exports = { pathKey, selectVersionsToDelete, storeVersion, writeDocument, sha256 };
