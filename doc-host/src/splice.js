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

module.exports = { escapeJson, splice };
