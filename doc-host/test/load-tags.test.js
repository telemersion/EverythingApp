'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { LoadTags } = require('../src/load-tags');

test('messages count only from the current, announced load', () => {
  const tags = new LoadTags();
  assert.equal(tags.accepts('a'), false);            // no hello yet
  assert.equal(tags.hello('a'), true);
  assert.equal(tags.accepts('a'), true);
  tags.begin();                                      // reload starts
  assert.equal(tags.accepts('a'), false);
  assert.equal(tags.hello('a'), false, 'a retired load cannot come back');
  assert.equal(tags.hello('b'), true);
  assert.equal(tags.accepts('b'), true);
});

test('a new announcement replaces the current load', () => {
  const tags = new LoadTags();
  tags.hello('a');
  assert.equal(tags.hello('b'), true);
  assert.equal(tags.accepts('a'), false);
  assert.equal(tags.accepts('b'), true);
  assert.equal(tags.hello('a'), false, 'the replaced load is retired');
});

test('only string ids count', () => {
  const tags = new LoadTags();
  for (const id of [undefined, null, 1, {}]) {
    assert.equal(tags.hello(id), false);
    assert.equal(tags.accepts(id), false);
  }
});
