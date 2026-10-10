'use strict';

const { parseDocument, buildDocument } = require('./frame');

// Every "<" becomes \u003c,
// so the data can never close its script element.
function escapeJson(json) {
  return json.replace(/</g, '\\u003c');
}

// Replaces the content of the data block and keeps every other byte.
// The data block is located through the frame, not by searching for its
// tag: the kit's source contains that tag text too. No regex replacement
// is involved, so "$" in the data stays literal.
function splice(html, json) {
  if (typeof json !== 'string') throw new TypeError('The data must be a JSON string.');
  JSON.parse(json);
  const frame = parseDocument(html);
  if (!frame.ok) throw new Error('The file does not match the document frame.');
  return buildDocument({ ...frame.parts, data: escapeJson(json) });
}

// Replaces the kit and its version and keeps every other byte, through the
// frame like splice.
function replaceKit(html, kit) {
  const frame = parseDocument(html);
  if (!frame.ok) throw new Error('The file does not match the document frame.');
  return buildDocument({ ...frame.parts, kitVersion: kit.version, kit: kit.text });
}

// Fills in the document id when the file has none yet; a file that already
// has an id is returned unchanged. Works through the frame like splice.
function setDocId(html, docId) {
  if (typeof docId !== 'string' || !/^[0-9a-f]{32}$/.test(docId)) {
    throw new TypeError('A document id is 32 lowercase hex characters.');
  }
  const frame = parseDocument(html);
  if (!frame.ok) throw new Error('The file does not match the document frame.');
  if (frame.parts.docId) return html;
  return buildDocument({ ...frame.parts, docId });
}

module.exports = { escapeJson, splice, replaceKit, setDocId };
