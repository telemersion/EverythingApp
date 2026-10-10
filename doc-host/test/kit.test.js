'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');
const { parseDocument, buildDocument } = require('../src/frame');
const { splice } = require('../src/splice');
const { execFileSync } = require('node:child_process');
const path = require('node:path');
const { KITS, findKit, currentKit, newestKit, outdatedKit } = require('../kit');
const { SAMPLE_DATA, makeDocument, makeParts } = require('./helpers');

// Loads a document in jsdom. Records which window listeners the document's
// scripts register (jsdom registers some of its own; those are ignored).
function load(html, { host, picker } = {}) {
  const dom = new JSDOM(html, {
    runScripts: 'dangerously',
    url: 'https://example.test/sample.ev.html',
    beforeParse(window) {
      window.registered = [];
      const add = window.addEventListener.bind(window);
      window.addEventListener = (type, ...rest) => {
        if (window.document.currentScript) window.registered.push(type);
        return add(type, ...rest);
      };
      if (host) window.evHost = host;
      if (picker) {
        window.showSaveFilePicker = async () => ({
          queryPermission: async () => 'granted',
          requestPermission: async () => 'granted',
          createWritable: async () => ({ write: (t) => picker.push(t), close: async () => {} }),
        });
      }
    },
  });
  return dom.window;
}

function fakeHost() {
  return {
    version: 1,
    handler: null,
    dirtyCalls: 0,
    onSaveRequest(fn) { this.handler = fn; },
    markDirty() { this.dirtyCalls++; },
  };
}

test('kit 2.0.0 is the only published kit and the current kit', () => {
  assert.equal(currentKit(1).version, '2.0.0');
  assert.deepEqual(KITS.map((k) => k.version), ['2.0.0']);
});

test('with a host, elements marked data-ev-fallback are hidden', () => {
  const script = '\nwindow.testDoc = EvKit.init();\n' +
    'document.getElementById("ev-app").innerHTML = \'<button data-ev-fallback="save">Save</button><span data-ev-fallback="status"></span>\';\n';
  const window = load(makeDocument({ script }), { host: fakeHost() });
  const marked = window.document.querySelectorAll('[data-ev-fallback]');
  assert.equal(marked.length, 2);
  for (const el of marked) {
    assert.equal(window.getComputedStyle(el).display, 'none');
  }
});

test('without a host, the marked Save button saves through the fallback', async () => {
  const written = [];
  const script = '\nwindow.testDoc = EvKit.init();\n' +
    'document.getElementById("ev-app").innerHTML = \'<button data-ev-fallback="save">Save</button>\';\n';
  const window = load(makeDocument({ script }), { picker: written }); // load() installs a fake showSaveFilePicker
  window.testDoc.changed();
  window.document.querySelector('[data-ev-fallback="save"]').click();
  await new Promise((r) => setTimeout(r, 0));
  assert.deepEqual(written, [window.testDoc.toHtml()]);
});

test('without a host, the marked status shows the save state', async () => {
  const script = '\nwindow.testDoc = EvKit.init();\n' +
    'document.getElementById("ev-app").innerHTML = \'<span data-ev-fallback="status"></span>\';\n';
  const window = load(makeDocument({ script }));
  await new Promise((r) => setTimeout(r, 0));               // let DOMContentLoaded run
  const status = window.document.querySelector('[data-ev-fallback="status"]');
  assert.equal(status.textContent, 'Saved');                // set on DOMContentLoaded
  assert.equal(status.getAttribute('data-ev-state'), 'saved');
  window.testDoc.changed();
  assert.equal(status.textContent, 'Unsaved changes');
  assert.equal(status.getAttribute('data-ev-state'), 'unsaved');
});

test('published kits are LF-only and never contain </script or <!--', () => {
  for (const kit of KITS) {
    assert.ok(!kit.text.includes('\r'), kit.version);
    assert.ok(!/<\/script|<!--/i.test(kit.text), kit.version);
  }
});

test('toHtml() reproduces the original file when nothing changed', () => {
  const html = makeDocument();
  const window = load(html);
  assert.equal(window.testDoc.toHtml(), html);
});

test('toHtml() equals a host save of the same data, byte for byte', () => {
  const html = makeDocument();
  const window = load(html);
  window.testDoc.data.rows.push({ note: 'new </script> row', hours: 2 });
  const json = JSON.stringify(window.testDoc.data);
  assert.equal(window.testDoc.toHtml(), splice(html, json));
});

test('toHtml() keeps the frame even when the script changes the DOM', () => {
  const script = '\nwindow.testDoc = EvKit.init();\ndocument.title = "changed";\ndocument.body.className = "x";\n' +
    'document.getElementById("ev-app").textContent = "rendered";\n';
  const html = makeDocument({ script });
  const window = load(html);
  assert.equal(window.testDoc.toHtml(), html);
  assert.deepEqual(parseDocument(window.testDoc.toHtml()).parts, makeParts({ script }));
});

test('doc.data is the parsed data block', () => {
  const window = load(makeDocument());
  assert.equal(JSON.stringify(window.testDoc.data), JSON.stringify(SAMPLE_DATA));
});

test('without a host: fallback mode with key binding, unload guard and dirty callback', () => {
  const script = '\nwindow.dirtyLog = [];\nwindow.testDoc = EvKit.init({ onDirtyChange: (d) => window.dirtyLog.push(d) });\n';
  const window = load(makeDocument({ script }));
  assert.equal(window.testDoc.hosted, false);
  assert.ok(window.registered.includes('keydown'));
  assert.ok(window.registered.includes('beforeunload'));
  window.testDoc.changed();
  window.testDoc.changed();
  assert.deepEqual(Array.from(window.dirtyLog), [true]);
});

test('with a host: no key binding, no unload guard; changes and saves go through evHost', () => {
  const host = fakeHost();
  const window = load(makeDocument(), { host });
  assert.equal(window.testDoc.hosted, true);
  assert.ok(!window.registered.includes('keydown'));
  assert.ok(!window.registered.includes('beforeunload'));
  window.testDoc.changed();
  assert.equal(host.dirtyCalls, 1);
  window.testDoc.data.rows = [];
  assert.equal(host.handler(), '{"rows":[]}');
});

test('getData option replaces the data source', () => {
  const host = fakeHost();
  const script = '\nwindow.testDoc = EvKit.init({ getData: () => ({ replaced: true }) });\n';
  load(makeDocument({ script }), { host });
  assert.equal(host.handler(), '{"replaced":true}');
});

test('init() may only be called once and EvKit cannot be replaced', () => {
  const window = load(makeDocument());
  assert.throws(() => window.EvKit.init(), /only be called once/);
  assert.throws(() => { window.EvKit = null; }, TypeError);
  assert.equal(typeof window.EvKit.init, 'function');
});

test('the kit builds the same frame as frame.js', () => {
  const parts = makeParts({ title: 'Ünïcode – title', lang: 'de-CH' });
  const window = load(buildDocument(parts));
  assert.equal(window.testDoc.toHtml(), buildDocument(parts));
});

test('newestKit returns the newest kit of an API, or null', () => {
  assert.equal(newestKit(1).version, '2.0.0');
  assert.equal(newestKit(999), null);
});

test('outdatedKit: with EV_TEST_KITS the test kit 1.9.0 is outdated by 2.0.0', () => {
  assert.equal(outdatedKit(makeParts()), null);
  const out = execFileSync(process.execPath, ['-e', `
    const kits = require('./kit');
    const { makeParts } = require('./test/helpers');
    console.log(JSON.stringify({
      versions: kits.KITS.map((k) => k.version),
      outdated: kits.outdatedKit(makeParts({ kitVersion: '1.9.0', kit: kits.findKit('1.9.0').text })),
    }));`], { cwd: path.join(__dirname, '..'), env: { ...process.env, EV_TEST_KITS: '1' }, encoding: 'utf8' });
  assert.deepEqual(JSON.parse(out), { versions: ['1.9.0', '2.0.0'], outdated: { from: '1.9.0', to: '2.0.0' } });
  assert.equal(findKit('1.9.0'), null, 'without EV_TEST_KITS the test kit is unknown');
});

// ---------- Kit 2.0.0: document id, manifest, modules, helpers ----------

const SAMPLE_MODULE = { name: 'sample', version: '1.2.0', text: "\nEvKit.defineModule('sample', '1.2.0', { hello: 1 });\n" };

test('the fallback rebuilds the document id, the manifest and the modules', () => {
  const parts = makeParts({ docId: 'c'.repeat(32), manifest: '{"textFields":["rows.*.note"]}', modules: [SAMPLE_MODULE] });
  const html = buildDocument(parts);
  const window = load(html);
  assert.equal(window.testDoc.toHtml(), html);
  window.testDoc.data.rows.push({ note: 'more' });
  assert.equal(window.testDoc.toHtml(), splice(html, JSON.stringify(window.testDoc.data)));
});

test('the first fallback save fills in a document id and later saves keep it', async () => {
  const written = [];
  const window = load(makeDocument(), { picker: written });
  assert.equal(await window.testDoc.save(), true);
  assert.equal(await window.testDoc.save(), true);
  const ids = written.map((html) => parseDocument(html).parts.docId);
  assert.match(ids[0], /^[0-9a-f]{32}$/);
  assert.equal(ids[1], ids[0]);

  const kept = [];
  const other = load(makeDocument({ docId: 'd'.repeat(32) }), { picker: kept });
  await other.testDoc.save();
  assert.equal(parseDocument(kept[0]).parts.docId, 'd'.repeat(32));
});

test('EvKit.module returns a defined module and checks its major version', () => {
  const window = load(makeDocument({ modules: [SAMPLE_MODULE] }));
  assert.equal(window.EvKit.module('sample', 1).hello, 1);
  assert.throws(() => window.EvKit.module('sample', 2), (e) => /sample/.test(e.message) && /1\.2\.0/.test(e.message));
  assert.throws(() => window.EvKit.module('missing', 1), /missing/);
  assert.throws(() => window.EvKit.defineModule('sample', '1.3.0', {}), /sample/);
});

test('newId returns 16 lowercase hex characters, different each time', () => {
  const window = load(makeDocument());
  const a = window.EvKit.newId();
  assert.match(a, /^[0-9a-f]{16}$/);
  assert.notEqual(window.EvKit.newId(), a);
});

test('orderBetween returns keys strictly between its arguments', () => {
  const { orderBetween } = load(makeDocument()).EvKit;
  assert.equal(orderBetween(null, null), 'V');
  assert.equal(orderBetween('V', null), 'l');
  assert.equal(orderBetween(null, 'V'), 'G');
  for (const [a, b] of [['', null], ['a0', null], ['b', 'a'], ['a', 'a'], ['a-', null], [null, 7]]) {
    assert.throws(() => orderBetween(a, b), /EvKit\.orderBetween/, `${a} ${b}`);
  }
});

test('1,000 inserts at the front and between neighbours stay valid and increasing', () => {
  const { orderBetween } = load(makeDocument()).EvKit;
  const valid = (k) => /^[0-9A-Za-z]*[1-9A-Za-z]$/.test(k);
  const keys = [orderBetween(null, null)];
  for (let i = 0; i < 1000; i++) keys.unshift(orderBetween(null, keys[0]));
  assert.ok(keys.every(valid));
  assert.ok(keys.every((k, i) => i === 0 || keys[i - 1] < k));
  let lo = 'V';
  let hi = 'k';
  for (let i = 0; i < 1000; i++) {
    const k = orderBetween(lo, hi);
    assert.ok(valid(k) && lo < k && k < hi, k);
    if (i % 2) lo = k; else hi = k;
  }
});

test('ordered sorts by sort key, then by id, items without a key last', () => {
  const { ordered } = load(makeDocument()).EvKit;
  const map = { z: { order: 'a' }, b: { order: 'V' }, a: { order: 'V' }, y: {}, c: { order: 'G' }, x: {} };
  assert.deepEqual(JSON.parse(JSON.stringify(ordered(map))),
    [['c', { order: 'G' }], ['a', { order: 'V' }], ['b', { order: 'V' }], ['z', { order: 'a' }], ['x', {}], ['y', {}]]);
  assert.deepEqual(JSON.parse(JSON.stringify(ordered({ q: { pos: 'b' }, p: { pos: 'a' } }, 'pos'))).map(([id]) => id), ['p', 'q']);
});

test('the fallback keeps the modules even when the script removes their elements', () => {
  const script = "\nwindow.testDoc = EvKit.init();\ndocument.getElementById('ev-module-sample').remove();\n";
  const html = makeDocument({ modules: [SAMPLE_MODULE], script });
  const window = load(html);
  assert.equal(window.document.getElementById('ev-module-sample'), null);
  assert.equal(window.testDoc.toHtml(), html);
});
