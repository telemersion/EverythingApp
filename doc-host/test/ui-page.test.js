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
