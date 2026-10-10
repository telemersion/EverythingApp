'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createModuleRegistry } = require('../modules');
const { checkDocument } = require('../src/conformance');
const { sha256 } = require('../src/hash');
const { makeDocument } = require('./helpers');

// A registry of two fake modules in a temp folder.
function fakeRegistry(t, { tamper = false } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ev-modules-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const files = { 'alpha-1.0.0.js': 'var a = 1;\n', 'alpha-1.1.0.js': 'var a = 2;\n', 'beta-2.0.0.js': 'var b = 1;\n' };
  const list = Object.entries(files).map(([file, text]) => {
    const [, name, version] = /^(.+)-(\d+\.\d+\.\d+)\.js$/.exec(file);
    fs.writeFileSync(path.join(dir, file), text);
    return { name, version, file, sha256: sha256('\n' + text) };
  });
  if (tamper) fs.writeFileSync(path.join(dir, 'beta-2.0.0.js'), 'var b = 666;\n');
  return createModuleRegistry(list, dir);
}

test('the registry finds published modules and their newest version', (t) => {
  const reg = fakeRegistry(t);
  assert.equal(reg.findModule('alpha', '1.0.0').text, '\nvar a = 1;\n');
  assert.equal(reg.findModule('alpha', '9.9.9'), null);
  assert.equal(reg.findModule('gamma', '1.0.0'), null);
  assert.equal(reg.newestModule('alpha').version, '1.1.0');
  assert.equal(reg.newestModule('gamma'), null);
});

test('a modified published module file stops the registry', (t) => {
  assert.throws(() => fakeRegistry(t, { tamper: true }), /Published module beta 2\.0\.0 was modified/);
});

test('module lines are checked by name, version, text and order', (t) => {
  const reg = fakeRegistry(t);
  const mod = (name, version, text) => ({ name, version, text: text ?? reg.findModule(name, version)?.text ?? '\nx\n' });
  const codes = (modules) => checkDocument(makeDocument({ modules }), { modules: reg }).errors.map((e) => e.code);
  assert.deepEqual(codes([mod('alpha', '1.0.0'), mod('beta', '2.0.0')]), []);
  assert.deepEqual(codes([mod('gamma', '1.0.0')]), ['module-unknown']);
  assert.deepEqual(codes([mod('alpha', '9.9.9')]), ['module-unknown']);
  assert.deepEqual(codes([mod('alpha', '1.0.0', '\nvar a = 3;\n')]), ['module-modified']);
  assert.deepEqual(codes([mod('beta', '2.0.0'), mod('alpha', '1.0.0')]), ['module-order']);
  assert.deepEqual(codes([mod('alpha', '1.0.0'), mod('alpha', '1.1.0')]), ['module-order']);
  const { errors } = checkDocument(makeDocument({ modules: [mod('alpha', '9.9.9')] }), { modules: reg });
  assert.match(errors[0].message, /alpha 9\.9\.9/);
});

test('the published module list loads', () => {
  assert.ok(Array.isArray(require('../modules').MODULES));
});
