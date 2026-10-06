'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

// Published kits never change. published.json pins each kit file's hash;
// loading fails loudly if a published kit file was edited.
const PUBLISHED = require('./published.json');

function sha256(text) {
  return crypto.createHash('sha256').update(text, 'utf8').digest('hex');
}

// The kit section of a document is a newline followed by the kit file.
function kitSectionText(file) {
  return '\n' + fs.readFileSync(path.join(__dirname, file), 'utf8');
}

const KITS = PUBLISHED.map((entry) => {
  const text = kitSectionText(entry.file);
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

function currentKit(api = MAX_API_VERSION) {
  const kits = KITS.filter((k) => k.api === api);
  return kits[kits.length - 1];
}

module.exports = { KITS, MAX_API_VERSION, findKit, currentKit, kitSectionText, sha256 };
