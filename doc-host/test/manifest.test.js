'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { checkManifest } = require('../src/manifest');

const codes = (text) => checkManifest(text).errors.map((e) => e.code);

test('valid manifests pass and return the parsed object', () => {
  assert.deepEqual(checkManifest('{}'), { manifest: {}, errors: [] });
  assert.deepEqual(checkManifest('{"textFields":["rows.*.note","intro"]}'),
    { manifest: { textFields: ['rows.*.note', 'intro'] }, errors: [] });
  assert.deepEqual(checkManifest('{"textFields":[]}').errors, []);
  assert.deepEqual(checkManifest('{"textFields":["_a.b_2.*"]}').errors, []);
});

test('a raw < is manifest-escape', () => {
  assert.deepEqual(codes('{"textFields":["a<b"]}'), ['manifest-escape']);
});

test('invalid JSON or a non-object is manifest-json', () => {
  for (const text of ['{', '[]', 'null', '"x"', '']) assert.deepEqual(codes(text), ['manifest-json'], text);
});

test('an unknown key is manifest-key and names the key', () => {
  const { errors } = checkManifest('{"textfields":[]}');
  assert.deepEqual(errors.map((e) => e.code), ['manifest-key']);
  assert.match(errors[0].message, /"textfields"/);
});

test('a wrong value or an invalid or repeated pattern is manifest-invalid', () => {
  for (const value of ['"rows.*.note"', '[1]', '["rows..note"]', '["rows.*-x"]', '["1abc"]', '[""]', '["a.b","a.b"]', '["rows.**"]', '[".a"]']) {
    assert.deepEqual(codes(`{"textFields":${value}}`), ['manifest-invalid'], value);
  }
});
