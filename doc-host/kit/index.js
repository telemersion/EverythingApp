'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { sha256 } = require('../src/hash');

// Published kits never change. published.json pins each kit file's hash;
// loading fails loudly if a published kit file was edited.
// The kit section of a document is a newline followed by the kit file.
function kitSectionText(file, dir = __dirname) {
  return '\n' + fs.readFileSync(path.join(dir, file), 'utf8');
}

// A registry of kits from a list like published.json, files read from dir
// (or from entry.dir).
function createKitRegistry(list, dir) {
  const KITS = list.map((entry) => {
    const text = kitSectionText(entry.file, entry.dir || dir);
    const hash = sha256(text);
    if (hash !== entry.sha256) {
      throw new Error(`Published kit ${entry.version} was modified (${entry.file}). Publish a new kit version instead.`);
    }
    return Object.freeze({ version: entry.version, api: entry.api, text, hash });
  });

  const MAX_API_VERSION = Math.max(...KITS.map((k) => k.api));

  function findKit(version) {
    return KITS.find((k) => k.version === version) || null;
  }

  // The newest published kit of an API version, or null if there is none.
  function newestKit(api) {
    const kits = KITS.filter((k) => k.api === api);
    return kits[kits.length - 1] || null;
  }

  // The newest kit of the highest API version (alias kept from M1).
  function currentKit(api = MAX_API_VERSION) {
    return newestKit(api);
  }

  // { from, to } when a newer kit of the document's API exists, else null.
  function outdatedKit(parts) {
    const newest = newestKit(Number(parts.api));
    if (!newest || newest.version === parts.kitVersion) return null;
    return { from: parts.kitVersion, to: newest.version };
  }

  return { KITS, MAX_API_VERSION, findKit, currentKit, newestKit, outdatedKit };
}

// EV_TEST_KITS=1 (smoke test and unit tests only) adds the test-only kits of
// test/kits, which are older than every published kit. test/ is never
// packaged, so a released host never loads them.
function kitList() {
  const list = require('./published.json');
  const testDir = path.join(__dirname, '..', 'test', 'kits');
  const testList = path.join(testDir, 'published.json');
  if (process.env.EV_TEST_KITS !== '1' || !fs.existsSync(testList)) return list;
  return [...JSON.parse(fs.readFileSync(testList, 'utf8')).map((entry) => ({ ...entry, dir: testDir })), ...list];
}

const published = createKitRegistry(kitList(), __dirname);

module.exports = { createKitRegistry, ...published, kitSectionText, sha256 };
