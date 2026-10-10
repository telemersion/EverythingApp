'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { parseIntent, intentIds, MAX_OPEN_FILES } = require('../src/ui-intents');
const { createModel, addTab, splitPane } = require('../src/workspace-model');

const ids = { docIds: new Set(['d1']), paneIds: new Set(['p1']), splitIds: new Set(['s3']) };

test('valid intents pass', () => {
  assert.deepEqual(parseIntent({ type: 'select', docId: 'd1' }, ids), { type: 'select', docId: 'd1' });
  assert.deepEqual(parseIntent({ type: 'list', width: 300 }, ids), { type: 'list', width: 300 });
});

test('unknown ids, types and extra shapes are refused', () => {
  for (const p of [null, 'x', { type: 'select', docId: 'nope' }, { type: 'eval' }, { type: 'open-files', paths: ['rel.html'] },
    { type: 'banner', docId: 'd1', kind: 'kit-update', action: 'x'.repeat(33) }, { type: 'resize-split', splitId: 's3', sizes: [NaN, 1] }]) {
    assert.equal(parseIntent(p, ids), null, JSON.stringify(p));
  }
});

test('every intent type in its valid shape', () => {
  const valid = [
    { type: 'select', docId: 'd1' },
    { type: 'close', docId: 'd1' },
    { type: 'banner', docId: 'd1', kind: 'updated-while-dirty', action: 'discard-reload' },
    { type: 'banner', docId: 'd1', kind: 'kit-updated', action: 'undo-kit' },
    { type: 'banner', docId: 'd1', kind: 'updated-from-disk', action: 'dismiss' },
    { type: 'open-dialog' },
    { type: 'open-files', paths: ['/tmp/a.ev.html', '/tmp/b.ev.html'] },
    { type: 'list' },
    { type: 'list', visible: false },
    { type: 'list', mode: 'thumbnails' },
    { type: 'list', visible: true, mode: 'list', width: 212.5 },
    { type: 'resize-split', splitId: 's3', sizes: [0.25, 0.75] },
    { type: 'move-tab', docId: 'd1', paneId: 'p1', index: 0 },
    { type: 'move-tab', docId: 'd1', paneId: 'p1', index: 7 },
    { type: 'split', docId: 'd1', paneId: 'p1', edge: 'left' },
    { type: 'split', docId: 'd1', paneId: 'p1', edge: 'right' },
    { type: 'split', docId: 'd1', paneId: 'p1', edge: 'top' },
    { type: 'split', docId: 'd1', paneId: 'p1', edge: 'bottom' },
    { type: 'drag', active: true },
    { type: 'drag', active: false },
    { type: 'notice', kind: 'restore', action: 'dismiss' },
    { type: 'notice', kind: 'update', action: 'dismiss' },
    { type: 'notice', kind: 'update', action: 'restart' },
  ];
  for (const p of valid) assert.deepEqual(parseIntent(p, ids), p, JSON.stringify(p));
});

test('the intent is a new object made of the checked fields only', () => {
  const payload = { type: 'open-files', paths: ['/tmp/a.ev.html'] };
  const intent = parseIntent(payload, ids);
  assert.notEqual(intent, payload);
  assert.notEqual(intent.paths, payload.paths);
});

test('fields a type does not have are refused', () => {
  for (const p of [
    { type: 'select', docId: 'd1', paneId: 'p1' },
    { type: 'open-dialog', paneId: 'p1' },
    { type: 'notice', kind: 'update', action: 'dismiss', version: '1' },
    { type: 'list', width: 300, height: 10 },
    { type: 'drag', active: true, docId: 'd1' },
  ]) {
    assert.equal(parseIntent(p, ids), null, JSON.stringify(p));
  }
});

test('bad values for each type are refused', () => {
  const bad = [
    { type: 'dismiss-notice' },
    { type: 'notice', kind: 'restore', action: 'restart' },
    { type: 'notice', kind: 'other', action: 'dismiss' },
    { type: 'notice', kind: 'update' },
    { type: 'notice', kind: 'update', action: 'install' },
    [], 42, true, { docId: 'd1' }, { type: 7 }, { type: 'SELECT', docId: 'd1' },
    { type: 'select' }, { type: 'close', docId: 1 }, { type: 'close', docId: 'p1' },
    { type: 'banner', docId: 'd1', kind: 'nope', action: 'dismiss' },
    { type: 'banner', docId: 'd1', kind: 'kit-update' },
    { type: 'banner', docId: 'd1', kind: 'kit-update', action: '' },
    { type: 'banner', docId: 'd1', kind: 'kit-update', action: 'Update' },
    { type: 'banner', docId: 'd1', kind: 'kit-update', action: 'update_kit' },
    { type: 'banner', docId: 'nope', kind: 'kit-update', action: 'update-kit' },
    { type: 'banner', docId: 'd1', kind: 'constructor', action: 'dismiss' },
    { type: 'open-files' },
    { type: 'open-files', paths: [] },
    { type: 'open-files', paths: '/tmp/a.ev.html' },
    { type: 'open-files', paths: [42] },
    { type: 'open-files', paths: [''] },
    { type: 'open-files', paths: ['/tmp/a\0.ev.html'] },
    { type: 'open-files', paths: Array.from({ length: MAX_OPEN_FILES + 1 }, (_, i) => `/tmp/${i}.ev.html`) },
    { type: 'list', visible: 'yes' },
    { type: 'list', mode: 'grid' },
    { type: 'list', width: Infinity },
    { type: 'list', width: '300' },
    { type: 'resize-split', splitId: 'nope', sizes: [0.5, 0.5] },
    { type: 'resize-split', splitId: 's3', sizes: [1] },
    { type: 'resize-split', splitId: 's3', sizes: [0.5, -0.5] },
    { type: 'resize-split', splitId: 's3', sizes: [0.5, '0.5'] },
    { type: 'resize-split', splitId: 's3', sizes: 'half' },
    { type: 'move-tab', docId: 'd1', paneId: 'p1', index: -1 },
    { type: 'move-tab', docId: 'd1', paneId: 'p1', index: 1.5 },
    { type: 'move-tab', docId: 'd1', paneId: 'p1' },
    { type: 'move-tab', docId: 'd1', paneId: 'p9', index: 0 },
    { type: 'split', docId: 'd1', paneId: 'p1', edge: 'middle' },
    { type: 'split', docId: 'd1', paneId: 's3', edge: 'top' },
    { type: 'drag', active: 'true' },
    { type: 'drag' },
  ];
  for (const p of bad) assert.equal(parseIntent(p, ids), null, JSON.stringify(p));
});

test('exactly MAX_OPEN_FILES paths are accepted', () => {
  const paths = Array.from({ length: MAX_OPEN_FILES }, (_, i) => `/tmp/${i}.ev.html`);
  assert.equal(MAX_OPEN_FILES, 100);
  assert.deepEqual(parseIntent({ type: 'open-files', paths }, ids), { type: 'open-files', paths });
});

test('intentIds names the open documents, panes and splits of a model', () => {
  // split s3: [p1: a | p2: b]
  const model = splitPane(addTab(addTab(createModel(), 'a'), 'b'), 'b', 'p1', 'right');
  const { docIds, paneIds, splitIds } = intentIds(model);
  assert.deepEqual([...docIds].sort(), ['a', 'b']);
  assert.deepEqual([...paneIds].sort(), ['p1', 'p2']);
  assert.deepEqual([...splitIds], ['s3']);
  assert.deepEqual(intentIds(createModel()), { docIds: new Set(), paneIds: new Set(['p1']), splitIds: new Set() });
});

test('the host-UI preload splits drops by the same MAX_OPEN_FILES', () => {
  const preload = require('node:fs').readFileSync(require('node:path').join(__dirname, '../src/ui-preload.js'), 'utf8');
  const match = /const MAX_OPEN_FILES = (\d+);/.exec(preload);
  assert.ok(match, 'ui-preload defines MAX_OPEN_FILES');
  assert.equal(Number(match[1]), MAX_OPEN_FILES);
});

test('move-tab, split and drag intents', () => {
  assert.deepEqual(parseIntent({ type: 'split', docId: 'd1', paneId: 'p1', edge: 'top' }, ids), { type: 'split', docId: 'd1', paneId: 'p1', edge: 'top' });
  assert.equal(parseIntent({ type: 'split', docId: 'd1', paneId: 'p1', edge: 'middle' }, ids), null);
  assert.equal(parseIntent({ type: 'move-tab', docId: 'd1', paneId: 'p1', index: -1 }, ids), null);
  assert.equal(parseIntent({ type: 'move-tab', docId: 'd1', paneId: 'p1', index: 1.5 }, ids), null);
  assert.equal(parseIntent({ type: 'drag', active: 1 }, ids), null);
  assert.deepEqual(parseIntent({ type: 'drag', active: true }, ids), { type: 'drag', active: true });
});
