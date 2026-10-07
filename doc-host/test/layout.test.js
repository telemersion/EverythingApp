'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createModel, addTab, splitPane, setList } = require('../src/workspace-model');
const { METRICS, bannerRowHeight, computeLayout, neighbourPane } = require('../src/layout');

const W = { width: 1000, height: 700 };

function threeColumnsModel() {
  const m = splitPane(addTab(addTab(addTab(createModel(), 'a'), 'b'), 'c'), 'b', 'p1', 'right');
  return m;
}

function neighbourFixture() {
  // [p1 | (p2 / p4)]
  const m = splitPane(
    splitPane(addTab(addTab(addTab(createModel(), 'a'), 'b'), 'c'), 'b', 'p1', 'right'),
    'c', 'p2', 'bottom',
  );
  return computeLayout(m, W);
}

test('METRICS holds the M2 metrics', () => {
  assert.deepEqual(METRICS, { tabStrip: 32, banner: 36, moreBanners: 24, divider: 4 });
});

test('one pane: the list on the left, then tab strip, banner row and document', () => {
  const l = computeLayout(addTab(createModel(), 'a'), W);
  assert.deepEqual(l.list, { x: 0, y: 0, width: 240, height: 700 });
  assert.deepEqual(l.panes, [{ paneId: 'p1', tabStrip: { x: 240, y: 0, width: 760, height: 32 },
    banners: { x: 240, y: 32, width: 760, height: 0 }, document: { x: 240, y: 32, width: 760, height: 668 } }]);
  assert.deepEqual(l.dividers, []);
});

test('a hidden list gives the panes the whole width', () => {
  const m = setList(addTab(createModel(), 'a'), { visible: false });
  const l = computeLayout(m, W);
  assert.equal(l.list, null);
  assert.deepEqual(l.panes[0].tabStrip, { x: 0, y: 0, width: 1000, height: 32 });
  assert.deepEqual(l.panes[0].document, { x: 0, y: 32, width: 1000, height: 668 });
});

test('the list width follows the model', () => {
  const l = computeLayout(setList(addTab(createModel(), 'a'), { width: 300 }), W);
  assert.deepEqual(l.list, { x: 0, y: 0, width: 300, height: 700 });
  assert.deepEqual(l.panes[0].tabStrip, { x: 300, y: 0, width: 700, height: 32 });
});

test('banner rows push the document down', () => {
  const l = computeLayout(addTab(createModel(), 'a'), W, { bannerHeight: () => bannerRowHeight(2) });
  assert.deepEqual(l.panes[0].banners, { x: 240, y: 32, width: 760, height: 72 });
  assert.deepEqual(l.panes[0].document, { x: 240, y: 104, width: 760, height: 596 });
});

test('bannerHeight is asked per pane', () => {
  const m = splitPane(addTab(addTab(createModel(), 'a'), 'b'), 'b', 'p1', 'right');
  const l = computeLayout(m, W, { bannerHeight: (id) => (id === 'p2' ? 36 : 0) });
  assert.equal(l.panes[0].banners.height, 0);
  assert.equal(l.panes[1].banners.height, 36);
  assert.equal(l.panes[1].document.height, 700 - 32 - 36);
});

test('bannerRowHeight: 36 per banner up to 3, plus 24 for more', () => {
  assert.deepEqual([0, 1, 3, 4, 9].map(bannerRowHeight), [0, 36, 108, 132, 132]);
});

test('the document height is never negative', () => {
  const l = computeLayout(addTab(createModel(), 'a'), { width: 1000, height: 40 }, { bannerHeight: () => 132 });
  const p = l.panes[0];
  assert.equal(p.document.height, 0);
  assert.ok(p.banners.height >= 0);
  assert.equal(p.tabStrip.height + p.banners.height + p.document.height, 40);
});

test('a row split divides the width minus dividers, without gaps', () => {
  const m = splitPane(addTab(addTab(createModel(), 'a'), 'b'), 'b', 'p1', 'right');
  const l = computeLayout(m, W);
  assert.deepEqual(l.panes.map((p) => [p.tabStrip.x, p.tabStrip.width]), [[240, 378], [622, 378]]);
  assert.deepEqual(l.dividers, [{ splitId: 's3', index: 0, direction: 'row', rect: { x: 618, y: 0, width: 4, height: 700 } }]);
  assert.equal(378 + 4 + 378, 760);
});

test('a column split stacks panes with a divider spanning the width', () => {
  const m = splitPane(addTab(addTab(createModel(), 'a'), 'b'), 'b', 'p1', 'bottom');
  const l = computeLayout(m, W);
  assert.deepEqual(l.panes.map((p) => [p.tabStrip.y, p.tabStrip.height + p.banners.height + p.document.height]),
    [[0, 348], [352, 348]]);
  assert.deepEqual(l.dividers, [{ splitId: 's3', index: 0, direction: 'column', rect: { x: 240, y: 348, width: 760, height: 4 } }]);
});

test('odd sizes: the last child takes the remainder', () => {
  const base = threeColumnsModel();
  const pane = base.root.children[0];
  const three = { ...base, root: { ...base.root,
    children: [{ ...pane, id: 'p1' }, { ...pane, id: 'p2' }, { ...pane, id: 'p3' }],
    sizes: [1 / 3, 1 / 3, 1 / 3] } };
  const l = computeLayout(three, W);
  assert.deepEqual(l.panes.map((p) => p.tabStrip.width), [250, 250, 252]);
  assert.deepEqual(l.panes.map((p) => p.tabStrip.x), [240, 494, 748]);
  assert.deepEqual(l.dividers.map((d) => d.rect.x), [490, 744]);
  assert.deepEqual(l.dividers.map((d) => d.index), [0, 1]);
});

test('rectangles of nested splits tile the area exactly', () => {
  const l = neighbourFixture();
  const area = 760 * 700;
  let covered = 0;
  for (const p of l.panes) covered += p.tabStrip.width * (p.tabStrip.height + p.banners.height + p.document.height);
  for (const d of l.dividers) covered += d.rect.width * d.rect.height;
  assert.equal(covered, area);
  for (const p of l.panes) {
    for (const r of [p.tabStrip, p.banners, p.document]) {
      for (const v of Object.values(r)) assert.ok(Number.isInteger(v));
    }
  }
});

test('neighbourPane finds the pane in each direction', () => {
  const l = neighbourFixture();
  assert.deepEqual(l.panes.map((p) => p.paneId), ['p1', 'p2', 'p4']);
  // p2 and p4 are equally near and overlap p1 equally; ties go to the first in panesInOrder
  assert.equal(neighbourPane(l, 'p1', 'right'), 'p2');
  assert.equal(neighbourPane(l, 'p2', 'down'), 'p4');
  assert.equal(neighbourPane(l, 'p4', 'up'), 'p2');
  assert.equal(neighbourPane(l, 'p4', 'left'), 'p1');
  assert.equal(neighbourPane(l, 'p2', 'left'), 'p1');
  assert.equal(neighbourPane(l, 'p1', 'left'), null);
  assert.equal(neighbourPane(l, 'p2', 'right'), null);
  assert.equal(neighbourPane(l, 'p2', 'up'), null);
  assert.equal(neighbourPane(l, 'p1', 'down'), null);
  assert.equal(neighbourPane(l, 'nope', 'left'), null);
});

test('neighbourPane prefers the larger overlap, then the smaller gap', () => {
  const rect = (x, y, width, height) => ({ x, y, width, height });
  const pane = (paneId, x, y, w, h) => ({ paneId, tabStrip: rect(x, y, w, 32), banners: rect(x, y + 32, w, 0), document: rect(x, y + 32, w, h - 32) });
  // from a (0,0,100x100): b is nearer (gap 4) but overlaps 10; c has gap 4 and overlaps 80
  const l = { list: null, dividers: [], panes: [pane('a', 0, 0, 100, 100), pane('b', 104, 90, 100, 100), pane('c', 104, 0, 100, 80), pane('d', 300, 0, 100, 100)] };
  assert.equal(neighbourPane(l, 'a', 'right'), 'c');
  // gap beats a farther pane with a larger overlap
  const l2 = { list: null, dividers: [], panes: [pane('a', 0, 0, 100, 100), pane('far', 200, 0, 100, 100), pane('near', 104, 50, 100, 50)] };
  assert.equal(neighbourPane(l2, 'a', 'right'), 'near');
  // panes that only touch on the other axis do not overlap
  const l3 = { list: null, dividers: [], panes: [pane('a', 0, 0, 100, 100), pane('b', 104, 100, 100, 100)] };
  assert.equal(neighbourPane(l3, 'a', 'right'), null);
});
