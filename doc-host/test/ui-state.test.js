'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { buildUiState, NOTICE_MESSAGE } = require('../src/ui-state');
const { createModel, addTab, splitPane, setList } = require('../src/workspace-model');
const { computeLayout } = require('../src/layout');
const { emptyStatus } = require('../src/status');

const SIZE = { width: 1000, height: 700 };

function stateOf(model, documents, { notices = [] } = {}) {
  return buildUiState({ model, layout: computeLayout(model, SIZE), documents, notices, platform: 'darwin' });
}

test('the state names panes, tabs and banners from the model and statuses', () => {
  const model = addTab(addTab(createModel(), 'd1'), 'd2');
  const documents = [
    { id: 'd1', path: '/a/x.ev.html', docType: 'note', status: { ...emptyStatus(), dirty: true, kitUpdate: { from: '1.0.0', to: '1.1.0' } } },
    { id: 'd2', path: '/b/x.ev.html', docType: 'note', status: emptyStatus() },
  ];
  const layout = computeLayout(model, SIZE);
  const state = buildUiState({ model, layout, documents, notices: [], platform: 'darwin' });
  assert.deepEqual(state.panes, [{
    paneId: 'p1',
    focused: true,
    selected: 'd2',
    tabs: [
      { docId: 'd1', label: 'x.ev.html · a', path: '/a/x.ev.html', dirty: true, badge: 'kit-update' },
      { docId: 'd2', label: 'x.ev.html · b', path: '/b/x.ev.html', dirty: false, badge: null },
    ],
  }]);
  assert.equal(state.documents.d1.banners[0].kind, 'kit-update');
  assert.equal(state.documents.d1.banners[0].message, 'This document uses kit 1.0.0; 1.1.0 is available.');
  assert.deepEqual(state.documents.d1.badges, ['kit-update']);
  assert.deepEqual(state.documents.d2, {
    label: 'x.ev.html · b', path: '/b/x.ev.html', docType: 'note', dirty: false, badges: [], banners: [],
  });
  assert.equal(state.empty, false);
  assert.equal(state.layout, layout);
  assert.deepEqual(state.list, model.list);
  assert.equal(state.platform, 'darwin');
  assert.deepEqual(state.notices, []);
});

test('an empty workspace says so', () => {
  const state = stateOf(createModel(), []);
  assert.equal(state.empty, true);
  assert.deepEqual(state.panes, [{ paneId: 'p1', focused: true, selected: null, tabs: [] }]);
  assert.deepEqual(state.documents, {});
});

test('the restore notice uses labels and reasons', () => {
  const state = stateOf(createModel(), [], { notices: [{ kind: 'restore', failed: [{ path: '/a/gone.ev.html', reason: 'moved or deleted' }] }] });
  assert.deepEqual(state.notices, [{
    kind: 'restore',
    message: 'Some documents from your last session could not be opened:',
    items: [{ label: 'gone.ev.html', reason: 'moved or deleted' }],
    actions: [{ id: 'dismiss', label: 'OK' }],
  }]);
  assert.equal(NOTICE_MESSAGE, state.notices[0].message);
});

test('notice items that share a file name name their folder', () => {
  const state = stateOf(createModel(), [], {
    notices: [{ kind: 'restore', failed: [{ path: '/a/x.ev.html', reason: 'moved or deleted' }, { path: '/b/x.ev.html', reason: 'not an EverythingApp document' }] }],
  });
  assert.deepEqual(state.notices[0].items, [
    { label: 'x.ev.html · a', reason: 'moved or deleted' },
    { label: 'x.ev.html · b', reason: 'not an EverythingApp document' },
  ]);
});

test('the update notice offers Restart Now and Later, after the restore notice', () => {
  const state = stateOf(createModel(), [], {
    notices: [
      { kind: 'update', version: '0.2.0' },
      { kind: 'restore', failed: [{ path: '/a/gone.ev.html', reason: 'moved or deleted' }] },
    ],
  });
  assert.deepEqual(state.notices.map((n) => n.kind), ['restore', 'update']);
  assert.deepEqual(state.notices[1], {
    kind: 'update',
    message: 'EverythingApp 0.2.0 is ready. It installs when you quit.',
    items: [],
    actions: [{ id: 'restart', label: 'Restart Now' }, { id: 'dismiss', label: 'Later' }],
  });
});

test('a restore notice without failures is not shown', () => {
  assert.deepEqual(stateOf(createModel(), [], { notices: [{ kind: 'restore', failed: [] }] }).notices, []);
});

test('panes come in tree order with focus and selection; the badge is the most urgent', () => {
  // split s3: [p1: a, b | p2: c], c focused
  const model = splitPane(addTab(addTab(addTab(createModel(), 'a'), 'b'), 'c'), 'c', 'p1', 'right');
  const status = (patch) => ({ ...emptyStatus(), ...patch });
  const state = stateOf(model, [
    { id: 'a', path: '/d/a.ev.html', docType: 't', status: status({ missing: true, kitUpdate: { from: '1.0.0', to: '1.1.0' } }) },
    { id: 'b', path: '/d/b.ev.html', docType: 't', status: status({}) },
    { id: 'c', path: '/d/c.ev.html', docType: 't', status: status({ updatedWhileDirty: true, dirty: true }) },
  ]);
  assert.deepEqual(state.panes.map((p) => [p.paneId, p.focused, p.selected, p.tabs.map((t) => t.docId)]),
    [['p1', false, 'b', ['a', 'b']], ['p2', true, 'c', ['c']]]);
  assert.equal(state.panes[0].tabs[0].badge, 'missing');
  assert.deepEqual(state.documents.a.badges, ['missing', 'kit-update']);
  assert.deepEqual(state.documents.c.banners.map((b) => b.kind), ['updated-while-dirty']);
  assert.equal(state.documents.c.dirty, true);
});

test('a tab without a document is left out', () => {
  const model = addTab(addTab(createModel(), 'a'), 'ghost');
  const state = stateOf(model, [{ id: 'a', path: '/d/a.ev.html', docType: 't', status: emptyStatus() }]);
  assert.deepEqual(state.panes[0].tabs.map((t) => t.docId), ['a']);
  assert.deepEqual(Object.keys(state.documents), ['a']);
});

test('splits carry their direction, sizes and the pixels the sizes share', () => {
  // List 240 of 1000: the row split spans 760 px, one 4 px divider → 756 to share.
  const model = splitPane(addTab(addTab(createModel(), 'a'), 'b'), 'b', 'p1', 'right');
  const state = stateOf(model, []);
  assert.deepEqual(state.splits, { s3: { direction: 'row', sizes: [0.5, 0.5], available: 756 } });
  // A column split inside the right pane: 700 px high, 696 to share.
  const nested = splitPane(addTab(model, 'c', { paneId: 'p2' }), 'c', 'p2', 'bottom');
  const inner = Object.entries(stateOf(nested, []).splits).find(([, s]) => s.direction === 'column');
  assert.deepEqual(inner[1], { direction: 'column', sizes: [0.5, 0.5], available: 696 });
  // No list: the row split spans the whole width.
  assert.equal(stateOf(setList(model, { visible: false }), []).splits.s3.available, 996);
  assert.deepEqual(stateOf(createModel(), []).splits, {});
});
