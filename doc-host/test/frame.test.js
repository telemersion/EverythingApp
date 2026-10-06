'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { buildDocument, parseDocument, lineOf } = require('../src/frame');

const PARTS = {
  lang: 'en', api: '1', docType: 'demo', docTypeVersion: '1.0', title: 'Demo',
  style: '\nbody{}\n', data: '{"a":1}', kitVersion: '9.9.9', kit: '\n/* kit */\n', script: '\n/* script */\n',
};

test('buildDocument produces the exact frame', () => {
  assert.equal(buildDocument(PARTS), [
    '<!DOCTYPE html>',
    '<html lang="en">',
    '<head>',
    '  <meta charset="utf-8">',
    '  <meta name="ev-host-api" content="1">',
    '  <meta name="ev-doc-type" content="demo" data-version="1.0">',
    '  <title>Demo</title>',
    '  <style id="ev-style">',
    'body{}',
    '</style>',
    '</head>',
    '<body>',
    '  <div id="ev-app"></div>',
    '  <script type="application/json" id="ev-data">{"a":1}</script>',
    '  <script id="ev-kit" data-kit-version="9.9.9">',
    '/* kit */',
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
