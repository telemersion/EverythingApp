'use strict';

const path = require('node:path');
const { parseDocument, lineOf } = require('./frame');
const { findKit, sha256, MAX_API_VERSION } = require('../kit');

// The value may not contain quotes, so the kit's own source (which builds
// this tag from string pieces) never matches.
const API_META = /<meta name="ev-host-api" content="([^"']*)">/;

const FIELD_RULES = {
  lang: [/^[A-Za-z]{2,3}(-[A-Za-z0-9]+)*$/, 'a language tag such as "en" or "de-CH"'],
  docType: [/^[a-z0-9]+(-[a-z0-9]+)*$/, 'lowercase words joined by "-", such as "hours-sheet"'],
  docTypeVersion: [/^\d+(\.\d+)*$/, 'a version such as "1.0"'],
  title: [/^[^<&\n]*$/, 'plain text without "<", "&" or line breaks'],
  kitVersion: [/^\d+\.\d+\.\d+$/, 'a kit version such as "1.0.0"'],
};

// A file is a document if and only if it contains the ev-host-api meta tag.
function isDocument(text) {
  return /<meta name="ev-host-api"/.test(text);
}

function problem(code, message, line) {
  return line ? { code, message, line } : { code, message };
}

function preview(text) {
  const firstLine = text.split('\n')[0];
  return JSON.stringify(firstLine.length > 60 ? firstLine.slice(0, 60) + '…' : firstLine);
}

// Checks a file against the document specification.
// Returns { ok, errors: [{ code, message, line? }], parts?, api? }.
function checkDocument(html) {
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
  const text = html.replace(/^﻿/, '').replace(/\r\n?/g, '\n');
  const frame = parseDocument(text);
  if (!frame.ok) {
    errors.push(problem('frame',
      `The file does not match the document frame: expected ${preview(frame.expected)} ` +
      `but found ${preview(text.slice(frame.offset))}.`, lineOf(text, frame.offset)));
    return { ok: false, errors };
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

  return { ok: errors.length === 0, errors, parts, api: Number(parts.api) };
}

// The text shown in the refusal dialog and copied by "Copy report".
function formatReport(filePath, errors) {
  const lines = [
    `EverythingApp could not open ${path.basename(filePath)}.`,
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
