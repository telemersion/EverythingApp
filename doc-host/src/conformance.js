'use strict';

const path = require('node:path');
const { parseDocument, lineOf } = require('./frame');
const { checkManifest } = require('./manifest');
const { findKit, sha256, MAX_API_VERSION } = require('../kit');

// The value may not contain quotes, so the kit's own source (which builds
// this tag from string pieces) never matches.
const API_META = /<meta name="ev-host-api" content="([^"']*)">/;

const FIELD_RULES = {
  lang: [/^[A-Za-z]{2,3}(-[A-Za-z0-9]+)*$/, 'a language tag such as "en" or "de-CH"'],
  docType: [/^[a-z0-9]+(-[a-z0-9]+)*$/, 'lowercase words joined by "-", such as "hours-sheet"'],
  docTypeVersion: [/^\d+(\.\d+)*$/, 'a version such as "1.0"'],
  docId: [/^([0-9a-f]{32})?$/, 'empty or 32 lowercase hex characters'],
  title: [/^[^<&\n]*$/, 'plain text without "<", "&" or line breaks'],
  kitVersion: [/^\d+\.\d+\.\d+$/, 'a kit version such as "1.0.0"'],
};

// fatal: invalid bytes throw instead of becoming U+FFFD. ignoreBOM: a BOM
// stays in the text, so the bom rule reports it.
const UTF8 = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });

// A file is a document if and only if it contains the ev-host-api meta tag.
// Takes text or the file's bytes (the tag is ASCII).
function isDocument(textOrBytes) {
  const marker = '<meta name="ev-host-api"';
  return typeof textOrBytes === 'string' ? textOrBytes.includes(marker) : Buffer.from(textOrBytes).includes(marker);
}

function problem(code, message, line) {
  return line ? { code, message, line } : { code, message };
}

function preview(text) {
  const firstLine = text.split('\n')[0];
  return JSON.stringify(firstLine.length > 60 ? firstLine.slice(0, 60) + '…' : firstLine);
}

// Checks a file against the document specification. Takes the file's bytes
// (as read from disk) or its text.
// Returns { ok, errors: [{ code, message, line? }], text?, parts?, api?, manifest? };
// text is the decoded file.
function checkDocument(input) {
  let html = input;
  if (typeof input !== 'string') {
    try {
      html = UTF8.decode(input);
    } catch {
      return {
        ok: false,
        errors: [problem('encoding', 'The file is not valid UTF-8 (it may be saved as Latin-1 or Windows-1252). Save it as UTF-8 without BOM.')],
      };
    }
  }
  const errors = [];

  if (html.charCodeAt(0) === 0xfeff) {
    errors.push(problem('bom', 'The file starts with a byte order mark. Save it as UTF-8 without BOM.', 1));
  }
  const cr = html.indexOf('\r');
  if (cr >= 0) {
    errors.push(problem('line-endings', 'The file contains CR characters. Documents use LF line endings only.', lineOf(html, cr)));
  }

  const apiMatch = API_META.exec(html);
  if (!apiMatch) {
    errors.push(problem('api-missing', 'The <meta name="ev-host-api"> tag is missing.'));
  } else if (!/^[1-9]\d*$/.test(apiMatch[1])) {
    errors.push(problem('api-invalid', `ev-host-api must be a positive whole number, found "${apiMatch[1]}".`));
  } else if (Number(apiMatch[1]) > MAX_API_VERSION) {
    return {
      ok: false,
      errors: [problem('api-newer',
        `This document needs a newer EverythingApp (API v${apiMatch[1]}). Update the host, or open it in Chrome.`)],
    };
  }

  // Keep checking a normalised copy, so one BOM or CRLF problem does not hide the rest.
  const text = html.replace(/^\ufeff/, '').replace(/\r\n?/g, '\n');
  const frame = parseDocument(text);
  if (!frame.ok) {
    errors.push(problem('frame',
      `The file does not match the document frame: expected ${preview(frame.expected)} ` +
      `but found ${preview(text.slice(frame.offset))}.`, lineOf(text, frame.offset)));
    return { ok: false, errors, text: html };
  }
  const parts = frame.parts;

  for (const [field, [rule, description]] of Object.entries(FIELD_RULES)) {
    if (!rule.test(parts[field])) {
      errors.push(problem('field', `The ${field} value ${JSON.stringify(parts[field])} is not ${description}.`));
    }
  }

  const kit = findKit(parts.kitVersion);
  if (!kit) {
    errors.push(problem('kit-unknown', `Kit ${parts.kitVersion} is not a published kit.`));
  } else if (sha256(parts.kit) !== kit.hash) {
    errors.push(problem('kit-modified', `The kit section was modified. It must be the exact text of published kit ${kit.version}.`));
  } else if (String(kit.api) !== parts.api) {
    errors.push(problem('kit-api', `Kit ${kit.version} belongs to API v${kit.api}, but the document declares API v${parts.api}.`));
  }

  const manifest = checkManifest(parts.manifest);
  errors.push(...manifest.errors);

  if (parts.data.includes('<')) {
    errors.push(problem('data-escape', 'The data block contains "<". Write every "<" in the data as \\u003c.'));
  }
  let data;
  try {
    data = JSON.parse(parts.data);
  } catch (err) {
    errors.push(problem('data-json', `The data block is not valid JSON: ${err.message}`));
  }
  if (data !== undefined && (data === null || typeof data !== 'object' || Array.isArray(data))) {
    errors.push(problem('data-shape', 'The data block must contain a JSON object.'));
  }

  if (parts.script.includes('<!--')) {
    errors.push(problem('script-comment', 'The script section contains "<!--", which changes how browsers parse it. Write "<\\!--" instead.'));
  }

  return { ok: errors.length === 0, errors, text: html, parts, api: Number(parts.api), manifest: manifest.manifest };
}

// The text shown in the refusal dialog and copied by "Copy report".
// context: 'open' (refused on open), 'open-document' (the file of an open
// document no longer conforms) or 'assemble' (tools/assemble.js refused).
const REPORT_HEADINGS = {
  open: (name) => `EverythingApp could not open ${name}.`,
  'open-document': (name) => `${name} no longer follows the document specification.`,
  assemble: (name) => `${name} was not written.`,
};

function formatReport(filePath, errors, { context = 'open' } = {}) {
  const heading = REPORT_HEADINGS[context];
  if (!heading) throw new Error(`Unknown report context: ${context}`);
  const lines = [
    heading(path.basename(filePath)),
    `File: ${filePath}`,
    '',
    'The file does not follow the EverythingApp document specification:',
    ...errors.map((e) => `- [${e.code}]${e.line ? ` line ${e.line}:` : ''} ${e.message}`),
    '',
    'You can still open the file in Chrome, where it saves through the browser fallback.',
  ];
  return lines.join('\n');
}

module.exports = { isDocument, checkDocument, formatReport };
