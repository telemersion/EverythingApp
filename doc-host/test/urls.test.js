'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { originFor, isDocumentUrl, isAllowedRequest } = require('../src/urls');

const origin = originFor('0123abcd');

test('originFor builds an ev-doc origin', () => {
  assert.equal(origin, 'ev-doc://0123abcd');
});

test('only the document URL itself is served', () => {
  assert.equal(isDocumentUrl('ev-doc://0123abcd/', origin), true);
  assert.equal(isDocumentUrl('ev-doc://0123abcd/other.html', origin), false);
  assert.equal(isDocumentUrl('ev-doc://0123abcd/?x=1', origin), false);
  assert.equal(isDocumentUrl('ev-doc://ffff/', origin), false);
});

test('a document session may only request its own origin, data: and blob:', () => {
  assert.equal(isAllowedRequest('ev-doc://0123abcd/', origin), true);
  assert.equal(isAllowedRequest('data:image/png;base64,AAAA', origin), true);
  assert.equal(isAllowedRequest('blob:ev-doc://0123abcd/5f2c', origin), true);
  for (const url of ['https://example.com/', 'http://localhost/', 'file:///etc/hosts', 'ev-doc://ffff/', 'ws://x/']) {
    assert.equal(isAllowedRequest(url, origin), false, url);
  }
});
