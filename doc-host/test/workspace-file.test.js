'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const {
  toWorkspaceFile, parseWorkspaceFile, pathsInFile, modelFromWorkspaceFile, fitBounds,
  readWorkspaceFile, writeWorkspaceFile,
} = require('../src/workspace-file');
const M = require('../src/workspace-model');

const tempDirs = [];

test.after(async () => {
  for (const dir of tempDirs) await fs.rm(dir, { recursive: true, force: true });
});

async function mkTemp() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ev-workspace-file-'));
  tempDirs.push(dir);
  return dir;
}

const WINDOW = { x: 100, y: 80, width: 1280, height: 860 };
const LIST = { visible: true, mode: 'list', width: 240 };

function pane(tabs, selected = tabs.length ? tabs[0] : null) {
  return { kind: 'pane', tabs, selected };
}
function split(children, direction = 'row', sizes = children.map(() => 1 / children.length)) {
  return { kind: 'split', direction, sizes, children };
}
function fileWith(overrides = {}) {
  return JSON.stringify({ version: 1, window: WINDOW, list: LIST, layout: pane([]), active: null, ...overrides });
}
function parsed(overrides) {
  const r = parseWorkspaceFile(fileWith(overrides));
  assert.equal(r.ok, true, r.error);
  return r.value;
}
function refused(text, reason) {
  const r = parseWorkspaceFile(text);
  assert.equal(r.ok, false);
  assert.match(r.error, reason);
}
const identity = (p) => p;

// Structure of a model with ids stripped (tabs stay as given).
function shape(node) {
  if (node.kind === 'pane') return { kind: 'pane', tabs: node.tabs, selected: node.selected };
  return { kind: 'split', direction: node.direction, sizes: node.sizes, children: node.children.map(shape) };
}

test('a model survives the round trip through the file', () => {
  let m = M.createModel();
  m = M.addTab(m, '/a.ev.html');
  m = M.addTab(m, '/b.ev.html');
  m = M.addTab(m, '/c.ev.html');
  m = M.splitPane(m, '/c.ev.html', 'p1', 'right');
  m = M.splitPane(m, '/b.ev.html', 'p1', 'bottom');
  m = M.selectTab(m, '/a.ev.html');
  m = M.setList(m, { visible: false, mode: 'thumbnails', width: 300 });
  const file = toWorkspaceFile(m, { pathOf: identity, window: WINDOW });
  const r = parseWorkspaceFile(JSON.stringify(file));
  assert.equal(r.ok, true);
  const back = modelFromWorkspaceFile(r.value, identity);
  assert.deepEqual(shape(back.root), shape(m.root));
  assert.deepEqual(M.panesInOrder(back).map((p) => [p.tabs, p.selected]), M.panesInOrder(m).map((p) => [p.tabs, p.selected]));
  assert.equal(M.activeDocId(back), M.activeDocId(m));
  assert.equal(M.panesInOrder(back).findIndex((p) => p.id === back.focusedPaneId),
    M.panesInOrder(m).findIndex((p) => p.id === m.focusedPaneId));
  assert.deepEqual(back.list, m.list);
  assert.deepEqual(r.value.window, WINDOW);
});

test('toWorkspaceFile maps ids to paths and writes no ids', () => {
  let m = M.addTab(M.createModel(), 'd1');
  const file = toWorkspaceFile(m, { pathOf: (id) => `/x/${id}.ev.html`, window: WINDOW });
  assert.deepEqual(file, {
    version: 1, window: WINDOW, list: LIST,
    layout: { kind: 'pane', tabs: ['/x/d1.ev.html'], selected: '/x/d1.ev.html' },
    active: '/x/d1.ev.html',
  });
  assert.equal(toWorkspaceFile(M.createModel(), { pathOf: identity, window: WINDOW }).active, null);
});

test('files that did not open are left out and empty panes disappear', () => {
  const value = parsed({ layout: split([pane(['/a.ev.html']), pane(['/b.ev.html'])]), active: '/b.ev.html' });
  const m = modelFromWorkspaceFile(value, (p) => (p === '/b.ev.html' ? null : p));
  assert.equal(m.root.kind, 'pane');
  assert.deepEqual(m.root.tabs, ['/a.ev.html']);
  assert.equal(m.root.selected, '/a.ev.html');
  assert.equal(m.focusedPaneId, m.root.id);
});

test('losing one pane of three keeps the others and rescales sizes', () => {
  const value = parsed({
    layout: split([pane(['/a']), pane(['/b']), pane(['/c'])], 'row', [0.2, 0.3, 0.5]),
  });
  const m = modelFromWorkspaceFile(value, (p) => (p === '/b' ? null : p));
  assert.equal(m.root.kind, 'split');
  assert.deepEqual(m.root.children.map((c) => c.tabs), [['/a'], ['/c']]);
  assert.ok(Math.abs(m.root.sizes[0] - 0.2 / 0.7) < 1e-9);
  assert.ok(Math.abs(m.root.sizes[1] - 0.5 / 0.7) < 1e-9);
});

test('nothing opened gives one empty pane with the saved list settings', () => {
  const value = parsed({
    list: { visible: false, mode: 'thumbnails', width: 300 },
    layout: split([pane(['/a']), pane(['/b'])]), active: '/a',
  });
  const m = modelFromWorkspaceFile(value, () => null);
  assert.deepEqual(m, { ...M.createModel(), list: { visible: false, mode: 'thumbnails', width: 300 } });
});

test('the list width of the file is clamped', () => {
  assert.equal(modelFromWorkspaceFile(parsed({ list: { ...LIST, width: 9999 } }), identity).list.width, 480);
  assert.equal(modelFromWorkspaceFile(parsed({ list: { ...LIST, width: 10 } }), identity).list.width, 160);
});

test('active selects its tab in its pane and focuses that pane', () => {
  const value = parsed({
    layout: split([pane(['/a', '/b'], '/a'), pane(['/c', '/d'], '/c')]),
    active: '/d',
  });
  const m = modelFromWorkspaceFile(value, identity);
  const [p1, p2] = M.panesInOrder(m);
  assert.equal(p1.selected, '/a');
  assert.equal(p2.selected, '/d');
  assert.equal(m.focusedPaneId, p2.id);
});

test('without active the first pane is focused; a missing selected selects the first tab', () => {
  const value = parsed({ layout: split([pane(['/a', '/b'], '/b'), pane(['/c'])]), active: null });
  const m = modelFromWorkspaceFile(value, (p) => (p === '/b' ? null : p));
  const [p1] = M.panesInOrder(m);
  assert.equal(m.focusedPaneId, p1.id);
  assert.equal(p1.selected, '/a');
});

test('when the active file did not open the first pane is focused', () => {
  const value = parsed({ layout: split([pane(['/a']), pane(['/b'])]), active: '/b' });
  const m = modelFromWorkspaceFile(value, (p) => (p === '/b' ? null : p));
  assert.equal(M.activeDocId(m), '/a');
});

test('ids are fresh and nextId is past all of them', () => {
  const value = parsed({ layout: split([pane(['/a']), split([pane(['/b']), pane(['/c'])], 'column')]) });
  const m = modelFromWorkspaceFile(value, identity);
  const ids = [];
  (function walk(n) { ids.push(n.id); if (n.kind === 'split') n.children.forEach(walk); })(m.root);
  assert.equal(new Set(ids).size, ids.length);
  const max = Math.max(...ids.map((id) => Number(id.slice(1))));
  assert.ok(m.nextId > max);
  assert.ok(ids.every((id) => M.findNode(m, id)));
});

test('invalid files are refused with a reason', () => {
  for (const [text, reason] of [['{', /JSON/], ['{"version":2}', /version/],
    [fileWith({ layout: pane(['relative.ev.html']) }), /absolute/],
    [fileWith({ layout: split([pane(['/a.ev.html'])]) }), /two children/]]) {
    refused(text, reason);
  }
});

test('further invalid shapes are refused', () => {
  refused('null', /object/);
  refused('[]', /object/);
  refused(fileWith({ window: { ...WINDOW, width: 199 } }), /window/);
  refused(fileWith({ window: { ...WINDOW, height: 100 } }), /window/);
  refused(fileWith({ window: { ...WINDOW, x: null } }), /window/);
  refused(fileWith({ window: null }), /window/);
  refused(fileWith({ window: { x: 0, y: 0, width: 'a', height: 300 } }), /window/);
  refused(fileWith({ list: { ...LIST, visible: 'yes' } }), /list/);
  refused(fileWith({ list: { ...LIST, mode: 'grid' } }), /list/);
  refused(fileWith({ list: { ...LIST, width: null } }), /list/);
  refused(fileWith({ list: undefined }), /list/);
  refused(fileWith({ layout: { kind: 'tab' } }), /kind/);
  refused(fileWith({ layout: split([pane(['/a']), pane(['/b'])], 'diagonal') }), /direction/);
  refused(fileWith({ layout: split([pane(['/a']), pane(['/b'])], 'row', [1]) }), /sizes/);
  refused(fileWith({ layout: split([pane(['/a']), pane(['/b'])], 'row', [1, 0]) }), /sizes/);
  refused(fileWith({ layout: split([pane(['/a']), pane(['/b'])], 'row', [1, -1]) }), /sizes/);
  refused(fileWith({ layout: split([pane(['/a']), pane(['/b'])], 'row', [1, 'x']) }), /sizes/);
  refused(fileWith({ layout: pane('/a') }), /tabs/);
  refused(fileWith({ layout: pane([5]) }), /absolute/);
  refused(fileWith({ layout: { kind: 'pane', tabs: ['/a'], selected: '/b' } }), /selected/);
  refused(fileWith({ layout: { kind: 'pane', tabs: ['/a'], selected: 3 } }), /selected/);
  refused(fileWith({ layout: pane(['/a']), active: '/b' }), /active/);
  refused(fileWith({ layout: pane(['/a']), active: 7 }), /active/);
});

test('layout depth is limited to 32', () => {
  const nested = (levels) => {
    let node = pane(['/leaf']);
    for (let i = 1; i < levels; i += 1) node = split([node, pane([`/p${i}`])]);
    return node;
  };
  assert.equal(parseWorkspaceFile(fileWith({ layout: nested(32) })).ok, true);
  refused(fileWith({ layout: nested(33) }), /depth/);
});

test('sizes are rescaled to sum 1', () => {
  const value = parsed({ layout: split([pane(['/a']), pane(['/b'])], 'row', [1, 3]) });
  assert.deepEqual(value.layout.sizes, [0.25, 0.75]);
});

test('a path listed twice keeps its first place', () => {
  const r = parseWorkspaceFile(fileWith({ layout: split([pane(['/a.ev.html', '/b.ev.html']), pane(['/a.ev.html', '/c.ev.html'])]) }));
  assert.equal(r.ok, true);
  assert.deepEqual(pathsInFile(r.value), ['/a.ev.html', '/b.ev.html', '/c.ev.html']);
});

test('a dropped duplicate that was selected leaves selected null; an emptied pane is valid and removed on restore', () => {
  const r = parseWorkspaceFile(fileWith({
    layout: split([pane(['/a', '/b'], '/a'), pane(['/a'], '/a'), pane(['/c', '/b'], '/b')]),
    active: '/a',
  }));
  assert.equal(r.ok, true);
  const [p1, p2, p3] = r.value.layout.children;
  assert.equal(p1.selected, '/a');
  assert.deepEqual(p2, { kind: 'pane', tabs: [], selected: null });
  assert.deepEqual(p3.tabs, ['/c']);
  assert.equal(p3.selected, null);
  const m = modelFromWorkspaceFile(r.value, identity);
  assert.deepEqual(M.panesInOrder(m).map((p) => p.tabs), [['/a', '/b'], ['/c']]);
  assert.equal(M.panesInOrder(m)[1].selected, '/c');
});

test('a split that loses all but one child through duplicates collapses on restore', () => {
  const r = parseWorkspaceFile(fileWith({ layout: split([pane(['/a']), pane(['/a'])]) }));
  assert.equal(r.ok, true);
  const m = modelFromWorkspaceFile(r.value, identity);
  assert.equal(m.root.kind, 'pane');
  assert.deepEqual(m.root.tabs, ['/a']);
});

test('pathsInFile lists paths in layout order', () => {
  const value = parsed({ layout: split([pane(['/a', '/b']), split([pane(['/c']), pane(['/d'])], 'column')]) });
  assert.deepEqual(pathsInFile(value), ['/a', '/b', '/c', '/d']);
});

test('fitBounds keeps visible bounds and moves lost ones to the primary display', () => {
  const displays = [{ workArea: { x: 0, y: 25, width: 1440, height: 875 } }];
  assert.deepEqual(fitBounds({ x: 100, y: 80, width: 1280, height: 800 }, displays), { x: 100, y: 80, width: 1280, height: 800 });
  assert.deepEqual(fitBounds({ x: 3000, y: 80, width: 1280, height: 800 }, displays), { x: 80, y: 63, width: 1280, height: 800 });
  assert.deepEqual(fitBounds({ x: 0, y: 25, width: 3000, height: 2000 }, displays), { x: 0, y: 25, width: 1440, height: 875 });
});

test('fitBounds: null stays null, a sliver of overlap is not enough, a second display counts', () => {
  const displays = [
    { workArea: { x: 0, y: 25, width: 1440, height: 875 } },
    { workArea: { x: 1440, y: 0, width: 1920, height: 1080 } },
  ];
  assert.equal(fitBounds(null, displays), null);
  // only 50 px of overlap with the first display: moved to the primary display
  assert.deepEqual(fitBounds({ x: 1390, y: 80, width: 1280, height: 800 }, [displays[0]]), { x: 80, y: 63, width: 1280, height: 800 });
  // fully on the second display: kept
  assert.deepEqual(fitBounds({ x: 1600, y: 100, width: 1000, height: 700 }, displays), { x: 1600, y: 100, width: 1000, height: 700 });
  // 100x100 of overlap is enough
  assert.deepEqual(fitBounds({ x: 1340, y: 800, width: 400, height: 400 }, [displays[0]]), { x: 1340, y: 800, width: 400, height: 400 });
  // lost and oversized: capped, then centred
  assert.deepEqual(fitBounds({ x: -9000, y: 0, width: 5000, height: 3000 }, [displays[0]]), { x: 0, y: 25, width: 1440, height: 875 });
});

test('a broken workspace.json is kept as workspace.json.bad', async () => {
  const dir = await mkTemp();
  const file = path.join(dir, 'workspace.json');
  await fs.writeFile(file, '{');
  await fs.writeFile(`${file}.bad`, 'older');
  assert.equal(await readWorkspaceFile(file), null);
  assert.equal(await fs.readFile(`${file}.bad`, 'utf8'), '{');
  await assert.rejects(fs.stat(file), { code: 'ENOENT' });
});

test('an invalid but well-formed workspace.json is kept as .bad too', async () => {
  const dir = await mkTemp();
  const file = path.join(dir, 'workspace.json');
  await fs.writeFile(file, '{"version":2}');
  assert.equal(await readWorkspaceFile(file), null);
  assert.equal(await fs.readFile(`${file}.bad`, 'utf8'), '{"version":2}');
});

test('a missing workspace.json reads as null and creates nothing', async () => {
  const dir = await mkTemp();
  assert.equal(await readWorkspaceFile(path.join(dir, 'workspace.json')), null);
  assert.deepEqual(await fs.readdir(dir), []);
});

test('an unreadable workspace.json that cannot be renamed still reads as null', async () => {
  const dir = await mkTemp();
  const file = path.join(dir, 'workspace.json');
  await fs.mkdir(file); // reading a directory fails with EISDIR
  await fs.mkdir(`${file}.bad`);
  await fs.writeFile(path.join(`${file}.bad`, 'x'), 'x'); // renaming over a non-empty directory fails
  assert.equal(await readWorkspaceFile(file), null);
});

test('writeWorkspaceFile leaves no temporary file', async () => {
  const dir = await mkTemp();
  const file = path.join(dir, 'workspace.json');
  const value = parsed({ layout: split([pane(['/a']), pane(['/b'])]), active: '/b' });
  await writeWorkspaceFile(file, value);
  assert.deepEqual(await fs.readdir(dir), ['workspace.json']);
  assert.deepEqual(await readWorkspaceFile(file), value);
});
