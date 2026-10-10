'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { isDocument, checkDocument, formatReport } = require('../src/conformance');
const { makeDocument, makeParts } = require('./helpers');

// The kit's source contains frame tags as text, so mutate the real tag,
// which is always the last occurrence.
function replaceLast(text, search, replacement) {
  const i = text.lastIndexOf(search);
  return text.slice(0, i) + replacement + text.slice(i + search.length);
}

function codes(html) {
  return checkDocument(html).errors.map((e) => e.code);
}

test('a valid document passes and returns its parts', () => {
  const result = checkDocument(makeDocument());
  assert.equal(result.ok, true);
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.parts, makeParts());
  assert.equal(result.api, 1);
});

test('isDocument looks for the ev-host-api meta tag only', () => {
  assert.equal(isDocument(makeDocument()), true);
  assert.equal(isDocument('<!DOCTYPE html><html><body>hello</body></html>'), false);
});

// Each case breaks one rule of the specification.
// The code `kit-api` (kit and declared API version disagree) has no case here:
// it cannot be triggered while kit 1.0.0 is the only published kit, because
// the declared API version must be 1 for the document to reach that check
// and kit 1.0.0 belongs to API v1. Add a case when a second API version ships.
const INVALID = [
  ['bom', () => '\ufeff' + makeDocument()],
  ['line-endings', () => makeDocument().replace(/\n/g, '\r\n')],
  ['api-missing', () => makeDocument().replace('<meta name="ev-host-api" content="1">', '')],
  ['api-invalid', () => makeDocument({ api: 'one' })],
  ['frame', () => makeDocument().replace('<head>\n', '<head>\n  <meta name="viewport" content="width=device-width">\n')],
  ['frame', () => replaceLast(makeDocument(), '</body>', '<!-- note -->\n</body>')],
  ['frame', () => makeDocument().replace('<div id="ev-app"></div>', '<div id="ev-app">rendered</div>')],
  ['frame', () => makeDocument({ style: '\n</style><style>\n' })],
  ['frame', () => replaceLast(makeDocument(), 'id="ev-script"', 'id="script"')],
  ['field', () => makeDocument({ title: 'Tom &amp; Jerry' })],
  ['field', () => makeDocument({ docType: 'Hours Sheet' })],
  ['kit-unknown', () => makeDocument({ kitVersion: '0.0.1' })],
  ['kit-modified', () => makeDocument({ kit: makeParts().kit.replace('use strict', 'use  strict') })],
  ['data-escape', () => makeDocument({ data: '{"a":"<b>"}' })],
  ['data-json', () => makeDocument({ data: '{"a":' })],
  ['data-shape', () => makeDocument({ data: '[1,2,3]' })],
  ['script-comment', () => makeDocument({ script: '\nconst s = "<!--";\n' })],
];

for (const [code, make] of INVALID) {
  test(`refuses: ${code} (${make.toString().slice(6, 70)}…)`, () => {
    const result = checkDocument(make());
    assert.equal(result.ok, false);
    assert.ok(codes(make()).includes(code), `expected ${code}, got ${codes(make())}`);
  });
}

// Bytes as read from disk: a Latin-1 "ä" (0xE4) in a script comment.
function latin1Document() {
  const [head, tail] = makeDocument({ script: '\n// Datei f\u00e4hrt\nwindow.x = 1;\n' }).split('f\u00e4hrt');
  return Buffer.concat([Buffer.from(head, 'utf8'), Buffer.from('f\u00e4hrt', 'latin1'), Buffer.from(tail, 'utf8')]);
}

test('file bytes that are not valid UTF-8 are refused with encoding only', () => {
  const result = checkDocument(latin1Document());
  assert.equal(result.ok, false);
  assert.deepEqual(result.errors.map((e) => e.code), ['encoding']);
  assert.match(result.errors[0].message, /not valid UTF-8/);
});

test('file bytes in UTF-8 are checked like text and return the text', () => {
  const html = makeDocument({ script: '\n// f\u00e4hrt\nwindow.x = 1;\n' });
  const result = checkDocument(Buffer.from(html, 'utf8'));
  assert.deepEqual(result.errors, []);
  assert.equal(result.text, html);
  assert.deepEqual(codes(Buffer.from('\ufeff' + makeDocument(), 'utf8')), ['bom'], 'the decoder keeps the BOM');
});

test('isDocument also takes file bytes', () => {
  assert.equal(isDocument(latin1Document()), true);
  assert.equal(isDocument(Buffer.from('<p>hello</p>')), false);
});

test('a newer API version is refused with the update message only', () => {
  const result = checkDocument(makeDocument({ api: '2' }));
  assert.equal(result.ok, false);
  assert.deepEqual(result.errors.map((e) => e.code), ['api-newer']);
  assert.match(result.errors[0].message, /needs a newer EverythingApp \(API v2\)\. Update the host, or open it in Chrome\./);
});

test('CRLF files still get their other problems reported', () => {
  const html = makeDocument({ data: '[1]' }).replace(/\n/g, '\r\n');
  assert.deepEqual(codes(html), ['line-endings', 'data-shape']);
});

test('frame errors point at the line and show expected and found text', () => {
  const html = makeDocument().replace('<head>\n', '<head>\n  <meta name="viewport" content="x">\n');
  const [error] = checkDocument(html).errors;
  assert.equal(error.line, 4);
  assert.match(error.message, /expected "charset=\\"utf-8\\">" but found "name=\\"viewport\\"/);
});

test('formatReport lists every problem and mentions Chrome', () => {
  const report = formatReport('/tmp/hours.ev.html', [
    { code: 'frame', message: 'Broken.', line: 3 },
    { code: 'data-json', message: 'Bad JSON.' },
  ]);
  assert.match(report, /could not open hours\.ev\.html/);
  assert.match(report, /- \[frame\] line 3: Broken\./);
  assert.match(report, /- \[data-json\] Bad JSON\./);
  assert.match(report, /open the file in Chrome/);
});

test('formatReport heading names the situation', () => {
  const errors = [{ code: 'frame', message: 'Broken.' }];
  assert.match(formatReport('/tmp/a.ev.html', errors, { context: 'open-document' }).split('\n')[0],
    /^a\.ev\.html no longer follows the document specification\.$/);
  assert.match(formatReport('/tmp/a.ev.html', errors, { context: 'assemble' }).split('\n')[0],
    /^a\.ev\.html was not written\.$/);
  assert.doesNotMatch(formatReport('/tmp/a.ev.html', errors, { context: 'open-document' }), /could not open/);
  assert.throws(() => formatReport('/tmp/a.ev.html', errors, { context: 'nope' }), /Unknown report context/);
});

test('the document id is empty or 32 lowercase hex characters', () => {
  assert.equal(checkDocument(makeDocument({ docId: '' })).ok, true);
  assert.equal(checkDocument(makeDocument({ docId: '0123456789abcdef0123456789abcdef' })).ok, true);
  for (const docId of ['ABC', 'A'.repeat(32), 'a'.repeat(33)]) {
    const { errors } = checkDocument(makeDocument({ docId }));
    assert.deepEqual(errors.map((e) => e.code), ['field'], docId);
    assert.match(errors[0].message, /docId/);
  }
});

test('manifest problems are reported with their codes, and a valid manifest is returned', () => {
  assert.deepEqual(codes(makeDocument({ manifest: '{"textfields":[]}' })), ['manifest-key']);
  assert.deepEqual(codes(makeDocument({ manifest: '{"textFields":["a..b"]}' })), ['manifest-invalid']);
  assert.deepEqual(checkDocument(makeDocument({ manifest: '{"textFields":["rows.*.note"]}' })).manifest,
    { textFields: ['rows.*.note'] });
});
