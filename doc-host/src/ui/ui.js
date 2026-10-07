'use strict';

// The host UI page. It draws the state the main process pushes (ui-state.js)
// into absolutely positioned elements at the layout's rectangles, and reports
// what the user does as intents (ui-intents.js). It decides nothing.
// Every string goes in with textContent, file names, paths and document
// types included. Positions and sizes are set through the CSSOM: the CSP
// allows no style attributes and no inline styles.
(function () {
  const BADGES = {
    missing: { glyph: '∅', title: 'Moved or deleted' },
    'non-conforming': { glyph: '!', title: 'No longer follows the specification' },
    'data-conflict': { glyph: '⇄', title: 'Changed on disk' },
    'updated-while-dirty': { glyph: '↻', title: 'Updated on disk' },
    'check-error': { glyph: '?', title: 'Could not check for changes' },
    'kit-update': { glyph: '↑', title: 'Kit update available' },
  };
  const SHOWN_BANNERS = 3;

  let state = null;
  const dividers = new Map();   // `${splitId}:${index}` → element, kept while a drag holds it
  const fadeStarts = new Map(); // `${docId}:${kind}` → { key, start }: the period (fadeKey) and when it first showed

  const send = (intent) => window.evUi.send(intent);
  const byId = (id) => document.getElementById(id);

  function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function button(className, text, onClick) {
    const node = element('button', className, text);
    node.type = 'button';
    node.addEventListener('click', onClick);
    return node;
  }

  function place(node, rect) {
    node.style.left = `${rect.x}px`;
    node.style.top = `${rect.y}px`;
    node.style.width = `${rect.width}px`;
    node.style.height = `${rect.height}px`;
  }

  function badgeIcon(kind) {
    const badge = BADGES[kind] || { glyph: '', title: kind };
    const icon = element('span', 'badge', badge.glyph);
    icon.dataset.kind = kind;
    icon.title = badge.title;
    icon.setAttribute('role', 'img');
    icon.setAttribute('aria-label', badge.title);
    return icon;
  }

  // Calls fn with the newest arguments, at most once per animation frame.
  function perFrame(fn) {
    let pending = null;
    return (...args) => {
      const scheduled = pending !== null;
      pending = args;
      if (scheduled) return;
      requestAnimationFrame(() => {
        const newest = pending;
        pending = null;
        fn(...newest);
      });
    };
  }

  // Follows a pointer drag that started on node (pointer capture) and
  // reports the pointer position once per animation frame until it ends.
  function followDrag(node, event, onMove) {
    event.preventDefault();
    node.setPointerCapture(event.pointerId);
    node.classList.add('dragging');
    const report = perFrame(onMove);
    const move = (e) => report(e.clientX, e.clientY);
    const end = () => {
      node.classList.remove('dragging');
      node.removeEventListener('pointermove', move);
      node.removeEventListener('lostpointercapture', end);
    };
    node.addEventListener('pointermove', move);
    node.addEventListener('lostpointercapture', end);
  }

  // ---------- Document list ----------

  function renderNotice() {
    const { notice } = state;
    byId('notice').hidden = !notice;
    if (!notice) return;
    byId('notice-message').textContent = notice.message;
    byId('notice-items').replaceChildren(...notice.items.map((item) => element('li', null, `${item.label} — ${item.reason}`)));
  }

  function listEntry(pane, tab, activeDocId) {
    const entry = element('div', 'entry');
    entry.dataset.docId = tab.docId;
    entry.title = tab.path;
    entry.classList.toggle('selected', tab.docId === pane.selected);
    entry.classList.toggle('active', tab.docId === activeDocId);
    entry.append(element('span', 'label', tab.label));
    if (tab.dirty) entry.append(element('span', 'dirty', '•'));
    const info = state.documents[tab.docId];
    for (const kind of info ? info.badges : []) entry.append(badgeIcon(kind));
    entry.addEventListener('click', () => send({ type: 'select', docId: tab.docId }));
    return entry;
  }

  function renderList() {
    const list = byId('list');
    const rect = state.layout.list;
    list.hidden = !rect;
    if (!rect) return;
    place(list, rect);
    renderNotice();
    const focused = state.panes.find((pane) => pane.focused);
    const activeDocId = focused ? focused.selected : null;
    const nodes = [];
    state.panes.forEach((pane, i) => {
      if (i > 0) nodes.push(element('div', 'separator'));
      for (const tab of pane.tabs) nodes.push(listEntry(pane, tab, activeDocId));
    });
    byId('entries').replaceChildren(...nodes);
  }

  // Dragging the list's right edge sets its width.
  byId('list-handle').addEventListener('pointerdown', (event) => {
    if (event.button !== 0 || !state) return;
    const startX = event.clientX;
    const startWidth = state.list.width;
    followDrag(event.currentTarget, event, (x) => send({ type: 'list', width: startWidth + x - startX }));
  });

  byId('notice-ok').addEventListener('click', () => send({ type: 'dismiss-notice' }));

  // ---------- Tab strips ----------

  function tabElement(pane, tab) {
    const selected = tab.docId === pane.selected;
    const node = element('div', 'tab');
    node.dataset.docId = tab.docId;
    node.title = tab.path;
    node.setAttribute('role', 'tab');
    node.setAttribute('aria-selected', String(selected));
    node.classList.toggle('selected', selected);
    node.classList.toggle('dirty', tab.dirty);
    if (tab.badge) node.append(badgeIcon(tab.badge));
    node.append(element('span', 'label', tab.label));
    // Unsaved: the dot shows in place of the × until the pointer is over the tab (ui.css).
    const close = button('close', undefined, (event) => {
      event.stopPropagation();
      send({ type: 'close', docId: tab.docId });
    });
    close.title = 'Close';
    close.setAttribute('aria-label', 'Close');
    close.append(element('span', 'dot', '•'), element('span', 'x', '×'));
    node.append(close);
    node.addEventListener('click', () => send({ type: 'select', docId: tab.docId }));
    // Middle-click closes (and must not start autoscroll).
    node.addEventListener('mousedown', (event) => {
      if (event.button === 1) event.preventDefault();
    });
    node.addEventListener('auxclick', (event) => {
      if (event.button === 1) send({ type: 'close', docId: tab.docId });
    });
    return node;
  }

  function tabStrip(pane, rect) {
    const strip = element('div', 'strip');
    strip.dataset.paneId = pane.paneId;
    strip.setAttribute('role', 'tablist');
    strip.classList.toggle('focused', pane.focused);
    place(strip, rect);
    for (const tab of pane.tabs) strip.append(tabElement(pane, tab));
    return strip;
  }

  // ---------- Banner rows ----------

  // A banner with fadeMs fades out over that time. The main process times
  // the period and gives it a fadeKey: the same key keeps its start across
  // states and tab switches, a new key starts the fade again. Returns false
  // when the fade is already over (nothing is drawn then).
  function fade(node, key, banner, shown) {
    const now = Date.now();
    let entry = fadeStarts.get(key);
    if (!entry || entry.key !== banner.fadeKey) {
      entry = { key: banner.fadeKey, start: now };
      fadeStarts.set(key, entry);
    }
    shown.add(key);
    if (now - entry.start >= banner.fadeMs) return false;
    node.classList.add('fading');
    node.style.animationDuration = `${banner.fadeMs}ms`;
    node.style.animationDelay = `${entry.start - now}ms`;
    return true;
  }

  function bannerElement(docId, banner, shownFades) {
    const node = element('div', 'banner');
    node.dataset.kind = banner.kind;
    node.setAttribute('role', 'status');
    if (BADGES[banner.kind]) node.append(badgeIcon(banner.kind));
    const message = element('span', 'message', banner.message);
    message.title = banner.message;
    node.append(message);
    const act = (action) => () => send({ type: 'banner', docId, kind: banner.kind, action });
    for (const action of banner.actions) {
      const actionButton = button(null, action.label, act(action.id));
      actionButton.dataset.action = action.id;
      node.append(actionButton);
    }
    if (typeof banner.dismissLabel === 'string') node.append(button('dismiss', banner.dismissLabel, act('dismiss')));
    if (banner.fadeMs && !fade(node, `${docId}:${banner.kind}`, banner, shownFades)) return null;
    return node;
  }

  // The banners of the pane's selected document: up to three, then "+N more".
  function bannerRow(pane, banners, rect, shownFades) {
    const row = element('div', 'banners');
    row.dataset.paneId = pane.paneId;
    place(row, rect);
    for (const banner of banners.slice(0, SHOWN_BANNERS)) {
      const node = bannerElement(pane.selected, banner, shownFades);
      if (node) row.append(node);
    }
    if (row.childElementCount === 0) row.classList.add('spent'); // every banner has faded: no empty opaque band
    if (banners.length > SHOWN_BANNERS) row.append(element('div', 'more', `+${banners.length - SHOWN_BANNERS} more`));
    return row;
  }

  function renderPanes() {
    const nodes = [];
    const shownFades = new Set();
    for (const pane of state.panes) {
      const rects = state.layout.panes.find((p) => p.paneId === pane.paneId);
      if (!rects) continue;
      nodes.push(tabStrip(pane, rects.tabStrip));
      const doc = pane.selected === null ? null : state.documents[pane.selected];
      if (doc && doc.banners.length > 0 && rects.banners.height > 0) {
        nodes.push(bannerRow(pane, doc.banners, rects.banners, shownFades));
      }
    }
    byId('panes').replaceChildren(...nodes);
    for (const key of [...fadeStarts.keys()]) if (!shownFades.has(key)) fadeStarts.delete(key);
  }

  // ---------- Dividers ----------

  // Dragging a divider shares the two sizes next to it anew.
  function startSplitDrag(node, event) {
    if (event.button !== 0 || !state) return;
    const { splitId } = node.dataset;
    const index = Number(node.dataset.index);
    const split = state.splits[splitId];
    if (!split || !(split.available > 0) || index + 1 >= split.sizes.length) return;
    const row = split.direction === 'row';
    const start = row ? event.clientX : event.clientY;
    const sizes = split.sizes;
    const pair = sizes[index] + sizes[index + 1];
    followDrag(node, event, (x, y) => {
      const moved = ((row ? x : y) - start) / split.available;
      const first = Math.min(pair, Math.max(0, sizes[index] + moved));
      const next = [...sizes];
      next[index] = first;
      next[index + 1] = pair - first;
      send({ type: 'resize-split', splitId, sizes: next });
    });
  }

  // Divider elements are kept across states: a drag holds pointer capture on one.
  function renderDividers() {
    const container = byId('dividers');
    const current = new Set();
    for (const divider of state.layout.dividers) {
      const key = `${divider.splitId}:${divider.index}`;
      current.add(key);
      let node = dividers.get(key);
      if (!node) {
        node = element('div', 'divider');
        node.dataset.splitId = divider.splitId;
        node.dataset.index = String(divider.index);
        node.addEventListener('pointerdown', (event) => startSplitDrag(node, event));
        dividers.set(key, node);
        container.append(node);
      }
      node.classList.toggle('row', divider.direction === 'row');
      node.classList.toggle('column', divider.direction === 'column');
      place(node, divider.rect);
    }
    for (const [key, node] of dividers) {
      if (current.has(key)) continue;
      node.remove();
      dividers.delete(key);
    }
  }

  // ---------- Empty state ----------

  function renderEmpty() {
    const empty = byId('empty');
    const pane = state.layout.panes[0];
    empty.hidden = !(state.empty && pane);
    if (!empty.hidden) place(empty, pane.document);
  }

  byId('open').addEventListener('click', () => send({ type: 'open-dialog' }));

  // ---------- State ----------

  function render() {
    document.documentElement.dataset.platform = state.platform;
    renderList();
    renderPanes();
    renderDividers();
    renderEmpty();
  }

  window.evUi.onState((next) => {
    state = next;
    render();
  });
})();
