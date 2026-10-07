'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { documentLabels } = require('../src/labels');

test('labels are file names, with the folder when names collide', () => {
  assert.deepEqual(Object.fromEntries(documentLabels(['/a/x.ev.html', '/b/x.ev.html', '/a/y.ev.html'])),
    { '/a/x.ev.html': 'x.ev.html · a', '/b/x.ev.html': 'x.ev.html · b', '/a/y.ev.html': 'y.ev.html' });
});

test('labels fall back to the full folder when folder names collide too', () => {
  const l = documentLabels(['/p/a/x.ev.html', '/q/a/x.ev.html', '/r/x.ev.html']);
  assert.deepEqual([...l.values()], ['x.ev.html · /p/a', 'x.ev.html · /q/a', 'x.ev.html · r']);
});

test('a file directly in the root uses the full parent path', () => {
  const l = documentLabels(['/x.ev.html', '/a/x.ev.html']);
  assert.deepEqual([...l.values()], ['x.ev.html · /', 'x.ev.html · a']);
});

test('no paths, no labels', () => {
  assert.equal(documentLabels([]).size, 0);
});
