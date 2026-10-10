'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { sha256 } = require('../src/hash');

// Published modules never change, like published kits. published.json pins
// each module file's hash; loading fails loudly if a published file was edited.
// A module's element content is a newline followed by the module file.
function createModuleRegistry(list, dir) {
  const MODULES = list.map((entry) => {
    const text = '\n' + fs.readFileSync(path.join(dir, entry.file), 'utf8');
    const hash = sha256(text);
    if (hash !== entry.sha256) {
      throw new Error(`Published module ${entry.name} ${entry.version} was modified (${entry.file}). Publish a new module version instead.`);
    }
    return Object.freeze({ name: entry.name, version: entry.version, text, hash });
  });

  function findModule(name, version) {
    return MODULES.find((m) => m.name === name && m.version === version) || null;
  }

  // The newest published version of a module (the list is in publishing order), or null.
  function newestModule(name) {
    const versions = MODULES.filter((m) => m.name === name);
    return versions[versions.length - 1] || null;
  }

  return { MODULES, findModule, newestModule };
}

const published = createModuleRegistry(require('./published.json'), __dirname);

module.exports = { createModuleRegistry, ...published };
