'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');

// Version store clean-up, once per start (M3). Each entry is one folder,
// <storeDir>/<pathKey>/, with meta.json and version files named by UTC time
// (write.js). An entry whose file is gone from a mounted volume is orphaned;
// orphans go after ORPHAN_DAYS, and above CAP_BYTES the oldest orphans go
// first, then the oldest versions of live documents, never a newest version.
// Entries on a volume that is not mounted are left alone.

const DAY_MS = 24 * 60 * 60 * 1000;
const CAP_BYTES = 500 * 1024 * 1024;
const ORPHAN_DAYS = 90;

// The root whose presence tells whether a path's volume is mounted.
function volumeRoot(filePath, platform) {
  if (platform === 'win32') return path.win32.parse(filePath).root;
  if (platform === 'darwin') {
    const match = /^\/Volumes\/[^/]+/.exec(filePath);
    if (match) return match[0];
  }
  return '/';
}

const byName = (a, b) => (path.basename(a.file) < path.basename(b.file) ? -1 : 1);

// Pure. entries: [{ dir, meta, state: 'live'|'missing'|'unreachable',
// versions: [{ file, bytes }] }]. Returns the entry dirs to mark, unmark and
// remove, and the version files to remove.
function planCleanup(entries, { now, capBytes = CAP_BYTES, orphanDays = ORPHAN_DAYS }) {
  const plan = { mark: [], unmark: [], removeEntries: [], removeVersions: [] };
  const sinceOf = new Map();
  for (const e of entries) {
    if (e.state === 'missing') {
      if (!e.meta.orphanedSince) plan.mark.push(e.dir);
      sinceOf.set(e, e.meta.orphanedSince || now.toISOString());
    } else if (e.state === 'live' && e.meta.orphanedSince) {
      plan.unmark.push(e.dir);
    }
  }

  const removed = new Set();
  const cutoff = now.getTime() - orphanDays * DAY_MS;
  for (const [e, since] of sinceOf) {
    if (Date.parse(since) <= cutoff) removed.add(e);
  }

  const bytesOf = (versions) => versions.reduce((sum, v) => sum + v.bytes, 0);
  let total = entries.filter((e) => !removed.has(e)).reduce((sum, e) => sum + bytesOf(e.versions), 0);

  const orphans = [...sinceOf.keys()].filter((e) => !removed.has(e))
    .sort((a, b) => Date.parse(sinceOf.get(a)) - Date.parse(sinceOf.get(b)));
  for (const e of orphans) {
    if (total <= capBytes) break;
    removed.add(e);
    total -= bytesOf(e.versions);
  }

  if (total > capBytes) {
    const older = entries.filter((e) => e.state !== 'missing')
      .flatMap((e) => [...e.versions].sort(byName).slice(0, -1))
      .sort(byName);
    for (const v of older) {
      if (total <= capBytes) break;
      plan.removeVersions.push(v.file);
      total -= v.bytes;
    }
  }

  plan.removeEntries = entries.filter((e) => removed.has(e)).map((e) => e.dir);
  return plan;
}

const exists = (p) => fs.access(p).then(() => true, () => false);

async function readEntry(dir, { openPaths, platform }) {
  const meta = JSON.parse(await fs.readFile(path.join(dir, 'meta.json'), 'utf8'));
  if (!meta || typeof meta.path !== 'string') throw new Error('meta.json has no path');
  const versions = [];
  for (const name of (await fs.readdir(dir)).filter((n) => n.endsWith('.html')).sort()) {
    versions.push({ file: path.join(dir, name), bytes: (await fs.stat(path.join(dir, name))).size });
  }
  let state = 'live';
  if (!openPaths.has(meta.path) && !(await exists(meta.path))) {
    state = (await exists(volumeRoot(meta.path, platform))) ? 'missing' : 'unreachable';
  }
  return { dir, meta, state, versions };
}

async function updateMeta(dir, change) {
  const file = path.join(dir, 'meta.json');
  const meta = JSON.parse(await fs.readFile(file, 'utf8'));
  change(meta);
  await fs.writeFile(file, JSON.stringify(meta, null, 2) + '\n', 'utf8');
}

// Reads the store, applies planCleanup and logs one summary line. An entry
// whose meta.json cannot be read is left alone and logged. openPaths: the
// files of open documents, which are live even if their file is gone.
async function runCleanup({ storeDir, now = new Date(), openPaths = new Set(), platform = process.platform, log }) {
  let names;
  try {
    names = await fs.readdir(storeDir, { withFileTypes: true });
  } catch (err) {
    if (err.code === 'ENOENT') return { removedEntries: 0, removedVersions: 0 };
    throw err;
  }
  const entries = [];
  for (const d of names.filter((n) => n.isDirectory())) {
    const dir = path.join(storeDir, d.name);
    try {
      entries.push(await readEntry(dir, { openPaths, platform }));
    } catch (err) {
      await log.write(`clean-up: left ${d.name} alone`, err);
    }
  }
  const plan = planCleanup(entries, { now });
  const removing = new Set(plan.removeEntries);
  for (const dir of plan.mark.filter((d) => !removing.has(d))) {
    await updateMeta(dir, (meta) => { meta.orphanedSince = now.toISOString(); });
  }
  for (const dir of plan.unmark) {
    await updateMeta(dir, (meta) => { delete meta.orphanedSince; });
  }
  for (const dir of plan.removeEntries) await fs.rm(dir, { recursive: true, force: true });
  for (const file of plan.removeVersions) await fs.unlink(file);
  await log.write(`clean-up: ${entries.length} entries, ${plan.mark.length} newly orphaned, `
    + `${plan.removeEntries.length} removed, ${plan.removeVersions.length} old versions removed`);
  return { removedEntries: plan.removeEntries.length, removedVersions: plan.removeVersions.length };
}

module.exports = { volumeRoot, planCleanup, runCleanup, CAP_BYTES, ORPHAN_DAYS };
