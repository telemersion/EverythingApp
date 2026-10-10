'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { buildDocument, parseDocument, lineOf } = require('../src/frame');

const PARTS = {
  lang: 'en', api: '1', docType: 'demo', docTypeVersion: '1.0', title: 'Demo',
  docId: '0123456789abcdef0123456789abcdef', style: '\nbody{}\n', manifest: '{"textFields":["rows.*.note"]}',
  data: '{"a":1}', kitVersion: '9.9.9', kit: '\n/* kit */\n',
  modules: [{ name: 'alpha', version: '1.0.0', text: '\nA\n' }, { name: 'beta', version: '2.1.0', text: '\nB\n' }],
  script: '\n/* script */\n',
};

test('buildDocument produces the exact frame', () => {
  assert.equal(buildDocument(PARTS), [
    '<!DOCTYPE html>',
    '<html lang="en">',
    '<head>',
    '  <meta charset="utf-8">',
    '  <meta name="ev-host-api" content="1">',
    '  <meta name="ev-doc-type" content="demo" data-version="1.0">',
    '  <meta name="ev-doc-id" content="0123456789abcdef0123456789abcdef">',
    '  <title>Demo</title>',
    '  <style id="ev-style">',
    'body{}',
    '</style>',
    '  <script type="application/json" id="ev-manifest">{"textFields":["rows.*.note"]}</script>',
    '</head>',
    '<body>',
    '  <div id="ev-app"></div>',
    '  <script type="application/json" id="ev-data">{"a":1}</script>',
    '  <script id="ev-kit" data-kit-version="9.9.9">',
    '/* kit */',
    '</script>',
    '  <script id="ev-module-alpha" data-module-version="1.0.0">',
    'A',
    '</script>',
    '  <script id="ev-module-beta" data-module-version="2.1.0">',
    'B',
    '</script>',
    '  <script id="ev-script">',
    '/* script */',
    '</script>',
    '</body>',
    '</html>',
    '',
  ].join('\n'));
});

test('parseDocument returns the parts of a built document', () => {
  const result = parseDocument(buildDocument(PARTS));
  assert.equal(result.ok, true);
  assert.deepEqual(result.parts, PARTS);
});

test('parseDocument reads zero, one and two modules', () => {
  for (const modules of [[], PARTS.modules.slice(0, 1), PARTS.modules]) {
    const parts = { ...PARTS, modules };
    assert.deepEqual(parseDocument(buildDocument(parts)), { ok: true, parts });
  }
});

test('parseDocument refuses a module line without a version attribute', () => {
  const html = buildDocument(PARTS).replace(' data-module-version="2.1.0"', '');
  const result = parseDocument(html);
  assert.equal(result.ok, false);
  assert.equal(lineOf(html, result.offset), lineOf(html, html.indexOf('ev-module-beta')));
});

test('a module text ends at its closing tag, in any letter case', () => {
  const html = buildDocument({ ...PARTS, modules: [{ name: 'alpha', version: '1.0.0', text: '\nx = "</Script>";\n' }] });
  assert.equal(parseDocument(html).ok, false);
});

test('parseDocument reports the offset of the first difference', () => {
  const html = buildDocument(PARTS).replace('<head>\n', '<head>\n  <meta name="viewport" content="x">\n');
  const result = parseDocument(html);
  assert.equal(result.ok, false);
  assert.equal(lineOf(html, result.offset), 4);
  assert.match(html.slice(result.offset), /^name="viewport"/);
});

test('a section cannot contain its closing tag, in any letter case', () => {
  const html = buildDocument({ ...PARTS, script: '\nconst s = "</SCRIPT>";\n' });
  assert.equal(parseDocument(html).ok, false);
});

test('trailing content after </html> is rejected', () => {
  assert.equal(parseDocument(buildDocument(PARTS) + '<!-- extra -->\n').ok, false);
});
