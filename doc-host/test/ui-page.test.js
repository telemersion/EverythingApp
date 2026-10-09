'use strict';

// The host-UI page (src/ui) rendered in jsdom from states made by
// buildUiState: what it draws, that document-derived strings stay text, and
// the intents it sends.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const { buildUiState } = require('../src/ui-state');
const { createModel, addTab, splitPane, selectTab } = require('../src/workspace-model');
const { computeLayout, bannerRowHeight } = require('../src/layout');
const { emptyStatus, describeStatus } = require('../src/status');

const UI = path.join(__dirname, '..', 'src', 'ui');
const read = (name) => fs.readFileSync(path.join(UI, name), 'utf8');
const SIZE = { width: 1000, height: 700 };
const EVIL = '<img src=x onerror="window.pwned=1">.ev.html';

// The page with a stub window.evUi; render(state) pushes a state.
function loadPage() {
  const dom = new JSDOM(read('index.html'), { runScripts: 'outside-only', url: 'ev-ui://host/index.html' });
  const { window } = dom;
  const sent = [];
  let onState = null;
  window.evUi = { onState: (cb) => { onState = cb; }, onThumbnail: () => {}, send: (intent) => sent.push(JSON.parse(JSON.stringify(intent))) }; // a copy, as over IPC
  window.eval(read('ui.js'));
  assert.equal(typeof onState, 'function', 'ui.js listens for states');
  return { window, document: window.document, sent, render: (state) => onState(state) };
}

function stateOf(model, documents, { notice = null } = {}) {
  const byId = new Map(documents.map((d) => [d.id, d]));
  const bannerHeight = (paneId) => {
    const pane = findPane(model, paneId);
    const doc = pane && byId.get(pane.selected);
    return doc ? bannerRowHeight(describeStatus(doc.status, { name: path.basename(doc.path), filePath: doc.path }).banners.length) : 0;
  };
  return buildUiState({ model, layout: computeLayout(model, SIZE, { bannerHeight }), documents, notice, platform: 'darwin' });
}

function findPane(model, paneId) {
  const walk = (node) => (node.id === paneId ? node : node.kind === 'split' ? node.children.map(walk).find(Boolean) : null);
  return walk(model.root);
}

const status = (patch) => ({ ...emptyStatus(), ...patch });

// split s3: [p1: a (dirty, kit update), b | p2: c (four banners)], a selected and focused.
function twoPanes() {
  let model = splitPane(addTab(addTab(addTab(createModel(), 'a'), 'b'), 'c'), 'c', 'p1', 'right');
  model = selectTab(model, 'a');
  return stateOf(model, [
    { id: 'a', path: `/docs/${EVIL}`, docType: 'note', status: status({ dirty: true, kitUpdate: { from: '1.0.0', to: '1.1.0' } }) },
    { id: 'b', path: '/docs/<b>bold.ev.html', docType: 'note', status: status({}) },
    { id: 'c', path: '/docs/c.ev.html', docType: 'note', status: status({ missing: true, nonConforming: 'r', dataConflict: true, updatedWhileDirty: true }) },
  ]);
}

test('the page loads only its own stylesheet and script, and has no inline styles or scripts', () => {
  const html = read('index.html');
  assert.deepEqual([...html.matchAll(/<link[^>]*href="([^"]*)"/g)].map((m) => m[1]), ['ui.css']);
  assert.deepEqual([...html.matchAll(/<script[^>]*src="([^"]*)"/g)].map((m) => m[1]), ['ui.js']);
  assert.doesNotMatch(html, /<style|\sstyle=|<script>|<script [^>]*>[^<]/i);
});

test('ui.js never parses strings as HTML and never writes style attributes', () => {
  const js = read('ui.js');
  for (const pattern of [/innerHTML/, /outerHTML/, /insertAdjacentHTML/, /document\.write/, /createContextualFragment/,
    /DOMParser/, /setAttribute\(\s*['"]style/, /cssText/, /\beval\(/, /new Function/]) {
    assert.doesNotMatch(js, pattern);
  }
});

test('ui.css follows the system light or dark appearance', () => {
  assert.match(read('ui.css'), /@media \(prefers-color-scheme: dark\)/);
});

test('document-derived strings stay text', () => {
  const { window, document, render } = loadPage();
  render(twoPanes());
  assert.equal(document.querySelectorAll('img, b').length, 0, 'no element from a file name');
  assert.equal(window.pwned, undefined);
  const tab = document.querySelector('.strip .tab[data-doc-id="a"]');
  assert.equal(tab.querySelector('.label').textContent, EVIL);
  assert.equal(tab.title, `/docs/${EVIL}`);
  assert.equal(document.querySelector('#entries .entry[data-doc-id="b"] .label').textContent, '<b>bold.ev.html');
});

test('the list shows every document in pane order, a separator between panes, dirty marks and badges', () => {
  const { document, render } = loadPage();
  render(twoPanes());
  const list = document.getElementById('list');
  assert.equal(list.hidden, false);
  assert.deepEqual([list.style.left, list.style.top, list.style.width, list.style.height], ['0px', '0px', '240px', '700px']);
  const children = [...document.getElementById('entries').children];
  assert.deepEqual(children.map((c) => (c.classList.contains('separator') ? '|' : c.dataset.docId)), ['a', 'b', '|', 'c']);
  const a = children[0];
  assert.equal(a.querySelector('.dirty').textContent, '•');
  assert.deepEqual([...a.querySelectorAll('.badge')].map((b) => [b.dataset.kind, b.title, b.getAttribute('aria-label')]),
    [['kit-update', 'Kit update available', 'Kit update available']]);
  assert.equal(children[1].querySelector('.dirty'), null);
  assert.deepEqual([...children[3].querySelectorAll('.badge')].map((b) => b.title),
    ['Moved or deleted', 'No longer follows the specification', 'Changed on disk', 'Updated on disk']);
  assert.ok(a.classList.contains('active'), 'the active document is marked');
  assert.ok(document.getElementById('list-handle'), 'a resize handle');
});

test('tab strips sit at their rectangles with label, badge and close button', () => {
  const { document, render } = loadPage();
  const state = twoPanes();
  render(state);
  const strips = [...document.querySelectorAll('.strip')];
  assert.deepEqual(strips.map((s) => s.dataset.paneId), ['p1', 'p2']);
  for (const [i, strip] of strips.entries()) {
    const rect = state.layout.panes[i].tabStrip;
    assert.deepEqual([strip.style.left, strip.style.top, strip.style.width, strip.style.height],
      [`${rect.x}px`, `${rect.y}px`, `${rect.width}px`, `${rect.height}px`]);
  }
  assert.ok(strips[0].classList.contains('focused'));
  assert.deepEqual([...strips[0].querySelectorAll('.tab')].map((t) => t.dataset.docId), ['a', 'b']);
  const a = strips[0].querySelector('.tab[data-doc-id="a"]');
  assert.ok(a.classList.contains('selected') && a.classList.contains('dirty'));
  assert.equal(a.querySelector('.badge').title, 'Kit update available');
  assert.equal(a.querySelector('.close').getAttribute('aria-label'), 'Close');
  assert.match(a.querySelector('.close').textContent, /•/, 'the dirty mark sits in the close button');
  assert.equal(strips[0].querySelector('.tab[data-doc-id="b"] .badge'), null);
  assert.equal(strips[1].querySelector('.tab[data-doc-id="c"] .badge').title, 'Moved or deleted', 'the most urgent badge');
});

test('banner rows show up to three banners, then +N more', () => {
  const { document, render } = loadPage();
  const state = twoPanes();
  render(state);
  const rows = [...document.querySelectorAll('.banners')];
  assert.deepEqual(rows.map((r) => r.dataset.paneId), ['p1', 'p2']);
  const rect = state.layout.panes[1].banners;
  assert.deepEqual([rows[1].style.top, rows[1].style.height], [`${rect.y}px`, `${rect.height}px`]);
  assert.deepEqual([...rows[0].querySelectorAll('.banner')].map((b) => b.querySelector('.message').textContent),
    ['This document uses kit 1.0.0; 1.1.0 is available.']);
  assert.deepEqual([...rows[0].querySelectorAll('button')].map((b) => b.textContent), ['Update kit', 'Not now']);
  assert.deepEqual([...rows[1].querySelectorAll('.banner')].map((b) => b.dataset.kind),
    ['missing', 'non-conforming', 'data-conflict']);
  assert.equal(rows[1].querySelector('.more').textContent, '+1 more');
});

test('one divider per split boundary, with a resize cursor class', () => {
  const { document, render } = loadPage();
  const state = twoPanes();
  render(state);
  const dividers = [...document.querySelectorAll('.divider')];
  assert.equal(dividers.length, 1);
  const { rect } = state.layout.dividers[0];
  assert.deepEqual([dividers[0].style.left, dividers[0].style.width], [`${rect.x}px`, '4px']);
  assert.ok(dividers[0].classList.contains('row'));
  // A new state keeps the element (a drag holds pointer capture on it).
  render(state);
  assert.equal(document.querySelector('.divider'), dividers[0]);
});

test('clicks become intents', () => {
  const { window, document, render, sent } = loadPage();
  render(twoPanes());
  const click = (el, init = {}) => el.dispatchEvent(new window.MouseEvent('click', { bubbles: true, ...init }));
  click(document.querySelector('.strip .tab[data-doc-id="b"] .label'));
  click(document.querySelector('.strip .tab[data-doc-id="b"] .close'));
  document.querySelector('.strip .tab[data-doc-id="c"]').dispatchEvent(new window.MouseEvent('auxclick', { bubbles: true, button: 1 }));
  click(document.querySelector('#entries .entry[data-doc-id="c"]'));
  click(document.querySelector('.banners[data-pane-id="p1"] button[data-action="update-kit"]'));
  click(document.querySelector('.banners[data-pane-id="p2"] .banner[data-kind="missing"] .dismiss'));
  assert.deepEqual(sent, [
    { type: 'select', docId: 'b' },
    { type: 'close', docId: 'b' },
    { type: 'close', docId: 'c' },
    { type: 'select', docId: 'c' },
    { type: 'banner', docId: 'a', kind: 'kit-update', action: 'update-kit' },
    { type: 'banner', docId: 'c', kind: 'missing', action: 'dismiss' },
  ]);
});

test('the empty state fills the pane and offers Open…', () => {
  const { window, document, render, sent } = loadPage();
  const state = stateOf(createModel(), []);
  render(state);
  const empty = document.getElementById('empty');
  assert.equal(empty.hidden, false);
  const rect = state.layout.panes[0].document;
  assert.deepEqual([empty.style.left, empty.style.top, empty.style.width, empty.style.height],
    [`${rect.x}px`, `${rect.y}px`, `${rect.width}px`, `${rect.height}px`]);
  assert.match(empty.textContent, /Drop a document here/);
  const open = document.getElementById('open');
  assert.equal(open.textContent, 'Open…');
  open.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  assert.deepEqual(sent, [{ type: 'open-dialog' }]);
  render(twoPanes());
  assert.equal(empty.hidden, true);
});

test('the restore notice sits at the top of the list until OK', () => {
  const { window, document, render, sent } = loadPage();
  render(stateOf(createModel(), [], { notice: { failed: [{ path: `/a/${EVIL}`, reason: 'moved or deleted' }] } }));
  const notice = document.getElementById('notice');
  assert.equal(notice.hidden, false);
  assert.equal(document.getElementById('list').firstElementChild, notice);
  assert.equal(document.getElementById('notice-message').textContent, 'Some documents from your last session could not be opened:');
  assert.deepEqual([...notice.querySelectorAll('li')].map((li) => li.textContent), [`${EVIL} — moved or deleted`]);
  assert.equal(document.querySelectorAll('img').length, 0);
  document.getElementById('notice-ok').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  assert.deepEqual(sent, [{ type: 'dismiss-notice' }]);
  render(stateOf(createModel(), []));
  assert.equal(notice.hidden, true);
});

test('a hidden list draws nothing', () => {
  const { document, render } = loadPage();
  const model = { ...addTab(createModel(), 'a'), list: { visible: false, mode: 'list', width: 240 } };
  render(stateOf(model, [{ id: 'a', path: '/d/a.ev.html', docType: 't', status: status({}) }]));
  assert.equal(document.getElementById('list').hidden, true);
  assert.equal(document.querySelector('.strip').style.left, '0px');
});

test('the fade of "Updated from disk" is keyed on the main process fadeKey', () => {
  const page = loadPage();
  let now = 1000;
  page.window.Date.now = () => now;
  const push = (key) => {
    const model = addTab(createModel(), 'a');
    page.render(stateOf(model, [{ id: 'a', path: '/docs/a.ev.html', docType: 'note', status: status({ updatedFromDisk: key }) }]));
  };
  const delay = () => page.document.querySelector('.banner[data-kind="updated-from-disk"]').style.animationDelay;
  push(1);
  assert.equal(delay(), '0ms');
  now = 2500;
  push(1); // the same period: the start stays
  assert.equal(delay(), '-1500ms');
  push(2); // a restart: a new key
  assert.equal(delay(), '0ms');
  now = 3000;
  push(2);
  assert.equal(delay(), '-500ms');
  now = 6600; // the fade is over before the main process clears the banner: nothing visible remains
  push(2);
  assert.equal(page.document.querySelector('.banner'), null);
  assert.ok(page.document.querySelector('.banners').classList.contains('spent'));
  push(3); // and a later restart shows it again
  assert.equal(delay(), '0ms');
});

// ---------- Dragging tabs ----------

// Pointer events on a tab, with pointer capture and tab rectangles stubbed
// (jsdom has neither): each tab is 100 px wide, side by side in its strip.
function dragSetup() {
  const page = loadPage();
  const state = twoPanes();
  page.render(state);
  const { window, document } = page;
  window.HTMLElement.prototype.setPointerCapture = () => {};
  for (const strip of document.querySelectorAll('.strip')) {
    const rect = state.layout.panes.find((p) => p.paneId === strip.dataset.paneId).tabStrip;
    [...strip.querySelectorAll('.tab')].forEach((tab, i) => {
      tab.getBoundingClientRect = () => ({ left: rect.x + i * 100, right: rect.x + i * 100 + 100, width: 100, top: rect.y, bottom: rect.y + rect.height, height: rect.height });
    });
  }
  const tab = (docId) => document.querySelector(`.strip .tab[data-doc-id="${docId}"]`);
  const fire = (el, type, x, y) => el.dispatchEvent(new window.MouseEvent(type, { bubbles: true, clientX: x, clientY: y, button: 0 }));
  const pointer = (el, type, x, y) => {
    const event = new window.MouseEvent(type, { bubbles: true, clientX: x, clientY: y, button: 0 });
    Object.defineProperty(event, 'pointerId', { value: 1 });
    el.dispatchEvent(event);
  };
  return { ...page, state, tab, pointer, fire };
}

test('a tab drag starts after 4 px; a click or a shorter move sends nothing', () => {
  const { state, tab, pointer, sent } = dragSetup();
  const p1 = state.layout.panes[0].tabStrip;
  pointer(tab('a'), 'pointerdown', p1.x + 10, p1.y + 10);
  pointer(tab('a'), 'pointermove', p1.x + 12, p1.y + 12);
  pointer(tab('a'), 'pointerup', p1.x + 12, p1.y + 12);
  assert.deepEqual(sent, []);
});

test('dropping on the right quarter of another pane splits, in its centre moves, in a strip moves to the index', () => {
  const run = (target) => {
    const { state, tab, pointer, sent, document } = dragSetup();
    const p1 = state.layout.panes[0];
    const p2 = state.layout.panes[1];
    const at = target(p1, p2);
    pointer(tab('a'), 'pointerdown', p1.tabStrip.x + 10, p1.tabStrip.y + 10);
    pointer(tab('a'), 'pointermove', p1.tabStrip.x + 20, p1.tabStrip.y + 10);
    pointer(tab('a'), 'pointermove', at.x, at.y);
    const marker = document.getElementById('drop-marker');
    const shown = marker.hidden ? null : { left: marker.style.left, width: marker.style.width };
    pointer(tab('a'), 'pointerup', at.x, at.y);
    return { sent, shown, p2 };
  };
  let r = run((p1, p2) => ({ x: p2.document.x + p2.document.width - 5, y: p2.document.y + p2.document.height / 2 }));
  assert.deepEqual(r.sent, [{ type: 'drag', active: true }, { type: 'split', docId: 'a', paneId: 'p2', edge: 'right' }, { type: 'drag', active: false }]);
  assert.equal(r.shown.width, `${Math.floor(r.p2.document.width / 2)}px`, 'half the pane');
  r = run((p1, p2) => ({ x: p2.document.x + p2.document.width / 2, y: p2.document.y + p2.document.height / 2 }));
  assert.deepEqual(r.sent[1], { type: 'move-tab', docId: 'a', paneId: 'p2', index: 1 });
  r = run((p1, p2) => ({ x: p2.tabStrip.x + 10, y: p2.tabStrip.y + 10 }));
  assert.deepEqual(r.sent[1], { type: 'move-tab', docId: 'a', paneId: 'p2', index: 0 });
  r = run((p1) => ({ x: p1.tabStrip.x + 150, y: p1.tabStrip.y + 10 })); // past b's centre? b sits at 100-200: its centre is 150
  assert.equal(r.sent[1].index, 0, 'among the other tabs only');
});

test('releasing over nothing, pointercancel and lostpointercapture cancel, and every end sends drag false', () => {
  for (const end of ['outside', 'pointercancel', 'lostpointercapture']) {
    const { state, tab, pointer, sent } = dragSetup();
    const p1 = state.layout.panes[0].tabStrip;
    pointer(tab('a'), 'pointerdown', p1.x + 10, p1.y + 10);
    pointer(tab('a'), 'pointermove', p1.x + 30, p1.y + 10);
    if (end === 'outside') pointer(tab('a'), 'pointerup', -20, -20);
    else pointer(tab('a'), end, p1.x + 30, p1.y + 10);
    assert.deepEqual(sent, [{ type: 'drag', active: true }, { type: 'drag', active: false }], end);
  }
});

test('a pane\'s only tab cannot split itself, and a state mid-drag keeps the dragged tab element', () => {
  const { state, tab, pointer, sent, render } = dragSetup();
  const p2 = state.layout.panes[1];
  const dragged = tab('c');
  pointer(dragged, 'pointerdown', p2.tabStrip.x + 10, p2.tabStrip.y + 10);
  pointer(dragged, 'pointermove', p2.tabStrip.x + 30, p2.tabStrip.y + 10);
  render(state);
  assert.equal(tab('c'), dragged, 'the same element');
  pointer(dragged, 'pointermove', p2.document.x + p2.document.width - 5, p2.document.y + 50);
  pointer(dragged, 'pointerup', p2.document.x + p2.document.width - 5, p2.document.y + 50);
  assert.deepEqual(sent, [{ type: 'drag', active: true }, { type: 'drag', active: false }]);
});
