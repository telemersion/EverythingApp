'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { escapeJson, splice, replaceKit } = require('../src/splice');
const { parseDocument } = require('../src/frame');
const { checkDocument } = require('../src/conformance');
const { findKit, currentKit } = require('../kit');
const { makeDocument } = require('./helpers');

test('escapeJson writes every < as \\u003c', () => {
  assert.equal(escapeJson('{"a":"</script><b>"}'), '{"a":"\\u003c/script>\\u003cb>"}');
});

test('splice replaces only the data block', () => {
  const html = makeDocument();
  const out = splice(html, '{"rows":[]}');
  const start = html.indexOf('id="ev-data">') + 'id="ev-data">'.length;
  assert.equal(out.slice(0, start), html.slice(0, start));
  assert.ok(out.endsWith(html.slice(html.indexOf('</script>', start))));
  assert.ok(out.includes('id="ev-data">{"rows":[]}</script>'));
});

test('splice escapes < in the data', () => {
  const out = splice(makeDocument(), '{"x":"</script><!--"}');
  assert.ok(out.includes('{"x":"\\u003c/script>\\u003c!--"}'));
});

test('splice keeps $ sequences literally', () => {
  const out = splice(makeDocument(), '{"x":"$& $1 $$ $`"}');
  assert.ok(out.includes('{"x":"$& $1 $$ $`"}'));
});

test('splice rejects invalid JSON and non-strings', () => {
  assert.throws(() => splice(makeDocument(), '{nope'), SyntaxError);
  assert.throws(() => splice(makeDocument(), { a: 1 }), TypeError);
});

test('splice rejects a file that does not match the frame', () => {
  const html = makeDocument();
  assert.throws(() => splice(html.replace('id="ev-data"', 'id="other"'), '{}'), /does not match the document frame/);
  const twice = html.replace('<div id="ev-app"></div>', '<script type="application/json" id="ev-data">{}</script>');
  assert.throws(() => splice(twice, '{}'), /does not match the document frame/);
});

test('splice finds the real data block although the kit source mentions its tag', () => {
  const html = makeDocument();
  assert.ok(html.split('id="ev-data">').length > 2, 'the kit contains the tag text');
  assert.ok(splice(html, '{"ok":1}').includes('<div id="ev-app"></div>\n  <script type="application/json" id="ev-data">{"ok":1}</script>'));
});

test('replaceKit changes only the kit and its version', () => {
  const old = findKit('1.0.0');
  const html = makeDocument({ kitVersion: old.version, kit: old.text });
  const next = replaceKit(html, currentKit());
  assert.deepEqual(parseDocument(next).parts, { ...parseDocument(html).parts, kitVersion: '1.1.0', kit: currentKit().text });
  assert.equal(checkDocument(next).ok, true);
});

test('replaceKit refuses a file that does not match the frame', () => {
  assert.throws(() => replaceKit('<html></html>', currentKit()), /document frame/);
});
