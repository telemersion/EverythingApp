'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');
const { parseDocument, buildDocument } = require('../src/frame');
const { splice } = require('../src/splice');
const { KITS, findKit } = require('../kit');
const { SAMPLE_DATA, makeDocument, makeParts } = require('./helpers');

// Loads a document in jsdom. Records which window listeners the document's
// scripts register (jsdom registers some of its own; those are ignored).
function load(html, { host } = {}) {
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

test('published kits are LF-only and never contain </script or <!--', () => {
  for (const kit of KITS) {
    assert.ok(!kit.text.includes('\r'), kit.version);
    assert.ok(!/<\/script|<!--/i.test(kit.text), kit.version);
  }
  assert.ok(findKit('1.0.0'));
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
