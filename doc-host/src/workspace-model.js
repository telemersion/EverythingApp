'use strict';

// Pure model of the workspace: a tree of panes and splits, the tabs of each pane,
// focus and the document-list settings. No function mutates its input. A call that
// is not allowed returns the input model unchanged (the same object).
//
// Model = { root: Node, focusedPaneId, nextId, list: { visible, mode, width } }
// Node  = { kind: 'pane', id: 'p<n>', tabs: string[], selected: string | null }
//       | { kind: 'split', id: 's<n>', direction: 'row' | 'column', children: Node[], sizes: number[] }

const MIN_SIZE = 0.05;
const LIST_MIN = 160;
const LIST_MAX = 480;
const EDGES = {
  left: { direction: 'row', after: false },
  right: { direction: 'row', after: true },
  top: { direction: 'column', after: false },
  bottom: { direction: 'column', after: true },
};

function createModel() {
  return {
    root: { kind: 'pane', id: 'p1', tabs: [], selected: null },
    focusedPaneId: 'p1',
    nextId: 2,
    list: { visible: true, mode: 'list', width: 240 },
  };
}

// ---- tree helpers -------------------------------------------------------

function findInTree(node, id) {
  if (node.id === id) return node;
  if (node.kind === 'split') {
    for (const child of node.children) {
      const found = findInTree(child, id);
      if (found) return found;
    }
  }
  return null;
}

function findParent(node, id) {
  if (node.kind !== 'split') return null;
  for (const child of node.children) {
    if (child.id === id) return node;
    const found = findParent(child, id);
    if (found) return found;
  }
  return null;
}

// Replaces the node with `id` by `replacement(node)`; everything else is shared.
function replaceNode(node, id, replacement) {
  if (node.id === id) return replacement(node);
  if (node.kind !== 'split') return node;
  let changed = false;
  const children = node.children.map((child) => {
    const next = replaceNode(child, id, replacement);
    if (next !== child) changed = true;
    return next;
  });
  return changed ? { ...node, children } : node;
}

function rescale(sizes) {
  const sum = sizes.reduce((a, b) => a + b, 0);
  return sizes.map((s) => s / sum);
}

// Removes a pane from its split and rescales the sizes. A split left with one child
// is replaced by that child, which keeps the split's slot (and so its size).
function removePane(node, paneId) {
  if (node.kind !== 'split') return node;
  const index = node.children.findIndex((child) => child.id === paneId);
  if (index >= 0) {
    const children = node.children.filter((_, i) => i !== index);
    if (children.length === 1) return children[0];
    return { ...node, children, sizes: rescale(node.sizes.filter((_, i) => i !== index)) };
  }
  let changed = false;
  const children = node.children.map((child) => {
    const next = removePane(child, paneId);
    if (next !== child) changed = true;
    return next;
  });
  return changed ? { ...node, children } : node;
}

function firstPane(node) {
  return node.kind === 'pane' ? node : firstPane(node.children[0]);
}

function collectPanes(node, out) {
  if (node.kind === 'pane') out.push(node);
  else node.children.forEach((child) => collectPanes(child, out));
  return out;
}

function paneNode(model, paneId) {
  const node = findInTree(model.root, paneId);
  return node && node.kind === 'pane' ? node : null;
}

function withPane(model, paneId, change) {
  return { ...model, root: replaceNode(model.root, paneId, (pane) => ({ ...pane, ...change(pane) })) };
}

// ---- queries ------------------------------------------------------------

function findNode(model, id) {
  return findInTree(model.root, id);
}

function panesInOrder(model) {
  return collectPanes(model.root, []);
}

function docsInOrder(model) {
  return panesInOrder(model).flatMap((pane) => pane.tabs);
}

function paneOf(model, docId) {
  const pane = panesInOrder(model).find((p) => p.tabs.includes(docId));
  return pane ? pane.id : null;
}

function activeDocId(model) {
  const pane = paneNode(model, model.focusedPaneId);
  return pane ? pane.selected : null;
}

function canSplit(model, docId, paneId) {
  const target = paneNode(model, paneId);
  if (!target || paneOf(model, docId) === null) return false;
  return !(target.tabs.length === 1 && target.tabs[0] === docId);
}

// ---- tabs ---------------------------------------------------------------

function addTab(model, docId, { paneId = model.focusedPaneId } = {}) {
  if (paneOf(model, docId) !== null) return model;
  const pane = paneNode(model, paneId);
  if (!pane) return model;
  const at = pane.selected === null ? pane.tabs.length : pane.tabs.indexOf(pane.selected) + 1;
  const tabs = [...pane.tabs.slice(0, at), docId, ...pane.tabs.slice(at)];
  return { ...withPane(model, paneId, () => ({ tabs, selected: docId })), focusedPaneId: paneId };
}

function selectTab(model, docId) {
  const paneId = paneOf(model, docId);
  if (paneId === null) return model;
  return { ...withPane(model, paneId, () => ({ selected: docId })), focusedPaneId: paneId };
}

function removeTab(model, docId) {
  const paneId = paneOf(model, docId);
  if (paneId === null) return model;
  const pane = paneNode(model, paneId);
  if (pane.tabs.length > 1 || model.root === pane) {
    const index = pane.tabs.indexOf(docId);
    const tabs = pane.tabs.filter((t) => t !== docId);
    const selected = pane.selected !== docId ? pane.selected
      : (tabs.length === 0 ? null : tabs[Math.min(index, tabs.length - 1)]);
    return withPane(model, paneId, () => ({ tabs, selected }));
  }
  // the pane empties and is not the last one: it disappears
  const parent = findParent(model.root, paneId);
  const index = parent.children.findIndex((c) => c.id === paneId);
  const root = removePane(model.root, paneId);
  let focusedPaneId = model.focusedPaneId;
  if (focusedPaneId === paneId) {
    const sibling = parent.children[index + 1] || parent.children[index - 1];
    focusedPaneId = firstPane(sibling).id;
  }
  return { ...model, root, focusedPaneId };
}

function moveTab(model, docId, paneId, index) {
  const sourceId = paneOf(model, docId);
  const target = paneNode(model, paneId);
  if (sourceId === null || !target || !Number.isInteger(index)) return model;
  const insert = (tabs) => {
    const at = Math.max(0, Math.min(index, tabs.length));
    return [...tabs.slice(0, at), docId, ...tabs.slice(at)];
  };
  let next;
  if (sourceId === paneId) {
    next = withPane(model, paneId, (pane) => ({ tabs: insert(pane.tabs.filter((t) => t !== docId)), selected: docId }));
  } else {
    next = removeTab(model, docId); // the target is another pane, so it survives any collapse
    next = withPane(next, paneId, (pane) => ({ tabs: insert(pane.tabs), selected: docId }));
  }
  return { ...next, focusedPaneId: paneId };
}

function splitPane(model, docId, paneId, edge) {
  const spec = EDGES[edge];
  if (!spec || !canSplit(model, docId, paneId)) return model;
  const removed = removeTab(model, docId);
  const newPaneId = `p${removed.nextId}`;
  const newPane = { kind: 'pane', id: newPaneId, tabs: [docId], selected: docId };
  const parent = findParent(removed.root, paneId);
  let root;
  let nextId = removed.nextId + 1;
  if (parent && parent.direction === spec.direction) {
    const index = parent.children.findIndex((c) => c.id === paneId);
    const at = spec.after ? index + 1 : index;
    const half = parent.sizes[index] / 2;
    const sizes = [...parent.sizes];
    sizes.splice(index, 1, half, half);
    const children = [...parent.children];
    children.splice(at, 0, newPane);
    root = replaceNode(removed.root, parent.id, (split) => ({ ...split, children, sizes }));
  } else {
    const splitId = `s${nextId}`;
    nextId += 1;
    root = replaceNode(removed.root, paneId, (target) => ({
      kind: 'split',
      id: splitId,
      direction: spec.direction,
      children: spec.after ? [target, newPane] : [newPane, target],
      sizes: [0.5, 0.5],
    }));
  }
  return { ...removed, root, nextId, focusedPaneId: newPaneId };
}

function cycleTab(model, delta) {
  const pane = paneNode(model, model.focusedPaneId);
  if (!pane || pane.tabs.length === 0) return model;
  const current = Math.max(0, pane.tabs.indexOf(pane.selected));
  const n = pane.tabs.length;
  return withPane(model, pane.id, () => ({ selected: pane.tabs[(((current + delta) % n) + n) % n] }));
}

function selectTabAt(model, index) {
  const pane = paneNode(model, model.focusedPaneId);
  if (!pane || !Number.isInteger(index) || index < 0 || index >= pane.tabs.length) return model;
  return withPane(model, pane.id, () => ({ selected: pane.tabs[index] }));
}

// ---- layout, focus, list ------------------------------------------------

function resizeSplit(model, splitId, sizes) {
  const split = findInTree(model.root, splitId);
  if (!split || split.kind !== 'split' || !Array.isArray(sizes) || sizes.length !== split.children.length
    || !sizes.every((s) => typeof s === 'number' && Number.isFinite(s))) return model;
  const next = rescale(sizes.map((s) => Math.max(MIN_SIZE, s)));
  return { ...model, root: replaceNode(model.root, splitId, (node) => ({ ...node, sizes: next })) };
}

function focusPane(model, paneId) {
  if (!paneNode(model, paneId)) return model;
  return { ...model, focusedPaneId: paneId };
}

function setList(model, { visible, mode, width } = {}) {
  const list = { ...model.list };
  if (typeof visible === 'boolean') list.visible = visible;
  if (mode === 'list' || mode === 'thumbnails') list.mode = mode;
  if (typeof width === 'number' && Number.isFinite(width)) list.width = Math.round(Math.max(LIST_MIN, Math.min(LIST_MAX, width)));
  return { ...model, list };
}

module.exports = {
  createModel, addTab, selectTab, removeTab, moveTab, splitPane, canSplit, resizeSplit,
  focusPane, cycleTab, selectTabAt, setList, paneOf, findNode, panesInOrder, docsInOrder,
  activeDocId,
};
