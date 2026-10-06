'use strict';

// The document frame of the EverythingApp document specification (API v1).
// Even entries are literal text, odd entries are slot names. Every conforming
// document is exactly buildDocument(parts) for some parts. The kit
// (kit/ev-kit-*.js) builds the same text in the browser; test/kit.test.js
// keeps the two in sync.
const FRAME = [
  '<!DOCTYPE html>\n<html lang="', 'lang',
  '">\n<head>\n  <meta charset="utf-8">\n  <meta name="ev-host-api" content="', 'api',
  '">\n  <meta name="ev-doc-type" content="', 'docType',
  '" data-version="', 'docTypeVersion',
  '">\n  <title>', 'title',
  '</title>\n  <style id="ev-style">', 'style',
  '</style>\n</head>\n<body>\n  <div id="ev-app"></div>\n  <script type="application/json" id="ev-data">', 'data',
  '</script>\n  <script id="ev-kit" data-kit-version="', 'kitVersion',
  '">', 'kit',
  '</script>\n  <script id="ev-script">', 'script',
  '</script>\n</body>\n</html>\n',
];

// Where each slot's content ends. Attribute slots end at the closing quote,
// the title at the next tag, sections at their closing tag (browsers end
// <style> and <script> elements case-insensitively).
const SLOT_END = {
  lang: /"/g,
  api: /"/g,
  docType: /"/g,
  docTypeVersion: /"/g,
  title: /</g,
  style: /<\/style/gi,
  data: /<\/script/gi,
  kitVersion: /"/g,
  kit: /<\/script/gi,
  script: /<\/script/gi,
};

function buildDocument(parts) {
  return FRAME.map((piece, i) => (i % 2 === 1 ? parts[piece] : piece)).join('');
}

// Returns { ok: true, parts } or { ok: false, offset, expected }, where
// expected is the frame text that should have started at offset.
function parseDocument(html) {
  const parts = {};
  let pos = 0;
  for (let i = 0; i < FRAME.length; i += 2) {
    const literal = FRAME[i];
    if (!html.startsWith(literal, pos)) {
      const offset = firstMismatch(html, literal, pos);
      return { ok: false, offset, expected: literal.slice(offset - pos) };
    }
    pos += literal.length;
    const slot = FRAME[i + 1];
    if (slot === undefined) break;
    const end = SLOT_END[slot];
    end.lastIndex = pos;
    const match = end.exec(html);
    if (!match) return { ok: false, offset: html.length, expected: FRAME[i + 2] };
    parts[slot] = html.slice(pos, match.index);
    pos = match.index;
  }
  if (pos !== html.length) return { ok: false, offset: pos, expected: '(end of file)' };
  return { ok: true, parts };
}

function firstMismatch(html, literal, pos) {
  let k = 0;
  while (k < literal.length && html[pos + k] === literal[k]) k++;
  return pos + k;
}

function lineOf(text, offset) {
  let line = 1;
  for (let i = 0; i < offset && i < text.length; i++) if (text[i] === '\n') line++;
  return line;
}

module.exports = { FRAME, buildDocument, parseDocument, lineOf };
