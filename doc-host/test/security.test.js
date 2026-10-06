'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('preload and security.js insert the same no-subframe-input rule', () => {
  const { NO_IFRAME_INPUT } = require('../src/security');
  const preload = fs.readFileSync(path.join(__dirname, '../src/preload.js'), 'utf8');
  const match = /const NO_IFRAME_INPUT = '([^']*)';/.exec(preload);
  assert.ok(match, 'preload defines NO_IFRAME_INPUT');
  assert.equal(match[1], NO_IFRAME_INPUT);
  assert.match(NO_IFRAME_INPUT, /iframe, frame, frameset/);
});
