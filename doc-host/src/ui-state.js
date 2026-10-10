'use strict';

const path = require('node:path');
const { panesInOrder } = require('./workspace-model');
const { METRICS } = require('./layout');
const { describeStatus } = require('./status');
const { documentLabels } = require('./labels');

// Pure: the state the host UI draws (ui:state). Everything it shows is
// decided here or before; the page only places and renders it.
//
// {
//   layout,                       // computeLayout() of the model
//   list: model.list, empty, platform,
//   panes: [{ paneId, focused, selected, tabs: [{ docId, label, path, dirty, badge }] }],   // panesInOrder
//   documents: { [docId]: { label, path, docType, dirty, badges, banners } },
//   splits: { [splitId]: { direction, sizes, available } },   // available: the pixels the sizes share
//   notices: [{ kind, message, items: [{ label, reason }], actions: [{ id, label }] }],   // restore first
// }

const NOTICE_MESSAGE = 'Some documents from your last session could not be opened:';
const NOTICE_ORDER = ['restore', 'update'];

// The host UI's form of one workspace notice, or null if there is nothing to say.
function describeNotice(notice) {
  if (notice.kind === 'restore') {
    if (notice.failed.length === 0) return null;
    const labels = documentLabels(notice.failed.map((f) => f.path));
    return {
      kind: 'restore',
      message: NOTICE_MESSAGE,
      items: notice.failed.map((f) => ({ label: labels.get(f.path), reason: f.reason })),
      actions: [{ id: 'dismiss', label: 'OK' }],
    };
  }
  if (notice.kind === 'update') {
    return {
      kind: 'update',
      message: `EverythingApp ${notice.version} is ready. It installs when you quit.`,
      items: [],
      actions: [{ id: 'restart', label: 'Restart Now' }, { id: 'dismiss', label: 'Later' }],
    };
  }
  return null;
}

// The rectangle a split covers: the union of its panes' rectangles.
function splitRects(model, layout) {
  const paneRects = new Map(layout.panes.map((p) => [p.paneId, {
    x: p.tabStrip.x,
    y: p.tabStrip.y,
    right: p.tabStrip.x + p.tabStrip.width,
    bottom: p.document.y + p.document.height,
  }]));
  const splits = {};
  const walk = (node) => {
    if (node.kind === 'pane') return paneRects.get(node.id) || null;
    const rects = node.children.map(walk).filter(Boolean);
    if (rects.length === 0) return null;
    const rect = {
      x: Math.min(...rects.map((r) => r.x)),
      y: Math.min(...rects.map((r) => r.y)),
      right: Math.max(...rects.map((r) => r.right)),
      bottom: Math.max(...rects.map((r) => r.bottom)),
    };
    const extent = node.direction === 'row' ? rect.right - rect.x : rect.bottom - rect.y;
    splits[node.id] = {
      direction: node.direction,
      sizes: [...node.sizes],
      available: Math.max(0, extent - (node.children.length - 1) * METRICS.divider),
    };
    return rect;
  };
  walk(model.root);
  return splits;
}

// documents: the open documents, [{ id, path, docType, status }].
// notices: the workspace's notices, [{ kind: 'restore', failed: [{ path, reason }] }
// | { kind: 'update', version }].
function buildUiState({ model, layout, documents, notices = [], platform }) {
  const labels = documentLabels(documents.map((d) => d.path));
  const byId = new Map();
  const described = {};
  for (const d of documents) {
    const { badges, badge, banners } = describeStatus(d.status, { name: path.basename(d.path), filePath: d.path });
    byId.set(d.id, { d, badge });
    described[d.id] = { label: labels.get(d.path), path: d.path, docType: d.docType, dirty: d.status.dirty, badges, banners };
  }
  const panes = panesInOrder(model).map((pane) => ({
    paneId: pane.id,
    focused: pane.id === model.focusedPaneId,
    selected: pane.selected,
    tabs: pane.tabs.filter((docId) => byId.has(docId)).map((docId) => {
      const { d, badge } = byId.get(docId);
      return { docId, label: labels.get(d.path), path: d.path, dirty: d.status.dirty, badge };
    }),
  }));
  return {
    layout,
    list: model.list,
    empty: panes.every((pane) => pane.tabs.length === 0),
    platform,
    panes,
    documents: described,
    splits: splitRects(model, layout),
    notices: [...notices]
      .sort((a, b) => NOTICE_ORDER.indexOf(a.kind) - NOTICE_ORDER.indexOf(b.kind))
      .map(describeNotice)
      .filter(Boolean),
  };
}

module.exports = { buildUiState, NOTICE_MESSAGE };
