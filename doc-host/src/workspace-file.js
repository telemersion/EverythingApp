'use strict';

// The workspace file (<userData>/workspace.json): format, validation, conversion to and
// from the workspace model, the window-bounds fit and the read/write helpers.

const fs = require('node:fs/promises');
const path = require('node:path');
const model = require('./workspace-model');

const VERSION = 1;
const MAX_DEPTH = 32;
const MIN_WINDOW = 200;
const MIN_OVERLAP = 100;

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isFiniteNumber = (v) => typeof v === 'number' && Number.isFinite(v);
const isAbsolutePath = (v) => typeof v === 'string' && v !== '' && path.isAbsolute(v);

// ---- model -> file ------------------------------------------------------

function toWorkspaceFile(m, { pathOf, window }) {
  const convert = (node) => {
    if (node.kind === 'pane') {
      return { kind: 'pane', tabs: node.tabs.map(pathOf), selected: node.selected === null ? null : pathOf(node.selected) };
    }
    return { kind: 'split', direction: node.direction, sizes: [...node.sizes], children: node.children.map(convert) };
  };
  const active = model.activeDocId(m);
  return {
    version: VERSION,
    window: { x: window.x, y: window.y, width: window.width, height: window.height },
    list: { visible: m.list.visible, mode: m.list.mode, width: m.list.width },
    layout: convert(m.root),
    active: active === null ? null : pathOf(active),
  };
}

// ---- validation ---------------------------------------------------------

class Invalid extends Error {}
function fail(message) { throw new Invalid(message); }

function checkWindow(w) {
  if (!isObject(w) || !['x', 'y', 'width', 'height'].every((k) => isFiniteNumber(w[k]))
    || w.width < MIN_WINDOW || w.height < MIN_WINDOW) {
    fail('window must have finite x, y, width and height, with width and height of at least 200');
  }
  return { x: w.x, y: w.y, width: w.width, height: w.height };
}

function checkList(l) {
  if (!isObject(l) || typeof l.visible !== 'boolean' || (l.mode !== 'list' && l.mode !== 'thumbnails')
    || !isFiniteNumber(l.width)) {
    fail('list must have a boolean visible, a mode of list or thumbnails and a finite width');
  }
  return { visible: l.visible, mode: l.mode, width: l.width };
}

function checkNode(node, depth) {
  if (depth > MAX_DEPTH) fail(`layout is nested deeper than ${MAX_DEPTH} levels (depth limit)`);
  if (!isObject(node)) fail('layout node must be an object');
  if (node.kind === 'pane') {
    if (!Array.isArray(node.tabs)) fail('pane tabs must be an array');
    for (const tab of node.tabs) {
      if (!isAbsolutePath(tab)) fail('pane tabs must be absolute path strings');
    }
    if (node.selected !== null && !node.tabs.includes(node.selected)) fail('pane selected must be one of its tabs or null');
    return { kind: 'pane', tabs: [...node.tabs], selected: node.selected };
  }
  if (node.kind === 'split') {
    if (node.direction !== 'row' && node.direction !== 'column') fail('split direction must be row or column');
    if (!Array.isArray(node.children) || node.children.length < 2) fail('a split needs at least two children');
    if (!Array.isArray(node.sizes) || node.sizes.length !== node.children.length
      || !node.sizes.every((s) => isFiniteNumber(s) && s > 0)) {
      fail('split sizes must be as many positive finite numbers as children');
    }
    const sum = node.sizes.reduce((a, b) => a + b, 0);
    return {
      kind: 'split',
      direction: node.direction,
      sizes: node.sizes.map((s) => s / sum),
      children: node.children.map((child) => checkNode(child, depth + 1)),
    };
  }
  return fail('layout node kind must be pane or split');
}

// Keeps the first place of each path (layout order); a pane whose selected tab was
// dropped as a later duplicate gets selected: null.
function dropDuplicates(node, seen) {
  if (node.kind === 'pane') {
    const tabs = node.tabs.filter((tab) => {
      if (seen.has(tab)) return false;
      seen.add(tab);
      return true;
    });
    return { kind: 'pane', tabs, selected: tabs.includes(node.selected) ? node.selected : null };
  }
  return { ...node, children: node.children.map((child) => dropDuplicates(child, seen)) };
}

function collectPaths(node, out) {
  if (node.kind === 'pane') out.push(...node.tabs);
  else node.children.forEach((child) => collectPaths(child, out));
  return out;
}

function parseWorkspaceFile(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch (err) {
    return { ok: false, error: `Not valid JSON: ${err.message}` };
  }
  try {
    if (!isObject(data)) fail('The file must contain a JSON object');
    if (data.version !== VERSION) fail(`Unsupported version ${JSON.stringify(data.version)}; expected ${VERSION}`);
    const window = checkWindow(data.window);
    const list = checkList(data.list);
    const checked = checkNode(data.layout, 1);
    const all = collectPaths(checked, []);
    if (data.active !== null && !all.includes(data.active)) fail('active must be a path of the layout or null');
    // An occurrence of a path is kept only if it is the first one in layout order.
    const layout = dropDuplicates(checked, new Set());
    return { ok: true, value: { version: VERSION, window, list, layout, active: data.active } };
  } catch (err) {
    if (err instanceof Invalid) return { ok: false, error: err.message };
    throw err;
  }
}

function pathsInFile(value) {
  return collectPaths(value.layout, []);
}

// ---- file -> model ------------------------------------------------------

// Builds the whole tree first, with a placeholder tab wherever a path did not open (and in
// panes that are empty), then removes the placeholders with the model's own removeTab, so
// the collapse rules (empty panes, rescaled sizes, one-child splits) live only there.
function modelFromWorkspaceFile(value, idOf) {
  let counter = 0;
  const nextId = () => { counter += 1; return counter; };
  const placeholders = [];
  const wanted = new Map(); // pane id -> doc id that pane should select
  const placeholder = () => {
    const id = `\u0000missing-${placeholders.length}`;
    placeholders.push(id);
    return id;
  };
  const build = (node) => {
    if (node.kind === 'pane') {
      const id = `p${nextId()}`;
      const tabs = [];
      let selected = null;
      for (const p of node.tabs) {
        const docId = idOf(p);
        tabs.push(docId === null || docId === undefined ? placeholder() : docId);
        if (p === node.selected && docId !== null && docId !== undefined) selected = docId;
      }
      if (tabs.length === 0) tabs.push(placeholder());
      wanted.set(id, selected);
      return { kind: 'pane', id, tabs, selected: tabs[0] };
    }
    const id = `s${nextId()}`;
    return { kind: 'split', id, direction: node.direction, sizes: [...node.sizes], children: node.children.map(build) };
  };
  const root = build(value.layout);
  const paneIds = [];
  (function walk(n) { if (n.kind === 'pane') paneIds.push(n.id); else n.children.forEach(walk); })(root);

  let m = { ...model.createModel(), root, focusedPaneId: paneIds[0], nextId: counter + 1 };
  for (const id of placeholders) m = model.removeTab(m, id);

  if (model.docsInOrder(m).length === 0) return model.setList(model.createModel(), value.list);

  for (const pane of model.panesInOrder(m)) {
    const want = wanted.get(pane.id);
    m = model.selectTab(m, pane.tabs.includes(want) ? want : pane.tabs[0]);
  }
  const activeId = value.active === null ? null : idOf(value.active);
  const holder = activeId === null || activeId === undefined ? null : model.panesInOrder(m).find((p) => p.tabs.includes(activeId));
  m = holder ? model.selectTab(m, activeId) : model.focusPane(m, model.panesInOrder(m)[0].id);
  return model.setList(m, value.list);
}

// ---- window bounds ------------------------------------------------------

function overlap(a, b) {
  return {
    width: Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x),
    height: Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y),
  };
}

function fitBounds(bounds, displays) {
  if (bounds === null || bounds === undefined || !displays || displays.length === 0) return null;
  const visible = displays.find(({ workArea }) => {
    const o = overlap(bounds, workArea);
    return o.width >= MIN_OVERLAP && o.height >= MIN_OVERLAP;
  });
  if (visible) {
    const wa = visible.workArea;
    return { x: bounds.x, y: bounds.y, width: Math.min(bounds.width, wa.width), height: Math.min(bounds.height, wa.height) };
  }
  const wa = displays[0].workArea;
  const width = Math.min(bounds.width, wa.width);
  const height = Math.min(bounds.height, wa.height);
  return { x: Math.round(wa.x + (wa.width - width) / 2), y: Math.round(wa.y + (wa.height - height) / 2), width, height };
}

// ---- disk ---------------------------------------------------------------

async function readWorkspaceFile(filePath) {
  let text;
  try {
    text = await fs.readFile(filePath, 'utf8');
  } catch (err) {
    if (err && err.code === 'ENOENT') return null;
    await keepAsBad(filePath);
    return null;
  }
  const result = parseWorkspaceFile(text);
  if (result.ok) return result.value;
  await keepAsBad(filePath);
  return null;
}

// A broken file must never block startup: if the rename fails the file just stays.
async function keepAsBad(filePath) {
  try {
    await fs.rename(filePath, `${filePath}.bad`);
  } catch {
    // ignored on purpose
  }
}

async function writeWorkspaceFile(filePath, value) {
  const tmp = `${filePath}.tmp`;
  await fs.writeFile(tmp, `${JSON.stringify(value, null, 2)}\n`);
  await fs.rename(tmp, filePath);
}

module.exports = {
  toWorkspaceFile, parseWorkspaceFile, pathsInFile, modelFromWorkspaceFile, fitBounds,
  readWorkspaceFile, writeWorkspaceFile,
};
