'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const W = require('../src/workspace-model');
const {
  createModel, addTab, selectTab, removeTab, moveTab, splitPane, canSplit, resizeSplit,
  focusPane, cycleTab, selectTabAt, setList, paneOf, findNode, panesInOrder, docsInOrder,
  activeDocId,
} = W;

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const key of Object.keys(value)) deepFreeze(value[key]);
  }
  return value;
}

function close(actual, expected) {
  assert.equal(actual.length, expected.length);
  actual.forEach((v, i) => assert.ok(Math.abs(v - expected[i]) < 1e-12, `${actual} vs ${expected}`));
}

// [p1 a | p2 b]
function twoPanes() {
  return splitPane(addTab(addTab(createModel(), 'a'), 'b'), 'b', 'p1', 'right');
}
// row [p1 a | p2 b | p4 c], p4 focused
function threePanes() {
  return splitPane(addTab(twoPanes(), 'c', { paneId: 'p2' }), 'c', 'p2', 'right');
}
// [p1 a | (p2 b / p4 c)]
function nested() {
  return splitPane(addTab(twoPanes(), 'c', { paneId: 'p2' }), 'c', 'p2', 'bottom');
}

test('a new model has one empty focused pane', () => {
  assert.deepEqual(createModel(), { root: { kind: 'pane', id: 'p1', tabs: [], selected: null },
    focusedPaneId: 'p1', nextId: 2, list: { visible: true, mode: 'list', width: 240 } });
});

test('addTab inserts right of the selected tab and selects it', () => {
  let m = addTab(addTab(createModel(), 'a'), 'b');
  m = addTab(selectTab(m, 'a'), 'c');
  assert.deepEqual(m.root.tabs, ['a', 'c', 'b']);
  assert.equal(m.root.selected, 'c');
});

test('addTab into another pane selects the tab and focuses that pane', () => {
  const m = addTab(twoPanes(), 'c', { paneId: 'p1' });
  assert.deepEqual(findNode(m, 'p1').tabs, ['a', 'c']);
  assert.equal(m.focusedPaneId, 'p1');
  assert.equal(findNode(m, 'p1').selected, 'c');
});

test('removeTab selects the right neighbour, else the left one', () => {
  let m = addTab(selectTab(addTab(addTab(createModel(), 'a'), 'b'), 'a'), 'c'); // a c b, c selected
  m = removeTab(m, 'c'); assert.equal(m.root.selected, 'b');
  m = removeTab(m, 'b'); assert.equal(m.root.selected, 'a');
  m = removeTab(m, 'a'); assert.deepEqual(m.root, { kind: 'pane', id: 'p1', tabs: [], selected: null }); // the last pane stays
});

test('removeTab of an unselected tab keeps the selection', () => {
  const m = removeTab(addTab(addTab(createModel(), 'a'), 'b'), 'a'); // a b, b selected
  assert.deepEqual(m.root.tabs, ['b']);
  assert.equal(m.root.selected, 'b');
});

test('splitPane right moves the document into a new pane beside it', () => {
  const m = splitPane(addTab(addTab(createModel(), 'a'), 'b'), 'b', 'p1', 'right');
  assert.deepEqual(m.root, { kind: 'split', id: 's3', direction: 'row', sizes: [0.5, 0.5], children: [
    { kind: 'pane', id: 'p1', tabs: ['a'], selected: 'a' },
    { kind: 'pane', id: 'p2', tabs: ['b'], selected: 'b' }] });
  assert.equal(m.focusedPaneId, 'p2');
  assert.equal(m.nextId, 4);
});

test('splitPane left, top and bottom put the new pane on the named edge', () => {
  const base = addTab(addTab(createModel(), 'a'), 'b');
  const left = splitPane(base, 'b', 'p1', 'left').root;
  assert.equal(left.direction, 'row');
  assert.deepEqual(left.children.map((n) => n.id), ['p2', 'p1']);
  const top = splitPane(base, 'b', 'p1', 'top').root;
  assert.equal(top.direction, 'column');
  assert.deepEqual(top.children.map((n) => n.id), ['p2', 'p1']);
  const bottom = splitPane(base, 'b', 'p1', 'bottom').root;
  assert.equal(bottom.direction, 'column');
  assert.deepEqual(bottom.children.map((n) => n.id), ['p1', 'p2']);
});

test('canSplit is false for the only tab of its own pane, and splitPane then changes nothing', () => {
  const m = addTab(createModel(), 'a');
  assert.equal(canSplit(m, 'a', 'p1'), false);
  assert.equal(splitPane(m, 'a', 'p1', 'right'), m);
});

test('canSplit is true with another tab, or for a tab of another pane', () => {
  const m = twoPanes(); // p1 a | p2 b
  assert.equal(canSplit(addTab(m, 'c', { paneId: 'p1' }), 'a', 'p1'), true);
  assert.equal(canSplit(m, 'a', 'p2'), true);
  assert.equal(canSplit(m, 'zz', 'p2'), false);
  assert.equal(canSplit(m, 'a', 'nope'), false);
});

test('splitting in the parent direction shares the target\'s size', () => {
  let m = splitPane(addTab(addTab(createModel(), 'a'), 'b'), 'b', 'p1', 'right'); // [p1 a | p2 b]
  m = splitPane(addTab(m, 'c', { paneId: 'p2' }), 'c', 'p2', 'right');
  assert.deepEqual(m.root.sizes, [0.5, 0.25, 0.25]);
  assert.deepEqual(m.root.children.map((n) => n.id), ['p1', 'p2', 'p4']);
  assert.equal(m.focusedPaneId, 'p4');
});

test('splitting across the parent direction nests a split', () => {
  let m = splitPane(addTab(addTab(createModel(), 'a'), 'b'), 'b', 'p1', 'right');
  m = splitPane(addTab(m, 'c', { paneId: 'p2' }), 'c', 'p2', 'bottom');
  assert.equal(m.root.children[1].kind, 'split');
  assert.equal(m.root.children[1].direction, 'column');
  assert.deepEqual(m.root.children[1].children.map((n) => n.id), ['p2', 'p4']);
  assert.deepEqual(m.root.children[1].sizes, [0.5, 0.5]);
  assert.deepEqual(m.root.sizes, [0.5, 0.5]); // the nested split keeps the target's slot size
});

test('splitPane with a tab of another pane removes it there first', () => {
  const m = splitPane(addTab(twoPanes(), 'c', { paneId: 'p1' }), 'b', 'p1', 'bottom'); // b dragged onto p1's bottom edge
  assert.equal(paneOf(m, 'b'), 'p4');
  assert.equal(findNode(m, 'p2'), null); // p2 emptied and vanished
  assert.equal(m.root.kind, 'split');
  assert.equal(m.root.direction, 'column');
  assert.deepEqual(m.root.children.map((n) => n.id), ['p1', 'p4']);
  assert.deepEqual(findNode(m, 'p1').tabs, ['a', 'c']);
  assert.equal(m.focusedPaneId, 'p4');
});

test('splitPane on the same pane takes the tab out of it', () => {
  const m = splitPane(addTab(addTab(createModel(), 'a'), 'b'), 'a', 'p1', 'left');
  assert.deepEqual(findNode(m, 'p1').tabs, ['b']);
  assert.deepEqual(findNode(m, 'p2').tabs, ['a']);
});

test('moving the last tab out of a pane removes the pane and collapses the split', () => {
  let m = splitPane(addTab(addTab(createModel(), 'a'), 'b'), 'b', 'p1', 'right');
  m = moveTab(m, 'b', 'p1', 0);
  assert.deepEqual(m.root, { kind: 'pane', id: 'p1', tabs: ['b', 'a'], selected: 'b' });
  assert.equal(m.focusedPaneId, 'p1');
});

test('moveTab within a pane reorders', () => {
  const m = moveTab(addTab(addTab(addTab(createModel(), 'a'), 'b'), 'c'), 'c', 'p1', 0);
  assert.deepEqual(m.root.tabs, ['c', 'a', 'b']);
  assert.equal(m.root.selected, 'c');
  assert.equal(m.focusedPaneId, 'p1');
});

test('moveTab to another pane selects the tab there and focuses that pane', () => {
  let m = addTab(twoPanes(), 'c', { paneId: 'p2' }); // p2: b c
  m = moveTab(m, 'c', 'p1', 1);
  assert.deepEqual(findNode(m, 'p1').tabs, ['a', 'c']);
  assert.equal(findNode(m, 'p1').selected, 'c');
  assert.deepEqual(findNode(m, 'p2').tabs, ['b']);
  assert.equal(m.focusedPaneId, 'p1');
});

test('moveTab clamps an integer index and refuses a non-integer one', () => {
  const m = addTab(addTab(addTab(createModel(), 'a'), 'b'), 'c');
  assert.deepEqual(moveTab(m, 'a', 'p1', 99).root.tabs, ['b', 'c', 'a']);
  assert.deepEqual(moveTab(m, 'c', 'p1', -5).root.tabs, ['c', 'a', 'b']);
  assert.equal(moveTab(m, 'a', 'p1', 1.5), m);
  assert.equal(moveTab(m, 'a', 'p1', NaN), m);
  assert.equal(moveTab(m, 'a', 'p1', '1'), m);
  assert.equal(moveTab(m, 'a', 'p1', undefined), m);
});

test('removing a focused pane focuses its next sibling', () => {
  let m = focusPane(threePanes(), 'p2'); // row [p1 | p2 | p4], p2 focused
  m = removeTab(m, 'b');
  assert.deepEqual(m.root.children.map((n) => n.id), ['p1', 'p4']);
  assert.equal(m.focusedPaneId, 'p4');
  close(m.root.sizes, [2 / 3, 1 / 3]);
});

test('removing a focused last pane focuses the previous sibling', () => {
  const m = removeTab(threePanes(), 'c'); // p4 focused and last
  assert.deepEqual(m.root.children.map((n) => n.id), ['p1', 'p2']);
  assert.equal(m.focusedPaneId, 'p2');
  close(m.root.sizes, [2 / 3, 1 / 3]);
});

test('focus moves to the first pane in order of a sibling split', () => {
  // row [p1 a | col (p2 b / p4 c)]; focus p1 and remove a: root collapses to the column
  const m = removeTab(focusPane(nested(), 'p1'), 'a');
  assert.equal(m.root.kind, 'split');
  assert.equal(m.root.direction, 'column');
  assert.equal(m.focusedPaneId, 'p2');
});

test('removing an unfocused pane keeps the focus', () => {
  const m = removeTab(threePanes(), 'a'); // p4 focused
  assert.equal(m.focusedPaneId, 'p4');
});

test('a split left with one child is replaced by that child, which keeps its slot and size', () => {
  // row [p1 | col (p2 / p4) ] plus a third row child so the slot size is visible
  let m = threePanes(); // sizes [0.5, 0.25, 0.25]
  m = splitPane(addTab(m, 'd', { paneId: 'p2' }), 'd', 'p2', 'bottom'); // p2 becomes col (p2 / p5), size 0.25
  assert.deepEqual(m.root.sizes, [0.5, 0.25, 0.25]);
  m = removeTab(m, 'd'); // p5 vanishes; the column collapses to p2
  assert.deepEqual(m.root.children.map((n) => n.id), ['p1', 'p2', 'p4']);
  assert.deepEqual(m.root.sizes, [0.5, 0.25, 0.25]);
});

test('a collapsed child that is a same-direction split is not merged into its grandparent', () => {
  // col (p1 a / row (p2 b | p4 c)) then removing a leaves the row as root; build deeper for a real nest:
  // root row [p1 | col (p2 | row-child)] by splitting p4 right inside the column.
  let m = nested(); // row [p1 | col (p2 b / p4 c)]
  m = splitPane(addTab(m, 'd', { paneId: 'p4' }), 'd', 'p4', 'right'); // col (p2 / row (p4 | p6)), ids p6 s7
  const column = m.root.children[1];
  assert.equal(column.children[1].kind, 'split');
  assert.equal(column.children[1].direction, 'row');
  m = removeTab(m, 'b'); // p2 vanishes: column collapses to the inner row, which now sits in the outer row
  assert.equal(m.root.kind, 'split');
  assert.equal(m.root.direction, 'row');
  assert.equal(m.root.children.length, 2);
  assert.equal(m.root.children[1].kind, 'split');
  assert.equal(m.root.children[1].direction, 'row');
  assert.deepEqual(m.root.children[1].children.map((n) => n.id), ['p4', 'p6']);
});

test('resizeSplit clamps to 0.05 and rescales; a wrong length changes nothing', () => {
  const m = twoPanes();
  close(resizeSplit(m, 's3', [0.01, 0.99]).root.sizes, [0.05 / 1.04, 0.99 / 1.04]);
  close(resizeSplit(m, 's3', [0.3, 0.3]).root.sizes, [0.5, 0.5]);
  assert.equal(resizeSplit(m, 's3', [1]), m);
  assert.equal(resizeSplit(m, 's3', [0.2, 0.3, 0.5]), m);
  assert.equal(resizeSplit(m, 'p1', [0.5, 0.5]), m);
  assert.equal(resizeSplit(m, 'nope', [0.5, 0.5]), m);
  assert.equal(resizeSplit(m, 's3', [0.5, 'x']), m);
});

test('focusPane focuses a pane and refuses unknown ids and split ids', () => {
  const m = twoPanes();
  assert.equal(focusPane(m, 'p1').focusedPaneId, 'p1');
  assert.equal(focusPane(m, 'nope'), m);
  assert.equal(focusPane(m, 's3'), m);
});

test('selectTab selects the tab and focuses its pane', () => {
  const m = selectTab(twoPanes(), 'a');
  assert.equal(m.focusedPaneId, 'p1');
  assert.equal(activeDocId(m), 'a');
  assert.equal(selectTab(m, 'zz'), m);
});

test('cycleTab wraps and selectTabAt picks by position in the focused pane', () => {
  const m = addTab(addTab(addTab(createModel(), 'a'), 'b'), 'c'); // a b c, c selected
  assert.equal(cycleTab(m, 1).root.selected, 'a');
  assert.equal(cycleTab(m, -1).root.selected, 'b');
  assert.equal(selectTabAt(m, 0).root.selected, 'a');
  assert.equal(selectTabAt(m, 5), m);
});

test('cycleTab on an empty pane, and selectTabAt out of range, change nothing', () => {
  const m = createModel();
  assert.equal(cycleTab(m, 1), m);
  assert.equal(selectTabAt(m, 0), m);
  const n = addTab(m, 'a');
  assert.equal(selectTabAt(n, -1), n);
  assert.equal(selectTabAt(n, 0.5), n);
});

test('cycleTab and selectTabAt work in the focused pane only', () => {
  const m = addTab(twoPanes(), 'c', { paneId: 'p2' }); // p2 focused: b c
  assert.equal(findNode(cycleTab(m, 1), 'p2').selected, 'b');
  assert.equal(findNode(selectTabAt(m, 0), 'p2').selected, 'b');
  assert.equal(findNode(selectTabAt(m, 0), 'p1').selected, 'a');
});

test('setList clamps the width to 160-480 and keeps the other fields', () => {
  const m = setList(createModel(), { mode: 'thumbnails' });
  assert.equal(setList(m, { width: 1000 }).list.width, 480);
  assert.equal(setList(m, { width: 10 }).list.width, 160);
  assert.deepEqual(setList(m, { width: 300 }).list, { visible: true, mode: 'thumbnails', width: 300 });
  assert.deepEqual(setList(m, { visible: false }).list, { visible: false, mode: 'thumbnails', width: 240 });
  assert.deepEqual(setList(m, { mode: 'list' }).list, { visible: true, mode: 'list', width: 240 });
});

test('panesInOrder and docsInOrder go left to right, top to bottom', () => {
  const m = nested();
  assert.deepEqual(panesInOrder(m).map((p) => p.id), ['p1', 'p2', 'p4']);
  assert.deepEqual(docsInOrder(m), ['a', 'b', 'c']);
});

test('paneOf, findNode and activeDocId look things up', () => {
  const m = nested(); // p4 focused, c selected
  assert.equal(paneOf(m, 'b'), 'p2');
  assert.equal(paneOf(m, 'zz'), null);
  assert.equal(findNode(m, 'p4').tabs[0], 'c');
  assert.equal(findNode(m, 's3').kind, 'split');
  assert.equal(findNode(m, 'zz'), null);
  assert.equal(activeDocId(m), 'c');
  assert.equal(activeDocId(createModel()), null);
});

test('calls with unknown ids, or that are not allowed, return the same object', () => {
  const m = twoPanes();
  assert.equal(addTab(m, 'a'), m);            // already open
  assert.equal(addTab(m, 'z', { paneId: 'nope' }), m);
  assert.equal(addTab(m, 'z', { paneId: 's3' }), m); // a split id where a pane id is needed
  assert.equal(selectTab(m, 'zz'), m);
  assert.equal(removeTab(m, 'zz'), m);
  assert.equal(moveTab(m, 'zz', 'p1', 0), m);
  assert.equal(moveTab(m, 'a', 'nope', 0), m);
  assert.equal(moveTab(m, 'a', 's3', 0), m);
  assert.equal(splitPane(m, 'zz', 'p1', 'right'), m);
  assert.equal(splitPane(m, 'a', 'nope', 'right'), m);
  assert.equal(splitPane(m, 'a', 's3', 'right'), m);
  assert.equal(splitPane(m, 'a', 'p2', 'diagonal'), m);
});

test('no function mutates its input', () => {
  const m = addTab(nested(), 'd', { paneId: 'p1' });
  const snapshot = JSON.parse(JSON.stringify(m));
  deepFreeze(m);
  const calls = [
    () => addTab(m, 'x'), () => addTab(m, 'x', { paneId: 'p2' }),
    () => selectTab(m, 'b'), () => removeTab(m, 'a'), () => removeTab(m, 'b'),
    () => moveTab(m, 'a', 'p2', 0), () => moveTab(m, 'b', 'p1', 1),
    () => splitPane(m, 'a', 'p2', 'left'), () => splitPane(m, 'd', 'p1', 'bottom'),
    () => canSplit(m, 'a', 'p1'),
    () => resizeSplit(m, 's3', [0.3, 0.7]), () => focusPane(m, 'p2'),
    () => cycleTab(m, 1), () => cycleTab(m, -1), () => selectTabAt(m, 1),
    () => setList(m, { visible: false, mode: 'thumbnails', width: 300 }),
    () => paneOf(m, 'a'), () => findNode(m, 'p2'), () => panesInOrder(m),
    () => docsInOrder(m), () => activeDocId(m),
  ];
  for (const call of calls) assert.doesNotThrow(call);
  assert.deepEqual(m, snapshot);
});
