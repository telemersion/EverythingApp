'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { validateSnapshot } = require('../src/validate');

test('accepts a JSON object', () => {
  assert.equal(validateSnapshot('{"rows":[]}'), null);
});

test('rejects non-strings, invalid JSON and non-objects', () => {
  assert.match(validateSnapshot(undefined), /no data/);
  assert.match(validateSnapshot('{nope'), /invalid JSON/);
  assert.match(validateSnapshot('[1,2]'), /JSON object/);
  assert.match(validateSnapshot('null'), /JSON object/);
});

test('rejects data over the size limit', () => {
  assert.match(validateSnapshot('{"a":"xxxxxxxxxx"}', 10), /larger than/);
});
