'use strict';

const path = require('node:path');
const { BADGE_ORDER } = require('./status');
const { panesInOrder, docsInOrder } = require('./workspace-model');

// Pure checks for the intents the host UI sends (ui:intent). The host UI
// reports what the user did; the main process decides. An intent passes only
// in exactly its shape, naming documents, panes and splits that exist; the
// result is a new object made of the checked fields only.
//
// Intent = { type: 'select' | 'close', docId }
//        | { type: 'banner', docId, kind, action }
//        | { type: 'open-dialog' } | { type: 'open-files', paths }
//        | { type: 'list', visible?, mode?, width? }
//        | { type: 'resize-split', splitId, sizes }
//        | { type: 'move-tab', docId, paneId, index } | { type: 'split', docId, paneId, edge }
//        | { type: 'drag', active }
//        | { type: 'notice', kind: 'restore'|'update', action: 'dismiss'|'restart' }   // restart: update only

const MAX_OPEN_FILES = 100;
const BANNER_KINDS = Object.freeze([...BADGE_ORDER, 'kit-updated', 'updated-from-disk']);
const BANNER_ACTION = /^[a-z-]{1,32}$/;
const LIST_MODES = ['list', 'thumbnails'];
const EDGES = ['left', 'right', 'top', 'bottom'];

const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isFiniteNumber = (v) => typeof v === 'number' && Number.isFinite(v);
const isAbsolutePath = (v) => typeof v === 'string' && v !== '' && !v.includes('\0') && path.isAbsolute(v);

// Per type: the fields it may have, and a check of the payload that returns
// the intent or null. Optional fields are listed but may be absent.
const TYPES = {
  select: { fields: ['docId'], check: (p, ids) => (ids.docIds.has(p.docId) ? { type: 'select', docId: p.docId } : null) },
  close: { fields: ['docId'], check: (p, ids) => (ids.docIds.has(p.docId) ? { type: 'close', docId: p.docId } : null) },
  banner: {
    fields: ['docId', 'kind', 'action'],
    check: (p, ids) => (ids.docIds.has(p.docId) && BANNER_KINDS.includes(p.kind)
      && typeof p.action === 'string' && BANNER_ACTION.test(p.action)
      ? { type: 'banner', docId: p.docId, kind: p.kind, action: p.action } : null),
  },
  'open-dialog': { fields: [], check: () => ({ type: 'open-dialog' }) },
  'open-files': {
    fields: ['paths'],
    check: (p) => (Array.isArray(p.paths) && p.paths.length >= 1 && p.paths.length <= MAX_OPEN_FILES
      && p.paths.every(isAbsolutePath) ? { type: 'open-files', paths: [...p.paths] } : null),
  },
  list: {
    fields: ['visible', 'mode', 'width'],
    check: (p) => {
      const intent = { type: 'list' };
      if ('visible' in p) {
        if (typeof p.visible !== 'boolean') return null;
        intent.visible = p.visible;
      }
      if ('mode' in p) {
        if (!LIST_MODES.includes(p.mode)) return null;
        intent.mode = p.mode;
      }
      if ('width' in p) {
        if (!isFiniteNumber(p.width)) return null;
        intent.width = p.width;
      }
      return intent;
    },
  },
  'resize-split': {
    fields: ['splitId', 'sizes'],
    check: (p, ids) => (ids.splitIds.has(p.splitId) && Array.isArray(p.sizes) && p.sizes.length >= 2
      && p.sizes.every((s) => isFiniteNumber(s) && s >= 0)
      ? { type: 'resize-split', splitId: p.splitId, sizes: [...p.sizes] } : null),
  },
  'move-tab': {
    fields: ['docId', 'paneId', 'index'],
    check: (p, ids) => (ids.docIds.has(p.docId) && ids.paneIds.has(p.paneId) && Number.isSafeInteger(p.index) && p.index >= 0
      ? { type: 'move-tab', docId: p.docId, paneId: p.paneId, index: p.index } : null),
  },
  split: {
    fields: ['docId', 'paneId', 'edge'],
    check: (p, ids) => (ids.docIds.has(p.docId) && ids.paneIds.has(p.paneId) && EDGES.includes(p.edge)
      ? { type: 'split', docId: p.docId, paneId: p.paneId, edge: p.edge } : null),
  },
  drag: { fields: ['active'], check: (p) => (typeof p.active === 'boolean' ? { type: 'drag', active: p.active } : null) },
  notice: {
    fields: ['kind', 'action'],
    check: (p) => ((p.kind === 'restore' && p.action === 'dismiss')
      || (p.kind === 'update' && (p.action === 'dismiss' || p.action === 'restart'))
      ? { type: 'notice', kind: p.kind, action: p.action } : null),
  },
};

// The intent a payload from the host UI describes, or null. ids: the doc,
// pane and split ids that exist now (intentIds).
function parseIntent(payload, ids) {
  if (!isPlainObject(payload) || typeof payload.type !== 'string' || !Object.hasOwn(TYPES, payload.type)) return null;
  const { fields, check } = TYPES[payload.type];
  if (!Object.keys(payload).every((key) => key === 'type' || fields.includes(key))) return null;
  return check(payload, ids);
}

// The ids an intent may name: documents with a tab, panes, splits.
function intentIds(model) {
  const splitIds = new Set();
  const walk = (node) => {
    if (node.kind !== 'split') return;
    splitIds.add(node.id);
    node.children.forEach(walk);
  };
  walk(model.root);
  return {
    docIds: new Set(docsInOrder(model)),
    paneIds: new Set(panesInOrder(model).map((pane) => pane.id)),
    splitIds,
  };
}

module.exports = { parseIntent, intentIds, MAX_OPEN_FILES, BANNER_KINDS };
