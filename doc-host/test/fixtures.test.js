'use strict';

// outdated-kit.ev.html uses the test-only kit 1.9.0 (assemble runs as a child
// process and inherits this).
process.env.EV_TEST_KITS = '1';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { JSDOM } = require('jsdom');
const { checkDocument } = require('../src/conformance');
const { currentKit } = require('../kit');

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

test('every fixture has an empty document id and the current kit, except outdated-kit.ev.html on kit 1.9.0', () => {
  for (const name of documents) {
    const { parts } = checkDocument(fs.readFileSync(path.join(FIXTURES, name), 'utf8'));
    assert.equal(parts.docId, '', name);
    assert.equal(parts.kitVersion, name === 'outdated-kit.ev.html' ? '1.9.0' : currentKit().version, name);
  }
});

test('the hours sheet declares its notes as text fields', () => {
  const { manifest } = checkDocument(fs.readFileSync(path.join(FIXTURES, 'hours-sheet.ev.html'), 'utf8'));
  assert.deepEqual(manifest, { textFields: ['rows.*.note'] });
});

function loadFixture(name, host) {
  const html = fs.readFileSync(path.join(FIXTURES, name), 'utf8');
  const dom = new JSDOM(html, {
    runScripts: 'dangerously',
    url: `https://example.test/${name}`,
    beforeParse(window) { if (host) window.evHost = host; },
  });
  return dom.window.document;
}

const display = (document, el) => document.defaultView.getComputedStyle(el).display;

test('hours sheet in the host: Save button and status hidden, rows reach the host', () => {
  const host = { version: 1, handler: null, dirty: 0, onSaveRequest(fn) { this.handler = fn; }, markDirty() { this.dirty++; } };
  const document = loadFixture('hours-sheet.ev.html', host);
  assert.equal(display(document, document.querySelector('[data-ev-fallback="save"]')), 'none');
  assert.equal(display(document, document.querySelector('[data-ev-fallback="status"]')), 'none');
  document.getElementById('add').click();
  assert.equal(host.dirty, 1);
  const rows = JSON.parse(host.handler()).rows;
  assert.equal(Object.keys(rows).length, 1);
  assert.match(Object.keys(rows)[0], /^[0-9a-f]{16}$/);
  assert.ok(!('id' in Object.values(rows)[0]), 'the id is the key only');
});

test('hours sheet in a browser: own Save button and status line', () => {
  const document = loadFixture('hours-sheet.ev.html', null);
  assert.ok(document.querySelector('[data-ev-fallback="save"]'));
  document.getElementById('add').click();
  assert.equal(document.querySelector('[data-ev-fallback="status"]').textContent, 'Unsaved changes');
});

test('to-do list in the host: Save button and status hidden, items reach the host', () => {
  const host = { version: 1, handler: null, dirty: 0, onSaveRequest(fn) { this.handler = fn; }, markDirty() { this.dirty++; } };
  const document = loadFixture('todo-list.ev.html', host);
  assert.equal(display(document, document.querySelector('[data-ev-fallback="save"]')), 'none');
  assert.equal(display(document, document.querySelector('[data-ev-fallback="status"]')), 'none');
  document.getElementById('text').value = 'Buy milk';
  document.getElementById('add').click();
  assert.equal(host.dirty, 1);
  const items = Object.values(JSON.parse(host.handler()).items);
  assert.equal(items.length, 1);
  assert.equal(items[0].text, 'Buy milk');
  assert.equal(items[0].done, false);
  assert.match(items[0].order, /^[0-9A-Za-z]*[1-9A-Za-z]$/);
});

test('to-do list in a browser: own Save button and status line', () => {
  const document = loadFixture('todo-list.ev.html', null);
  assert.ok(document.querySelector('[data-ev-fallback="save"]'));
  document.getElementById('text').value = 'Buy milk';
  document.getElementById('add').click();
  assert.equal(document.querySelector('[data-ev-fallback="status"]').textContent, 'Unsaved changes');
});
