'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');
const { parseDocument, buildDocument } = require('../src/frame');
const { splice } = require('../src/splice');
const { KITS, findKit, currentKit } = require('../kit');
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

test('kit 1.1.0 is published for API 1 and is the current kit', () => {
  assert.equal(currentKit(1).version, '1.1.0');
  assert.ok(findKit('1.0.0'), 'kit 1.0.0 stays published');
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
