'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { newDocId } = require('../src/doc-id');

test('newDocId returns 32 lowercase hex characters, different each time', () => {
  const a = newDocId();
  assert.match(a, /^[0-9a-f]{32}$/);
  assert.notEqual(newDocId(), a);
});
