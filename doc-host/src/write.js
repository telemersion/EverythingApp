'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { checkDocument } = require('./conformance');
const { sha256 } = require('./hash');
const { splice } = require('./splice');

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

async function storeVersion({ storeDir, filePath, content, parts, now }) {
  const dir = path.join(storeDir, pathKey(filePath));
  await fs.mkdir(dir, { recursive: true });
  let name = versionFileName(now);
  for (let n = 1; await exists(path.join(dir, name)); n++) {
    name = versionFileName(now).replace('.html', `-${n}.html`);
  }
  await fs.writeFile(path.join(dir, name), content, 'utf8');
  const meta = {
    path: path.resolve(filePath),
    fileName: path.basename(filePath),
    docType: parts.docType,
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
// 1. read the current file and check that it still conforms,
// 2. splice the data into it,
// 3. keep the current file in the version store,
// 4. write <name>.tmp next to it, flush, and rename it over the original.
// Any error leaves the original untouched. Returns the new file content.
async function writeDocument(filePath, json, { storeDir, now = new Date() }) {
  const current = await fs.readFile(filePath, 'utf8');
  const check = checkDocument(current);
  if (!check.ok) {
    throw new Error('The file on disk no longer follows the document specification, so it was not changed: ' +
      check.errors.map((e) => e.message).join(' '));
  }
  const next = splice(current, json);
  await storeVersion({ storeDir, filePath, content: current, parts: check.parts, now });

  const tmp = `${filePath}.tmp`;
  try {
    const handle = await fs.open(tmp, 'w');
    try {
      await handle.writeFile(next, 'utf8');
      await handle.sync();
    } finally {
      await handle.close();
    }
    await fs.rename(tmp, filePath);
  } catch (err) {
    await fs.rm(tmp, { force: true });
    throw err;
  }
  return next;
}

module.exports = { pathKey, selectVersionsToDelete, storeVersion, writeDocument, sha256 };
