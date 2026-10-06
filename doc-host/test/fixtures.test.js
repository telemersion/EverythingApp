'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { JSDOM } = require('jsdom');
const { checkDocument } = require('../src/conformance');

const FIXTURES = path.join(__dirname, '..', 'fixtures');
const documents = fs.readdirSync(FIXTURES).filter((n) => n.endsWith('.ev.html'));

for (const name of documents) {
  test(`${name} conforms and is up to date with fixtures/src`, async (t) => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ev-fixture-'));
    t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
    const html = fs.readFileSync(path.join(FIXTURES, name), 'utf8');
    assert.deepEqual(checkDocument(html).errors, []);
    const src = path.join(FIXTURES, 'src', name.replace('.ev.html', ''));
    const out = path.join(tmp, name);
    execFileSync(process.execPath, [path.join(__dirname, '..', 'tools', 'assemble.js'), src, out]);
    assert.equal(fs.readFileSync(out, 'utf8'), html, 'run: npm run assemble -- fixtures/src/<name> fixtures/<name>.ev.html');
  });
}

function loadFixture(name, host) {
  const html = fs.readFileSync(path.join(FIXTURES, name), 'utf8');
  const dom = new JSDOM(html, {
    runScripts: 'dangerously',
    url: `https://example.test/${name}`,
    beforeParse(window) { if (host) window.evHost = host; },
  });
  return dom.window.document;
}

test('hours sheet in the host: no Save button, rows reach the host', () => {
  const host = { version: 1, handler: null, dirty: 0, onSaveRequest(fn) { this.handler = fn; }, markDirty() { this.dirty++; } };
  const document = loadFixture('hours-sheet.ev.html', host);
  assert.equal(document.getElementById('save'), null);
  document.getElementById('add').click();
  assert.equal(host.dirty, 1);
  assert.equal(JSON.parse(host.handler()).rows.length, 1);
});

test('hours sheet in a browser: own Save button and status line', () => {
  const document = loadFixture('hours-sheet.ev.html', null);
  assert.ok(document.getElementById('save'));
  document.getElementById('add').click();
  assert.equal(document.getElementById('status').textContent, 'Unsaved changes');
});

test('to-do list in the host: no Save button, items reach the host', () => {
  const host = { version: 1, handler: null, dirty: 0, onSaveRequest(fn) { this.handler = fn; }, markDirty() { this.dirty++; } };
  const document = loadFixture('todo-list.ev.html', host);
  assert.equal(document.getElementById('save'), null);
  assert.equal(document.getElementById('status'), null);
  document.getElementById('text').value = 'Buy milk';
  document.getElementById('add').click();
  assert.equal(host.dirty, 1);
  assert.deepEqual(JSON.parse(host.handler()).items, [{ text: 'Buy milk', done: false }]);
});

test('to-do list in a browser: own Save button and status line', () => {
  const document = loadFixture('todo-list.ev.html', null);
  assert.ok(document.getElementById('save'));
  document.getElementById('text').value = 'Buy milk';
  document.getElementById('add').click();
  assert.equal(document.getElementById('status').textContent, 'Unsaved changes');
});
