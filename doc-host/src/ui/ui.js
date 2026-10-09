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
  const THUMBNAIL_MARGIN = 16;  // thumbnail width = list width - 16
  const JPEG_DATA_URL = 'data:image/jpeg;base64,';
  const DRAG_THRESHOLD = 4;     // px the pointer moves with the button down before a tab drag starts
  const EDGE_ZONE = 0.25;       // the outer quarter of a pane's document area splits

  let state = null;
  const dividers = new Map();   // `${splitId}:${index}` → element, kept while a drag holds it
  const strips = new Map();     // paneId → tab strip element, kept across states
  const tabs = new Map();       // docId → tab element, kept across states: a drag holds pointer capture on one
  let drag = null;              // the running tab drag, see startTabDrag
  let splitDrag = null;         // the running divider drag: { seenRaised, end }
  let swallowClick = false;     // the click that ends a drag selects nothing
  const thumbnails = new Map(); // docId → data URL of the newest thumbnail (the page keeps them; the main process resends after a reload)
  const seenDocs = new Set();   // docIds that were in a state
  const thumbImages = new Map(); // docId → <img>, kept across states so a picture is not decoded again
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

  // Makes container's children exactly nodes, in order, without touching a
  // node that is in place (moving a node would end a pointer capture on it).
  function reconcile(container, nodes) {
    const keep = new Set(nodes);
    for (const child of [...container.children]) if (!keep.has(child)) child.remove();
    nodes.forEach((node, i) => {
      if (container.children[i] !== node) container.insertBefore(node, container.children[i] || null);
    });
  }

  const inside = (rect, x, y) => x >= rect.x && x < rect.x + rect.width && y >= rect.y && y < rect.y + rect.height;

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
  // raises: the host UI goes above the documents while it runs (drag intents).
  function followDrag(node, event, onMove, raises = false) {
    event.preventDefault();
    node.setPointerCapture(event.pointerId);
    node.classList.add('dragging');
    if (raises) send({ type: 'drag', active: true });
    const report = perFrame(onMove);
    const move = (e) => report(e.clientX, e.clientY);
    let over = false;
    const end = () => {
      if (over) return;
      over = true;
      if (splitDrag && splitDrag.end === end) splitDrag = null;
      node.classList.remove('dragging');
      for (const [name, handler] of [['pointermove', move], ['pointerup', end], ['pointercancel', end], ['lostpointercapture', end]]) {
        node.removeEventListener(name, handler);
      }
      if (raises) send({ type: 'drag', active: false });
    };
    node.addEventListener('pointermove', move);
    node.addEventListener('pointerup', end);
    node.addEventListener('pointercancel', end);
    node.addEventListener('lostpointercapture', end);
    if (raises) splitDrag = { seenRaised: false, end };
  }

  // ---------- Document list ----------

  function renderNotice() {
    const { notice } = state;
    byId('notice').hidden = !notice;
    if (!notice) return;
    byId('notice-message').textContent = notice.message;
    byId('notice-items').replaceChildren(...notice.items.map((item) => element('li', null, `${item.label} — ${item.reason}`)));
  }

  const thumbsMode = () => state.list.mode === 'thumbnails';

  // The picture of a document as last seen, at the list width minus 16 px
  // (the height follows the picture), or a placeholder box with its label and
  // document type until there is one.
  function thumbnailBox(tab) {
    const box = element('div', 'thumb');
    const width = Math.max(0, state.layout.list.width - THUMBNAIL_MARGIN);
    box.style.width = `${width}px`;
    const url = thumbnails.get(tab.docId);
    if (url) {
      let img = thumbImages.get(tab.docId);
      if (!img) {
        img = document.createElement('img');
        img.alt = '';
        img.draggable = false;
        thumbImages.set(tab.docId, img);
      }
      if (img.getAttribute('src') !== url) img.src = url;
      img.style.width = `${width}px`;
      box.append(img);
    } else {
      box.classList.add('placeholder');
      const info = state.documents[tab.docId];
      box.append(element('span', 'label', tab.label), element('span', 'doc-type', info ? info.docType : ''));
    }
    return box;
  }

  function listEntry(pane, tab, activeDocId) {
    const entry = element('div', 'entry');
    entry.dataset.docId = tab.docId;
    entry.title = tab.path;
    entry.classList.toggle('selected', tab.docId === pane.selected);
    entry.classList.toggle('active', tab.docId === activeDocId);
    if (thumbsMode()) entry.append(thumbnailBox(tab));
    const caption = element('div', 'caption');
    entry.append(caption);
    caption.append(element('span', 'label', tab.label));
    if (tab.dirty) caption.append(element('span', 'dirty', '•'));
    const info = state.documents[tab.docId];
    for (const kind of info ? info.badges : []) caption.append(badgeIcon(kind));
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
    list.classList.toggle('thumbnails', thumbsMode());
    byId('entries').replaceChildren(...nodes);
    const live = new Set(state.panes.flatMap((pane) => pane.tabs.map((tab) => tab.docId)));
    // A thumbnail can arrive before the state that lists its document: forget
    // only the documents that were listed once and are gone.
    for (const id of [...seenDocs]) {
      if (live.has(id)) continue;
      seenDocs.delete(id);
      thumbnails.delete(id);
      thumbImages.delete(id);
    }
    for (const id of live) seenDocs.add(id);
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

  // A tab is created once per document and updated in place: a drag holds
  // pointer capture on it, and a state arriving mid-drag must not replace it.
  function tabElement(tab) {
    let node = tabs.get(tab.docId);
    if (node) return node;
    node = element('div', 'tab');
    node.dataset.docId = tab.docId;
    node.setAttribute('role', 'tab');
    node.addEventListener('click', () => {
      if (swallowClick) swallowClick = false;
      else send({ type: 'select', docId: tab.docId });
    });
    // Middle-click closes (and must not start autoscroll).
    node.addEventListener('mousedown', (event) => {
      if (event.button === 1) event.preventDefault();
    });
    node.addEventListener('auxclick', (event) => {
      if (event.button === 1) send({ type: 'close', docId: tab.docId });
    });
    node.addEventListener('pointerdown', (event) => startTabDrag(node, event));
    node.addEventListener('pointermove', (event) => moveTabDrag(node, event));
    node.addEventListener('pointerup', (event) => endTabDrag(node, event, true));
    node.addEventListener('pointercancel', (event) => endTabDrag(node, event, false));
    node.addEventListener('lostpointercapture', (event) => endTabDrag(node, event, false));
    tabs.set(tab.docId, node);
    return node;
  }

  function updateTab(pane, tab) {
    const node = tabElement(tab);
    const selected = tab.docId === pane.selected;
    node.title = tab.path;
    node.setAttribute('aria-selected', String(selected));
    node.classList.toggle('selected', selected);
    node.classList.toggle('dirty', tab.dirty);
    const children = [];
    if (tab.badge) children.push(badgeIcon(tab.badge));
    children.push(element('span', 'label', tab.label));
    // Unsaved: the dot shows in place of the × until the pointer is over the tab (ui.css).
    const close = button('close', undefined, (event) => {
      event.stopPropagation();
      send({ type: 'close', docId: tab.docId });
    });
    close.title = 'Close';
    close.setAttribute('aria-label', 'Close');
    close.append(element('span', 'dot', '•'), element('span', 'x', '×'));
    children.push(close);
    node.replaceChildren(...children);
    return node;
  }

  function tabStrip(pane, rect) {
    let strip = strips.get(pane.paneId);
    if (!strip) {
      strip = element('div', 'strip');
      strip.dataset.paneId = pane.paneId;
      strip.setAttribute('role', 'tablist');
      strips.set(pane.paneId, strip);
    }
    strip.classList.toggle('focused', pane.focused);
    place(strip, rect);
    reconcile(strip, pane.tabs.map((tab) => updateTab(pane, tab)));
    return strip;
  }

  // ---------- Dragging a tab ----------

  function paneOfDoc(docId) {
    return state.panes.find((pane) => pane.tabs.some((tab) => tab.docId === docId)) || null;
  }

  function startTabDrag(node, event) {
    if (event.button !== 0 || !state || event.target.closest('.close')) return;
    const docId = node.dataset.docId;
    if (drag) finishTabDrag(false);
    swallowClick = false;
    if (!paneOfDoc(docId)) return;
    node.setPointerCapture(event.pointerId);
    drag = { node, docId, pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, active: false, target: null, seenRaised: false };
  }

  function moveTabDrag(node, event) {
    if (!drag || drag.node !== node || event.pointerId !== drag.pointerId) return;
    if (!drag.active) {
      if (Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) < DRAG_THRESHOLD) return;
      drag.active = true;
      node.classList.add('dragging');
      byId('drag-ghost').textContent = node.querySelector('.label').textContent;
      byId('drag-ghost').hidden = false;
      send({ type: 'drag', active: true });
    }
    drag.target = dropTarget(event.clientX, event.clientY);
    drawDrag(event.clientX, event.clientY);
  }

  // Where a release at (x, y) would drop: { intent, marker: rect } or null.
  function dropTarget(x, y) {
    const { docId } = drag;
    for (const rects of state.layout.panes) {
      const pane = state.panes.find((p) => p.paneId === rects.paneId);
      if (!pane) continue;
      if (inside(rects.tabStrip, x, y)) return stripTarget(pane, rects.tabStrip, x);
      if (inside(rects.document, x, y)) return documentTarget(pane, rects.document, x, y);
    }
    return null;
  }

  // In a tab strip: between the tabs (the dragged one not counted), at the pointer.
  function stripTarget(pane, rect, x) {
    const others = pane.tabs.filter((tab) => tab.docId !== drag.docId).map((tab) => tabs.get(tab.docId)).filter(Boolean)
      .map((node) => node.getBoundingClientRect());
    const index = others.filter((box) => box.left + box.width / 2 < x).length;
    let at = rect.x;
    if (index > 0) at = others[index - 1].right;
    else if (others.length > 0) at = others[0].left;
    at = Math.min(Math.max(at, rect.x), rect.x + rect.width);
    return {
      intent: { type: 'move-tab', docId: drag.docId, paneId: pane.paneId, index },
      marker: { x: Math.max(rect.x, at - 1), y: rect.y, width: 2, height: rect.height },
    };
  }

  // In a pane's document area: the outer quarter on a side splits that way
  // (the half it would take is highlighted), the centre moves the tab to the
  // end of the pane. A pane's only tab cannot split or move onto itself.
  function documentTarget(pane, rect, x, y) {
    if (pane.tabs.length === 1 && pane.tabs[0].docId === drag.docId) return null;
    const fractions = {
      left: (x - rect.x) / rect.width,
      right: (rect.x + rect.width - x) / rect.width,
      top: (y - rect.y) / rect.height,
      bottom: (rect.y + rect.height - y) / rect.height,
    };
    const [edge, nearest] = Object.entries(fractions).sort((a, b) => a[1] - b[1])[0];
    if (nearest >= EDGE_ZONE) {
      return { intent: { type: 'move-tab', docId: drag.docId, paneId: pane.paneId, index: pane.tabs.length }, marker: { ...rect } };
    }
    const halfW = Math.floor(rect.width / 2);
    const halfH = Math.floor(rect.height / 2);
    const marker = {
      left: { x: rect.x, y: rect.y, width: halfW, height: rect.height },
      right: { x: rect.x + rect.width - halfW, y: rect.y, width: halfW, height: rect.height },
      top: { x: rect.x, y: rect.y, width: rect.width, height: halfH },
      bottom: { x: rect.x, y: rect.y + rect.height - halfH, width: rect.width, height: halfH },
    }[edge];
    return { intent: { type: 'split', docId: drag.docId, paneId: pane.paneId, edge }, marker };
  }

  function drawDrag(x, y) {
    const marker = byId('drop-marker');
    marker.hidden = !drag || !drag.target;
    if (!marker.hidden) place(marker, drag.target.marker);
    const ghost = byId('drag-ghost');
    ghost.style.left = `${x + 12}px`;
    ghost.style.top = `${y + 12}px`;
  }

  // Ends the drag: a release over a target drops, everything else cancels.
  // Every end of a started drag sends drag { active: false }, after the drop.
  function finishTabDrag(commit) {
    const ended = drag;
    drag = null;
    if (!ended) return;
    ended.node.classList.remove('dragging');
    byId('drop-marker').hidden = true;
    byId('drag-ghost').hidden = true;
    if (!ended.active) return;
    swallowClick = true;
    if (commit && ended.target) send(ended.target.intent);
    send({ type: 'drag', active: false });
  }

  function endTabDrag(node, event, released) {
    if (!drag || drag.node !== node || event.pointerId !== drag.pointerId) return;
    if (released && drag.active) drag.target = dropTarget(event.clientX, event.clientY); // where the pointer is now
    finishTabDrag(released);
  }

  window.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && drag) finishTabDrag(false);
  });

  // The workspace ends a drag when the window loses focus or another intent
  // arrives; the page then ends its own drag without dropping anything.
  function cancelDrags() {
    if (drag) finishTabDrag(false);
    if (splitDrag) splitDrag.end();
  }
  window.addEventListener('blur', cancelDrags);

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
    reconcile(byId('panes'), nodes);
    for (const key of [...fadeStarts.keys()]) if (!shownFades.has(key)) fadeStarts.delete(key);
    // Forget the strips and tabs that are gone.
    const livePanes = new Set(state.panes.map((pane) => pane.paneId));
    for (const id of [...strips.keys()]) if (!livePanes.has(id)) strips.delete(id);
    const liveDocs = new Set(state.panes.flatMap((pane) => pane.tabs.map((tab) => tab.docId)));
    for (const id of [...tabs.keys()]) if (!liveDocs.has(id)) tabs.delete(id);
    if (drag && !liveDocs.has(drag.docId)) finishTabDrag(false);
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
    }, true);
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
    document.documentElement.classList.toggle('dragging', state.dragging === true);
    renderList();
    renderPanes();
    renderDividers();
    renderEmpty();
  }

  // Only JPEG data URLs are pictures; anything else is dropped.
  window.evUi.onThumbnail((docId, dataUrl) => {
    if (typeof docId !== 'string' || typeof dataUrl !== 'string' || !dataUrl.startsWith(JPEG_DATA_URL)) return;
    thumbnails.set(docId, dataUrl);
    if (state && thumbsMode()) renderList();
  });

  window.evUi.onState((next) => {
    state = next;
    // A state with dragging false ends a drag only after one with true was
    // seen for it: a stale state still in flight must not cancel a drag that
    // was only just raised.
    if (next.dragging === true) {
      if (drag && drag.active) drag.seenRaised = true;
      if (splitDrag) splitDrag.seenRaised = true;
    } else {
      if (drag && drag.active && drag.seenRaised) finishTabDrag(false);
      if (splitDrag && splitDrag.seenRaised) splitDrag.end();
    }
    render();
  });
})();
