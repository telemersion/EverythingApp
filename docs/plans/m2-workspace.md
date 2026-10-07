# M2 "Workspace" Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven-development (recommended) or executing-plans to implement this plan task by task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One host window holds every open document: panes that split like Obsidian, a tab strip per pane, a document list with thumbnails, banners instead of background dialogs, a close summary, a restored workspace, and kit 1.1.0 with an "Update kit" command — while no document can draw or fake any host UI.

**Architecture:** The M1 `DocumentWindow` splits in two. `Document` (one open file: its sandboxed view, save loop, external changes, status) knows nothing about windows; `Workspace` owns the single `BaseWindow`, the documents and a pure workspace model (layout tree, tabs, focus). Pure modules carry every rule that can be tested without Electron: the model, the geometry, badges and banners, the workspace file, the load tags, UI intents and thumbnail triggers. One host-UI `WebContentsView` (plain HTML/CSS/JS, own in-memory session and preload) lies beneath the document views and renders the state the main process pushes; it reports intents, never decides.

**Tech Stack:** Node.js ≥ 22 (tested on 25.9), Electron ≥ 35 (tested on 44.5.1), jsdom 30 (tests only), CommonJS, `node:test`.

**Spec:** [firstSpec.md](../../firstSpec.md) (M2 section, Host behaviour, Security model), [ADR 0001](../adr/0001-host-ui-outside-documents.md), [glossary](../reference/glossary.md). The design decisions behind every task (Q1–Q23, 2026-10-07) are logged in `.superpowers/sdd/decisions.md` (local); this plan restates each one where a task needs it.

## Global Constraints

Everything from the M1 plan's Global Constraints still holds ([m1-loop.md](m1-loop.md#global-constraints)): repository root `EverythingApp/`, commands from `doc-host/`, CommonJS with `'use strict';`, **no runtime dependencies** (dev: `electron`, `jsdom`), LF only, the `ev` namespace, the fixed frame, published kits never change, the version store rules, size limits (data 50 MB, file 60 MB), English UI text, `ELECTRON_RUN_AS_NODE` handling via `tools/start.js`, and the commit trailer

New for M2:

- The host has exactly one window, the workspace. Closing it quits the host on every platform.
- A document is open at most once: one tab in one pane. Paths are compared after `fs.promises.realpath`.
- Host messages appear only in host areas (document list, tab strips, banner rows). A document's view never overlaps them; banners push the document down.
- The host-UI view and document views never share a session. `ui:*` messages are accepted only from the host-UI view's web contents; `doc:*` messages only from a registered document view, and only from its current page load.
- The host UI inserts document-derived strings (file names, paths, document types) with `textContent` only, never as HTML.
- Document views use `disableDialogs: true`; `alert()` does nothing and `confirm()` returns `false`.
- Metrics (px): tab strip 32, banner 36, "+N more" row 24, divider 4, document list default width 240 (160–480), thumbnail width = list width − 16.
- Timing: thumbnail after a change 2000 ms, "Updated from disk" banner 4000 ms, save request timeout 5000 ms (unchanged).
- `workspace.json` lives at `<userData>/workspace.json`; a broken file is moved to `workspace.json.bad`.
- Tabs and list entries show the file name; when two open documents share a file name, both show `name · parent folder name`.
- Saving stays explicit: no autosave anywhere.

## Review Focus

The five conditions most likely to bite a user that the spec implies but no feature test exercises on its own. Each line names the task whose tests pin it.

1. **Restoring a workspace whose files changed meanwhile**: one path deleted, one no longer conforming, one listed twice, one not a document. Expected: the host starts, opens the rest in place, names each failure once in the restore notice, never hangs. *(Task 7 duplicate/invalid paths; Task 9 smoke step "restore with missing and broken files".)*
2. **Same file names**: `hours.ev.html` open from two or three folders, two of which have the same folder name. Expected: every label differs. *(Task 6 `documentLabels` tests.)*
3. **A stuck drag overlay**: the pointer is released outside the window, or the window loses focus, during a tab or divider drag. Expected: the host UI drops back beneath the documents; documents stay usable. *(Task 11 smoke step "a drag ends when the window loses focus".)*
4. **Closing or quitting while a save runs**: Cmd+W or the close summary while a save is in flight. Expected: the close waits for the save and closes only if nothing is left unsaved. *(Task 9 smoke step "closing waits for a running save".)*
5. **A restored window on a display that is gone**: `workspace.json` holds bounds on a disconnected monitor. Expected: the window appears on the primary display. *(Task 7 `fitBounds` tests.)*

---

## File structure

```
doc-host/
  src/
    workspace-model.js  # NEW pure: layout tree, tabs, focus, list settings
    layout.js           # NEW pure: rectangles for list, tab strips, banner rows, documents, dividers
    status.js           # NEW pure: badges and banners from a document's status; exact copy
    labels.js           # NEW pure: tab and list labels from paths
    workspace-file.js   # NEW: workspace.json format, validation, restore, window bounds (Node fs)
    load-tags.js        # NEW pure: which page load's messages count
    ui-intents.js       # NEW pure: validate messages from the host UI
    ui-state.js         # NEW pure: the state object sent to the host UI
    thumbnail-triggers.js # NEW pure: when to capture a thumbnail
    document.js         # NEW: one open document without a window (from document-window.js)
    workspace.js        # NEW: the window, its documents, sheets, close summary, quit, restore
    host-ui.js          # NEW: the host-UI view, its session and ev-ui:// files
    ui-preload.js       # NEW: window.evUi for the host UI (sandboxed)
    thumbnails.js       # NEW: capturePage → data URL
    ui/
      index.html        # NEW host UI page
      ui.css
      ui.js
    document-window.js  # REMOVED in Task 9 (thin wrapper around Document in Task 8)
    open.js             # readDocumentFile (pure fs) replaces openPath
    registry.js         # byWindow removed
    preload.js          # load tag, doc:hello
    ipc.js              # doc:* with load tags, ui:intent
    security.js         # disableDialogs, hardening for the host-UI session
    urls.js             # ev-ui:// rules
    protocol.js         # registers ev-ui as privileged, serves host-UI files
    menu.js             # M2 menu
    main.js             # one workspace, restore, quit flow
    watch.js            # behaviour → outsideData
    write.js            # writeDocument: optional kit, optional data
    splice.js           # replaceKit
  kit/
    ev-kit-1.1.0.js     # NEW published kit
    index.js            # newestKit
  tools/
    assemble.js         # meta.json may pin a kitVersion
    smoke.js            # several documents, workspace, kit update
    spikes/             # Task 1 only, deleted before its commit
  fixtures/
    src/outdated-kit/   # NEW: a small note document pinned to kit 1.0.0
    outdated-kit.ev.html
  test/
    workspace-model.test.js  layout.test.js  status.test.js  labels.test.js
    workspace-file.test.js   load-tags.test.js  ui-intents.test.js  ui-state.test.js
    thumbnail-triggers.test.js  open.test.js
docs/
  document-spec.md      # rule 4 (kit 1.1), new rule 9 (no native dialogs), §5 (kit 1.1.0)
```

---

### Task 1: Spikes — capture, drag overlay, dialogs, shortcuts

Four questions decide details of later tasks. Answer them with throwaway scripts in `tools/spikes/` (run through Electron with `ELECTRON_RUN_AS_NODE` cleared, screen on and unlocked), write the answers into the "Spike results" section at the end of this plan, delete the scripts, commit the plan.

**Files:**

- Create (temporary): `doc-host/tools/spikes/*.js`

- Modify: `docs/plans/m2-workspace.md` (section "Spike results")

- [ ] **Step 1: Capture.** One `BaseWindow` (600×400, shown) with four sandboxed `WebContentsView`s loading coloured `data:` pages: visible; attached with `setVisible(false)`; attached then removed with `removeChildView`; never attached. Wait for load, then `capturePage()` each (default options and `{ stayHidden: true }`). Record per view: error or not, `isEmpty()`, size, centre pixel colour, `document.visibilityState` before and after.
  Decision rule: if the **visible** view cannot be captured, stop and report to the user (thumbnails need another approach). Otherwise record which hiding method can be captured; Task 9 hides tabs with that method (prefer `setVisible(false)`), and Task 12 captures hidden documents only if it works.
  Note: in an environment without an active display surface every capture fails with "Current display surface not available for capture" (seen on 2026-10-07 while the screen was off); rerun with the screen on before concluding.

- [ ] **Step 2: Drag overlay.** Two document-like views side by side over a host view at index 0 that draws a full-window page. Start a pointer drag in the host view (a 200 px strip at the top), then on drag start call `win.contentView.addChildView(hostView)` (raise) and `hostView.setBackgroundColor('#00000000')` with a transparent page background; move across the document views; on `pointerup` call `win.contentView.addChildView(hostView, 0)` (lower). Record: do pointer events keep arriving in the host view while over the document views; are the documents visible through it; does `addChildView(view, 0)` put it back beneath; what happens on release outside the window (`pointercancel`, `lostpointercapture`, window `blur`).
  Decision rule: if raising does not deliver the pointer, Task 11 replaces document views with their thumbnails during a drag (hide them) and records that in its first step.

- [ ] **Step 3: Dialogs.** A sandboxed view with `disableDialogs: true` runs `const t = Date.now(); alert('x'); const c = confirm('y'); console.log(Date.now() - t, c)`. Record that no box appears, the time is near 0 and `c === false`.

- [ ] **Step 4: Shortcuts.** A menu with accelerators `Ctrl+Tab`, `Ctrl+Shift+Tab`, `CmdOrCtrl+1`, `CmdOrCtrl+Alt+Right`, `CmdOrCtrl+\` while a sandboxed view has focus. Record which ones fire on macOS (and Windows if available). Any that do not fire are handled in Task 9 by a `before-input-event` listener on every web contents instead of the menu accelerator.

- [ ] **Step 5: Record and commit**

```bash
rm -r tools/spikes
git add ../docs/plans/m2-workspace.md
git commit -m "docs: M2 spike results"
```

---

### Task 2: Kit 1.1.0 — fallback save UI

Decision Q14: the document marks its fallback UI; the kit hides it in the host and wires it in the browser. `doc.hosted` stays.

**Files:**

- Create: `doc-host/kit/ev-kit-1.1.0.js` (copy of 1.0.0 plus the additions below), `doc-host/fixtures/src/outdated-kit/{meta.json,style.css,script.js,data.json}`, `doc-host/fixtures/outdated-kit.ev.html`
- Modify: `doc-host/kit/published.json` (via `tools/pin-kit.js`), `doc-host/tools/assemble.js`, `doc-host/fixtures/src/hours-sheet/script.js`, `doc-host/fixtures/src/todo-list/script.js`, both assembled fixtures, `doc-host/test/kit.test.js`, `doc-host/test/fixtures.test.js`, `docs/document-spec.md`

**Interfaces:**

- Produces: published kit `1.1.0` (API 1), the current kit; marks `data-ev-fallback="save"` (button: saves in the browser) and `data-ev-fallback="status"` (text `Saved` / `Unsaved changes`, attribute `data-ev-state="saved|unsaved"`); `EvKit.version === '1.1.0'`; `tools/assemble.js` honours an optional `"kitVersion"` in `meta.json`.

- [ ] **Step 1: Write the failing tests** in `test/kit.test.js` (they load documents built from `currentKit()`, which must become 1.1.0):

```js
test('kit 1.1.0 is published for API 1 and is the current kit', () => {
  assert.equal(currentKit(1).version, '1.1.0');
  assert.ok(findKit('1.0.0'), 'kit 1.0.0 stays published');
});

test('with a host, elements marked data-ev-fallback are hidden', () => {
  const script = '\nwindow.testDoc = EvKit.init();\n' +
    'document.getElementById("ev-app").innerHTML = \'<button data-ev-fallback="save">Save</button><span data-ev-fallback="status"></span>\';\n';
  const window = load(makeDocument({ script }), { host: fakeHost() });
  for (const el of window.document.querySelectorAll('[data-ev-fallback]')) {
    assert.equal(window.getComputedStyle(el).display, 'none');
  }
});

test('without a host, the marked Save button saves through the fallback', async () => {
  const written = [];
  const script = '\nwindow.testDoc = EvKit.init();\n' +
    'document.getElementById("ev-app").innerHTML = \'<button data-ev-fallback="save">Save</button>\';\n';
  const window = load(makeDocument({ script }), { picker: written }); // load() installs a fake showSaveFilePicker
  window.testDoc.changed();
  window.document.querySelector('[data-ev-fallback="save"]').click();
  await new Promise((r) => setTimeout(r, 0));
  assert.deepEqual(written, [window.testDoc.toHtml()]);
});

test('without a host, the marked status shows the save state', async () => {
  const script = '\nwindow.testDoc = EvKit.init();\n' +
    'document.getElementById("ev-app").innerHTML = \'<span data-ev-fallback="status"></span>\';\n';
  const window = load(makeDocument({ script }));
  await new Promise((r) => setTimeout(r, 0));               // let DOMContentLoaded run
  const status = window.document.querySelector('[data-ev-fallback="status"]');
  assert.equal(status.textContent, 'Saved');                // set on DOMContentLoaded
  assert.equal(status.getAttribute('data-ev-state'), 'saved');
  window.testDoc.changed();
  assert.equal(status.textContent, 'Unsaved changes');
  assert.equal(status.getAttribute('data-ev-state'), 'unsaved');
});
```

Extend `load(html, { host, picker })`: with `picker`, `beforeParse` defines `window.showSaveFilePicker` returning a handle whose `queryPermission`/`requestPermission` resolve `'granted'` and whose `createWritable()` returns `{ write: (t) => picker.push(t), close: async () => {} }`. (jsdom has no IndexedDB; the kit already treats a failing store as "no remembered handle".)

In `test/fixtures.test.js` add:

```js
test('outdated-kit.ev.html is pinned to kit 1.0.0, every other fixture uses the current kit', () => {
  for (const name of documents) {
    const { parts } = checkDocument(fs.readFileSync(path.join(FIXTURES, name), 'utf8'));
    assert.equal(parts.kitVersion, name === 'outdated-kit.ev.html' ? '1.0.0' : currentKit().version, name);
  }
});
```

and change the hours-sheet and to-do browser tests to find the Save button and status by `[data-ev-fallback="save"]` / `[data-ev-fallback="status"]`, and the hosted tests to assert those elements are hidden (computed `display` is `none`) instead of absent.

- [ ] **Step 2: Run to verify they fail**

Run: `npm test`
Expected: FAIL — `currentKit(1).version` is `'1.0.0'`, no fallback marks handled, no `outdated-kit.ev.html`.

- [ ] **Step 3: Write `kit/ev-kit-1.1.0.js`**

Start from `ev-kit-1.0.0.js` unchanged and add, keeping everything else byte-for-byte equal (header comment says 1.1.0, `KIT_VERSION = '1.1.0'`):

- In the host branch: append one `<style>` element to `document.head` with exactly `[data-ev-fallback] { display: none !important; }` (the DOM change never reaches a saved file: saving rebuilds from the frame).

- In the browser branch: a delegated `click` listener on `document` that calls `save()` for a click inside `[data-ev-fallback="save"]` (and `preventDefault()`s it); a function that sets `textContent` (`Saved` / `Unsaved changes`) and `data-ev-state` (`saved` / `unsaved`) on every `[data-ev-fallback="status"]`, run on `DOMContentLoaded` and from `setDirty` (before `onDirtyChange`).
  The text must pass `tools/pin-kit.js`'s checks (no CR, no `</script`, no `<!--`).

- [ ] **Step 4: Publish it**

Run: `node tools/pin-kit.js 1.1.0 1`
Expected: `Published kit 1.1.0 (API v1): <sha256>`; `kit/published.json` lists 1.0.0 and 1.1.0.

- [ ] **Step 5: `tools/assemble.js` honours `meta.kitVersion`**

`const kit = meta.kitVersion ? findKit(meta.kitVersion) : currentKit();` — exit 1 with `Kit <v> is not a published kit.` if `findKit` returns null. Update the usage comment.

- [ ] **Step 6: Fixtures**

- `fixtures/src/outdated-kit/`: `meta.json` `{"lang":"en","title":"Note","docType":"note","docTypeVersion":"1.0","kitVersion":"1.0.0"}`, `data.json` `{"text":""}`, a short `style.css`, and a `script.js` in the 1.0 style: one `<textarea id="text">` bound to `data.text` (calls `doc.changed()` on input), plus a Save button and status line rendered only when `!doc.hosted` and wired by the script itself, as 1.0 documents do.

- Hours sheet and to-do list: render the Save button and status always, marked `data-ev-fallback="save"` / `data-ev-fallback="status"`; remove `showStatus`, the `onDirtyChange` option and the script's own Save click handler (the kit wires them); in `style.css` the `#status.dirty` rule becomes `[data-ev-state="unsaved"]`. The hours sheet keeps its two hint texts chosen by `doc.hosted`.

- Reassemble all three: `npm run assemble -- fixtures/src/<name> fixtures/<name>.ev.html`.

- [ ] **Step 7: Document specification**

In `docs/document-spec.md`: status line `Kit 1.1.0`; rule 4 becomes:

> 4. **The host owns saving.** When `window.evHost` exists, the document registers neither a Ctrl/Cmd+S handler nor `beforeunload`, and shows no working Save button. Mark the Save button `data-ev-fallback="save"` and the save status `data-ev-fallback="status"`: the kit hides both inside the host, and in a browser saves on the button and keeps the status text (`Saved` / `Unsaved changes`) and `data-ev-state` (`saved` / `unsaved`) current. Render them once and keep them in the page; style them with `[data-ev-state]`. Documents written for kit 1.0.0 decide from `doc.hosted` instead; that still works. *Why:* inside the host a Save button would do nothing (`save()` returns `false`), and the host ignores `beforeunload` (it cannot block closing).

Add rule 9:

> 9. **No native dialogs.** Inside the host `alert()` does nothing and `confirm()` and `prompt()` return `false` / `null`. Ask for confirmation inside your own UI. *Why:* Electron shows these dialogs as native message boxes that look like the host's own, name no document and can be raised from a hidden tab; it offers no way to show them anywhere else, so the host turns them off (ADR 0001).

In §5 rename the heading to "kit 1.1.0", add the two marks to the `hosted` row's meaning, and add a row `version` — `'1.1.0'`. In §9 mention `"kitVersion"` in `meta.json` (pins an older published kit; for tests only).

- [ ] **Step 8: Run the tests**

Run: `npm test`
Expected: PASS (all M1 tests plus the new ones).

- [ ] **Step 9: Commit**

```bash
git add kit tools/assemble.js fixtures test ../docs/document-spec.md
git commit -m "feat(kit): kit 1.1.0 hides and wires the fallback save UI"
```

---

### Task 3: Replacing the kit in a file

Decision Q15: a kit update is a write that replaces the kit (and `data-kit-version`) and, if the document is dirty, the data in the same write.

**Files:**

- Modify: `doc-host/src/splice.js`, `doc-host/src/write.js`, `doc-host/kit/index.js`
- Test: `doc-host/test/splice.test.js`, `doc-host/test/write.test.js`, `doc-host/test/kit.test.js`

**Interfaces:**

- Produces:
  
  - `newestKit(api: number) → kit | null` in `kit/index.js` (newest published kit of that API; `currentKit` stays as an alias for the max API).
  - `outdatedKit(parts) → { from: string, to: string } | null` in `kit/index.js`: `to` is `newestKit(Number(parts.api)).version` when it differs from `parts.kitVersion`.
  - `replaceKit(html: string, kit: { version: string, text: string }) → string` in `src/splice.js`: rebuilds through the frame with `kitVersion` and `kit` replaced; throws like `splice` on a non-frame file.
  - `writeDocument(filePath, json: string | null, { storeDir, now, expectedDataHash, kit })`: `json === null` keeps the data block on disk; `kit` (optional) replaces the kit. At least one of them must change something, else `TypeError('Nothing to write.')`.

- [ ] **Step 1: Write the failing tests**

```js
// splice.test.js
test('replaceKit changes only the kit and its version', () => {
  const old = findKit('1.0.0');
  const html = makeDocument({ kitVersion: old.version, kit: old.text });
  const next = replaceKit(html, currentKit());
  assert.deepEqual(parseDocument(next).parts, { ...parseDocument(html).parts, kitVersion: '1.1.0', kit: currentKit().text });
  assert.equal(checkDocument(next).ok, true);
});

// kit.test.js
test('outdatedKit names the newest kit of the same API', () => {
  assert.deepEqual(outdatedKit(makeParts({ kitVersion: '1.0.0', kit: findKit('1.0.0').text })), { from: '1.0.0', to: '1.1.0' });
  assert.equal(outdatedKit(makeParts()), null);
});

// write.test.js (tmp dir per test as in M1)
test('writeDocument with a kit and no data replaces only the kit and keeps the previous file', async (t) => {
  // file built with kit 1.0.0 → writeDocument(file, null, { storeDir, kit: currentKit() })
  // assert: parts on disk == old parts with kitVersion/kit replaced; one version stored equal to the old file
});
test('writeDocument with a kit and data replaces both in one write', async (t) => {
  // writeDocument(file, '{"rows":[]}', { storeDir, kit: currentKit() }) → parts on disk: data '{"rows":[]}', kit 1.1.0, rest unchanged;
  // exactly one version stored, equal to the old file
});
test('writeDocument with neither data nor kit is refused', async () => {
  await assert.rejects(writeDocument(file, null, { storeDir }), /Nothing to write/);
});
test('a kit write checks the expected data hash like a save', async () => { /* EV_DATA_CONFLICT */ });
```

- [ ] **Step 2: Run to verify they fail** — `npm test` → FAIL (`replaceKit`, `outdatedKit`, `newestKit` undefined; `writeDocument(…, null)` throws `TypeError: The data must be a JSON string.`).
- [ ] **Step 3: Implement** `newestKit`, `outdatedKit`, `replaceKit`, and the two options of `writeDocument` (splice first if `json !== null`, then `replaceKit` if `kit`; the rest of the write is unchanged).
- [ ] **Step 4: Run** — `npm test` → PASS.
- [ ] **Step 5: Commit** — `git commit -m "feat(host): replace a document's kit through the safe write"`

---

### Task 4: Workspace model

Decisions Q3–Q5: one workspace; panes split like Obsidian; a document is in at most one pane; an emptied pane disappears unless it is the last.

**Files:**

- Create: `doc-host/src/workspace-model.js`
- Test: `doc-host/test/workspace-model.test.js`

**Interfaces:**

- Produces (all pure; every function returns a new model and never mutates its input; a call that is not allowed returns the input model unchanged — the same object):

```js
// Model
// { root: Node, focusedPaneId: string, nextId: number,
//   list: { visible: boolean, mode: 'list' | 'thumbnails', width: number } }
// Node = { kind: 'pane', id: 'p<n>', tabs: string[] /* docIds */, selected: string | null }
//      | { kind: 'split', id: 's<n>', direction: 'row' | 'column', children: Node[], sizes: number[] /* sum 1 */ }
createModel() → Model            // { root: { kind: 'pane', id: 'p1', tabs: [], selected: null }, focusedPaneId: 'p1', nextId: 2, list: { visible: true, mode: 'list', width: 240 } }
addTab(model, docId, { paneId } = {}) → Model   // right of the pane's selected tab (default: focused pane); selects it; focuses the pane
selectTab(model, docId) → Model                 // selects it and focuses its pane
removeTab(model, docId) → Model
moveTab(model, docId, paneId, index) → Model    // index in the target's tab list after removal from the source
splitPane(model, docId, paneId, edge: 'left' | 'right' | 'top' | 'bottom') → Model
canSplit(model, docId, paneId) → boolean        // false iff docId is the only tab of paneId
resizeSplit(model, splitId, sizes: number[]) → Model
focusPane(model, paneId) → Model
cycleTab(model, delta: 1 | -1) → Model          // within the focused pane, wraps
selectTabAt(model, index: number) → Model       // 0-based position in the focused pane; out of range: unchanged
setList(model, { visible?, mode?, width? }) → Model  // width clamped to 160–480
paneOf(model, docId) → string | null
findNode(model, id) → Node | null
panesInOrder(model) → Node[]                    // depth-first: left to right, top to bottom
docsInOrder(model) → string[]
activeDocId(model) → string | null              // the focused pane's selected tab
```

Rules the tests pin and the signatures do not:

- `splitPane` first removes `docId` from its pane (collapsing as `removeTab` does), then inserts a new pane holding only `docId` at `edge` of `paneId`. It allocates the new pane's id first, then the split's id. If the target's parent is a split in the edge's direction (`left`/`right` → `row`, `top`/`bottom` → `column`), the new pane becomes a sibling before or after the target and the two share the target's size equally; otherwise the target is replaced by a new split `[new, target]` (left/top) or `[target, new]` (right/bottom) with sizes `[0.5, 0.5]`. The new pane is focused.

- Removing a pane from a split removes its size and rescales the others proportionally to sum 1. A split left with one child is replaced by that child, which keeps the split's slot and size in the grandparent.

- `removeTab` selects the right neighbour, else the left one. If the focused pane disappears, focus moves to the next sibling (else the previous one), to its first pane in order.

- `resizeSplit` ignores a wrong-length array; clamps each size to ≥ 0.05, then rescales to sum 1.

- [ ] **Step 1: Write the failing tests** (`test/workspace-model.test.js`; build models through the API; `deepFreeze` inputs to prove purity):

```js
test('a new model has one empty focused pane', () => {
  assert.deepEqual(createModel(), { root: { kind: 'pane', id: 'p1', tabs: [], selected: null },
    focusedPaneId: 'p1', nextId: 2, list: { visible: true, mode: 'list', width: 240 } });
});
test('addTab inserts right of the selected tab and selects it', () => {
  let m = addTab(addTab(createModel(), 'a'), 'b');
  m = addTab(selectTab(m, 'a'), 'c');
  assert.deepEqual(m.root.tabs, ['a', 'c', 'b']);
  assert.equal(m.root.selected, 'c');
});
test('removeTab selects the right neighbour, else the left one', () => {
  let m = addTab(selectTab(addTab(addTab(createModel(), 'a'), 'b'), 'a'), 'c'); // a c b, c selected
  m = removeTab(m, 'c'); assert.equal(m.root.selected, 'b');
  m = removeTab(m, 'b'); assert.equal(m.root.selected, 'a');
  m = removeTab(m, 'a'); assert.deepEqual(m.root, { kind: 'pane', id: 'p1', tabs: [], selected: null }); // the last pane stays
});
test('splitPane right moves the document into a new pane beside it', () => {
  const m = splitPane(addTab(addTab(createModel(), 'a'), 'b'), 'b', 'p1', 'right');
  assert.deepEqual(m.root, { kind: 'split', id: 's3', direction: 'row', sizes: [0.5, 0.5], children: [
    { kind: 'pane', id: 'p1', tabs: ['a'], selected: 'a' },
    { kind: 'pane', id: 'p2', tabs: ['b'], selected: 'b' }] });
  assert.equal(m.focusedPaneId, 'p2');
});
test('canSplit is false for the only tab of its own pane, and splitPane then changes nothing', () => {
  const m = addTab(createModel(), 'a');
  assert.equal(canSplit(m, 'a', 'p1'), false);
  assert.equal(splitPane(m, 'a', 'p1', 'right'), m);
});
test('splitting in the parent direction shares the target\'s size', () => {
  let m = splitPane(addTab(addTab(createModel(), 'a'), 'b'), 'b', 'p1', 'right'); // [p1 a | p2 b]
  m = splitPane(addTab(m, 'c', { paneId: 'p2' }), 'c', 'p2', 'right');
  assert.deepEqual(m.root.sizes, [0.5, 0.25, 0.25]);
});
test('splitting across the parent direction nests a split', () => {
  let m = splitPane(addTab(addTab(createModel(), 'a'), 'b'), 'b', 'p1', 'right');
  m = splitPane(addTab(m, 'c', { paneId: 'p2' }), 'c', 'p2', 'bottom');
  assert.equal(m.root.children[1].kind, 'split');
  assert.equal(m.root.children[1].direction, 'column');
  assert.deepEqual(m.root.children[1].children.map((n) => n.id), ['p2', 'p4']);
});
test('moving the last tab out of a pane removes the pane and collapses the split', () => {
  let m = splitPane(addTab(addTab(createModel(), 'a'), 'b'), 'b', 'p1', 'right');
  m = moveTab(m, 'b', 'p1', 0);
  assert.deepEqual(m.root, { kind: 'pane', id: 'p1', tabs: ['b', 'a'], selected: 'b' });
  assert.equal(m.focusedPaneId, 'p1');
});
test('moveTab within a pane reorders', () => { /* tabs a b c → moveTab(c, p1, 0) → c a b, c selected */ });
test('removing a focused pane focuses its next sibling', () => { /* row [p1 | p2 | p4] (p2 focused) → removeTab of p2's only tab → root children p1, p4; focusedPaneId 'p4' */ });
test('resizeSplit clamps to 0.05 and rescales; a wrong length changes nothing', () => { /* [0.01, 0.99] → [0.05/1.04, 0.99/1.04]; [1] → same object */ });
test('cycleTab wraps and selectTabAt picks by position in the focused pane', () => {
  let m = addTab(addTab(addTab(createModel(), 'a'), 'b'), 'c');      // a b c, c selected
  assert.equal(cycleTab(m, 1).root.selected, 'a');
  assert.equal(cycleTab(m, -1).root.selected, 'b');
  assert.equal(selectTabAt(m, 0).root.selected, 'a');
  assert.equal(selectTabAt(m, 5), m);
});
test('setList clamps the width to 160–480', () => { /* setList(m, { width: 1000 }).list.width 480; { width: 10 } → 160; mode and visible kept */ });
test('panesInOrder and docsInOrder go left to right, top to bottom', () => {
  // [p1 a | (p2 b / p4 c)] built with two splits
  assert.deepEqual(panesInOrder(m).map((p) => p.id), ['p1', 'p2', 'p4']);
  assert.deepEqual(docsInOrder(m), ['a', 'b', 'c']);
});
test('no function mutates its input', () => { /* deep-freeze a split model and call every function on it; none throws */ });
```

- [ ] **Step 2: Run to verify they fail** — `node --test test/workspace-model.test.js` → FAIL (module missing).
- [ ] **Step 3: Implement `src/workspace-model.js`.**
- [ ] **Step 4: Run** — `npm test` → PASS.
- [ ] **Step 5: Commit** — `git commit -m "feat(host): pure workspace model for panes and tabs"`

---

### Task 5: Layout geometry

**Files:**

- Create: `doc-host/src/layout.js`
- Test: `doc-host/test/layout.test.js`

**Interfaces:**

- Consumes: Model (Task 4).
- Produces:

```js
METRICS = { tabStrip: 32, banner: 36, moreBanners: 24, divider: 4 }
bannerRowHeight(count: number) → number   // 0 → 0; min(count, 3) * 36, plus 24 when count > 3
computeLayout(model, { width, height }, { bannerHeight = (paneId) => 0 } = {}) → {
  list: Rect | null,                          // { x: 0, y: 0, width: model.list.width, height } when visible
  panes: [{ paneId, tabStrip: Rect, banners: Rect, document: Rect }],   // in panesInOrder order
  dividers: [{ splitId, index, direction, rect: Rect }],                // index: the divider after child `index`
}
neighbourPane(layout, paneId, direction: 'left' | 'right' | 'up' | 'down') → string | null
// Rect = { x, y, width, height }, integers
```

Rules: the pane area starts right of the list. A split of n children subtracts `(n − 1) × 4` px of dividers, gives each child but the last `Math.floor(available × size)` and the last child the remainder, so rectangles never overlap or leave gaps. A pane is a tab strip (32 px), a banner row (`bannerHeight(paneId)`), and the document taking the rest (never negative). `neighbourPane` picks, among panes lying entirely beyond the edge in that direction and overlapping on the other axis, the one with the smallest gap, then the larger overlap, then the first in `panesInOrder`.

- [ ] **Step 1: Write the failing tests**

```js
const W = { width: 1000, height: 700 };
test('one pane: the list on the left, then tab strip, banner row and document', () => {
  const l = computeLayout(addTab(createModel(), 'a'), W);
  assert.deepEqual(l.list, { x: 0, y: 0, width: 240, height: 700 });
  assert.deepEqual(l.panes, [{ paneId: 'p1', tabStrip: { x: 240, y: 0, width: 760, height: 32 },
    banners: { x: 240, y: 32, width: 760, height: 0 }, document: { x: 240, y: 32, width: 760, height: 668 } }]);
});
test('a hidden list gives the panes the whole width', () => { /* setList visible false → tabStrip x 0, width 1000 */ });
test('banner rows push the document down', () => {
  const l = computeLayout(addTab(createModel(), 'a'), W, { bannerHeight: () => bannerRowHeight(2) });
  assert.deepEqual(l.panes[0].banners, { x: 240, y: 32, width: 760, height: 72 });
  assert.deepEqual(l.panes[0].document, { x: 240, y: 104, width: 760, height: 596 });
});
test('bannerRowHeight: 36 per banner up to 3, plus 24 for more', () => {
  assert.deepEqual([0, 1, 3, 4, 9].map(bannerRowHeight), [0, 36, 108, 132, 132]);
});
test('a row split divides the width minus dividers, without gaps', () => {
  const m = splitPane(addTab(addTab(createModel(), 'a'), 'b'), 'b', 'p1', 'right');
  const l = computeLayout(m, W);
  assert.deepEqual(l.panes.map((p) => [p.tabStrip.x, p.tabStrip.width]), [[240, 378], [622, 378]]);
  assert.deepEqual(l.dividers, [{ splitId: 's3', index: 0, direction: 'row', rect: { x: 618, y: 0, width: 4, height: 700 } }]);
});
test('odd sizes: the last child takes the remainder', () => { /* sizes [1/3,1/3,1/3] in 760 → 250, 250, 252 */ });
test('neighbourPane finds the pane in each direction', () => {
  // [p1 | (p2 / p4)]: p2 and p4 are equally near and overlap p1 equally; ties go to the first in panesInOrder
  assert.equal(neighbourPane(l, 'p1', 'right'), 'p2');
  assert.equal(neighbourPane(l, 'p2', 'down'), 'p4');
  assert.equal(neighbourPane(l, 'p4', 'left'), 'p1');
  assert.equal(neighbourPane(l, 'p1', 'left'), null);
});
```

- [ ] **Step 2: Run to verify they fail** — FAIL (module missing).
- [ ] **Step 3: Implement `src/layout.js`.**
- [ ] **Step 4: Run** — `npm test` → PASS.
- [ ] **Step 5: Commit** — `git commit -m "feat(host): layout geometry for panes, banners and dividers"`

---

### Task 6: Document status and labels

Decisions Q8, Q11, Q15, Q19 (6, 7): badges and banners derive from a document's status; one badge per tab by priority; banners in urgency order.

**Files:**

- Create: `doc-host/src/status.js`, `doc-host/src/labels.js`
- Test: `doc-host/test/status.test.js`, `doc-host/test/labels.test.js`

**Interfaces:**

- Produces:

```js
// status.js
emptyStatus() → Status
// Status = { dirty: false, missing: false, nonConforming: null /* report text */, dataConflict: false,
//   updatedWhileDirty: false, checkError: null /* report text */, kitUpdate: null /* { from, to } */,
//   kitUpdated: null /* { from, to } */, updatedFromDisk: false, dismissed: [] /* banner kinds */ }
BADGE_ORDER = ['missing', 'non-conforming', 'data-conflict', 'updated-while-dirty', 'check-error', 'kit-update']
describeStatus(status, { name, filePath }) → {
  badges: string[],          // kinds in BADGE_ORDER whose condition holds (dismissal does not hide badges)
  badge: string | null,      // badges[0]
  banners: [{ kind, message, actions: [{ id, label }], dismissLabel: string | null, fadeMs?: number }],
}                            // banner order: BADGE_ORDER, then 'kit-updated', then 'updated-from-disk'; dismissed kinds left out
// labels.js
documentLabels(paths: string[]) → Map<string, string>
```

Banner copy (exact; tests pin it):

| kind                  | message                                                                                                                                                                  | actions                                                                                   | dismissLabel           |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------- | ---------------------- |
| `missing`             | `${name} was moved or deleted. Your changes exist only in this window. Put the file back at ${filePath} and save again. The last saved version is in the version store.` | —                                                                                         | `OK`                   |
| `non-conforming`      | `The file on disk no longer follows the document specification. This version keeps running; saving is refused until the file is fixed.`                                  | `copy-report` "Copy report"                                                               | `OK`                   |
| `data-conflict`       | `The data in ${name} was changed on disk, and you have unsaved changes.`                                                                                                 | `keep-mine` "Keep mine", `take-disk` "Take the version on disk"                           | `Later`                |
| `updated-while-dirty` | `This document was updated on disk. Your data is unsaved.`                                                                                                               | `save-reload` "Save my data and reload", `discard-reload` "Reload and discard my changes" | `Later`                |
| `check-error`         | `EverythingApp could not check ${name} for changes on disk.`                                                                                                             | `copy-report` "Copy report"                                                               | `OK`                   |
| `kit-update`          | `This document uses kit ${from}; ${to} is available.`                                                                                                                    | `update-kit` "Update kit"                                                                 | `Not now`              |
| `kit-updated`         | `Kit updated to ${to}.`                                                                                                                                                  | `undo-kit` "Undo"                                                                         | `OK`                   |
| `updated-from-disk`   | `Updated from disk.`                                                                                                                                                     | —                                                                                         | `null`, `fadeMs: 4000` |

Labels: the file name; when two or more paths share a file name, each of them gets `name · <parent folder name>`; if that still collides, `name · <full parent path>`.

- [ ] **Step 1: Write the failing tests**

```js
test('the tab badge is the most urgent condition', () => {
  const s = { ...emptyStatus(), kitUpdate: { from: '1.0.0', to: '1.1.0' }, dataConflict: true, missing: true };
  const d = describeStatus(s, { name: 'a.ev.html', filePath: '/x/a.ev.html' });
  assert.deepEqual(d.badges, ['missing', 'data-conflict', 'kit-update']);
  assert.equal(d.badge, 'missing');
  assert.deepEqual(d.banners.map((b) => b.kind), ['missing', 'data-conflict', 'kit-update']);
});
test('a dismissed banner is hidden, its badge stays', () => {
  const d = describeStatus({ ...emptyStatus(), kitUpdate: { from: '1.0.0', to: '1.1.0' }, dismissed: ['kit-update'] }, NAMES);
  assert.deepEqual([d.badge, d.banners.length], ['kit-update', 0]);
});
test('banner copy', () => { /* one assertion per row of the copy table, exact strings */ });
test('updated-from-disk and kit-updated are banners, not badges', () => { /* … fadeMs 4000 */ });
test('a clean status has no badge and no banner', () => { /* describeStatus(emptyStatus(), NAMES) → { badges: [], badge: null, banners: [] } */ });

test('labels are file names, with the folder when names collide', () => {
  assert.deepEqual(Object.fromEntries(documentLabels(['/a/x.ev.html', '/b/x.ev.html', '/a/y.ev.html'])),
    { '/a/x.ev.html': 'x.ev.html · a', '/b/x.ev.html': 'x.ev.html · b', '/a/y.ev.html': 'y.ev.html' });
});
test('labels fall back to the full folder when folder names collide too', () => {
  const l = documentLabels(['/p/a/x.ev.html', '/q/a/x.ev.html', '/r/x.ev.html']);
  assert.deepEqual([...l.values()], ['x.ev.html · /p/a', 'x.ev.html · /q/a', 'x.ev.html · r']);
});
```

- [ ] **Step 2: Run to verify they fail** — FAIL (modules missing).
- [ ] **Step 3: Implement `src/status.js` and `src/labels.js`.**
- [ ] **Step 4: Run** — `npm test` → PASS.
- [ ] **Step 5: Commit** — `git commit -m "feat(host): badges, banners and labels from document status"`

---

### Task 7: The workspace file

Decision Q6: on quit the host writes `workspace.json`; on start it reopens every file through the conformance check; failures are named once; unsaved changes are never carried over. Q19 (9): window bounds and list width too; a broken file is kept as `workspace.json.bad`.

**Files:**

- Create: `doc-host/src/workspace-file.js`
- Test: `doc-host/test/workspace-file.test.js`

**Interfaces:**

- Consumes: Model and `removeTab`-style collapsing (Task 4).
- Produces:

```js
// File format, version 1:
// { "version": 1,
//   "window": { "x": 100, "y": 80, "width": 1280, "height": 860 },
//   "list": { "visible": true, "mode": "list", "width": 240 },
//   "layout": { "kind": "split", "direction": "row", "sizes": [0.5, 0.5], "children": [
//       { "kind": "pane", "tabs": ["/abs/a.ev.html"], "selected": "/abs/a.ev.html" }, … ] },
//   "active": "/abs/a.ev.html" }
toWorkspaceFile(model, { pathOf: (docId) => string, window: Rect }) → object
parseWorkspaceFile(text: string) → { ok: true, value } | { ok: false, error: string }
pathsInFile(value) → string[]                                   // in layout order
modelFromWorkspaceFile(value, idOf: (path) => string | null) → Model   // fresh ids; tabs whose idOf is null are left out
fitBounds(bounds: Rect | null, displays: [{ workArea: Rect }]) → Rect | null
readWorkspaceFile(filePath) → Promise<object | null>            // missing → null; unreadable or invalid → renamed to <file>.bad, null
writeWorkspaceFile(filePath, value) → Promise<void>             // <file>.tmp, then rename
```

Validation (`ok: false` names the first problem): valid JSON; `version === 1`; `window` finite numbers with `width`, `height` ≥ 200; `list.visible` boolean, `list.mode` `list`|`thumbnails`, `list.width` finite; layout depth ≤ 32; a split has a `row`|`column` direction, ≥ 2 children and as many positive finite sizes (rescaled to sum 1); a pane has an array of absolute path strings and `selected` among them or `null`; `active` is a path of the layout or `null`. A path that appears more than once is not an error: `parseWorkspaceFile` keeps its first place (layout order) and drops the later ones, so one bad entry never discards the whole workspace.
`modelFromWorkspaceFile`: panes left empty are removed and splits collapsed as in Task 4; if none is left, `createModel()` with the file's `list`; a pane whose `selected` was left out selects its first tab; the focused pane is the one holding `active`, else the first pane.
`fitBounds`: `null` stays `null` (the window opens at 1280×860, centred). Bounds that overlap some display's work area by at least 100×100 px are kept, with width and height capped to that work area; otherwise the size (capped) is centred on `displays[0].workArea`.

- [ ] **Step 1: Write the failing tests**

```js
test('a model survives the round trip through the file', () => { /* split model → toWorkspaceFile → JSON → parse → modelFromWorkspaceFile(idOf: identity map) → same shape, same tabs, same focused pane */ });
test('files that did not open are left out and empty panes disappear', () => { /* [p1 a | p2 b], idOf(b) null → single pane [a] */ });
test('nothing opened gives one empty pane with the saved list settings', () => { /* file with list { visible: false, mode: 'thumbnails', width: 300 }, idOf → null for all → createModel() shape with that list */ });
test('invalid files are refused with a reason', () => {
  for (const [text, reason] of [['{', /JSON/], ['{"version":2}', /version/],
    [fileWith({ layout: pane(['relative.ev.html']) }), /absolute/],
    [fileWith({ layout: split([pane(['/a.ev.html'])]) }), /two children/]]) {
    const r = parseWorkspaceFile(text);
    assert.equal(r.ok, false); assert.match(r.error, reason);
  }
});
test('a path listed twice keeps its first place', () => {
  const r = parseWorkspaceFile(fileWith({ layout: split([pane(['/a.ev.html', '/b.ev.html']), pane(['/a.ev.html', '/c.ev.html'])]) }));
  assert.equal(r.ok, true);
  assert.deepEqual(pathsInFile(r.value), ['/a.ev.html', '/b.ev.html', '/c.ev.html']);
});
test('fitBounds keeps visible bounds and moves lost ones to the primary display', () => {
  const displays = [{ workArea: { x: 0, y: 25, width: 1440, height: 875 } }];
  assert.deepEqual(fitBounds({ x: 100, y: 80, width: 1280, height: 800 }, displays), { x: 100, y: 80, width: 1280, height: 800 });
  assert.deepEqual(fitBounds({ x: 3000, y: 80, width: 1280, height: 800 }, displays), { x: 80, y: 63, width: 1280, height: 800 });
  assert.deepEqual(fitBounds({ x: 0, y: 25, width: 3000, height: 2000 }, displays), { x: 0, y: 25, width: 1440, height: 875 });
});
test('a broken workspace.json is kept as workspace.json.bad', async (t) => { /* tmp dir; write "{"; read → null; .bad exists with "{"; original gone */ });
test('writeWorkspaceFile leaves no temporary file', async (t) => { /* write, then readdir(dir) → ['workspace.json']; readWorkspaceFile returns the value */ });
```

- [ ] **Step 2: Run to verify they fail** — FAIL (module missing).
- [ ] **Step 3: Implement `src/workspace-file.js`.**
- [ ] **Step 4: Run** — `npm test` → PASS.
- [ ] **Step 5: Commit** — `git commit -m "feat(host): workspace file with validation and window bounds"`

---

### Task 8: Document without a window

`document-window.js` becomes `document.js`: one open document, no `BaseWindow`. Background events set status instead of showing dialogs (Q11); stale change signals are ignored (Q16); an edit during an auto-reload turns into a banner (Q16); `behaviour` becomes `outsideData` (Q17); documents get `disableDialogs` (Q7). Until Task 9, `document-window.js` stays as a thin wrapper so the app keeps running.

**Files:**

- Create: `doc-host/src/document.js`, `doc-host/src/load-tags.js`, `doc-host/test/load-tags.test.js`
- Modify: `doc-host/src/document-window.js` (thin wrapper), `doc-host/src/preload.js`, `doc-host/src/ipc.js`, `doc-host/src/security.js`, `doc-host/src/watch.js`, `doc-host/test/watch.test.js`, `doc-host/tools/smoke.js`, `doc-host/src/probe.js` (reads `doc.view`)

**Interfaces:**

- Consumes: `emptyStatus`, `describeStatus` (Task 6); `writeDocument` (Task 3).
- Produces:

```js
// load-tags.js
class LoadTags {
  hello(loadId) → boolean      // a page announces itself; accepted unless retired
  begin()                      // a new load starts: retire the current id
  accepts(loadId) → boolean    // true only for the current, announced id
}
// preload.js: const loadId = crypto.randomUUID(); sends 'doc:hello' (loadId) before anything else;
//   'doc:dirty' ({ loadId, counter }); 'doc:save-data' ({ loadId, requestId, json, changes, error })
// document.js
class Document {
  constructor({ id, filePath, html, parts, storeDir, ui, allowDevTools = false })
  // ui = { sheet(options) → Promise<number | null>, update() → void, rendered(reason: 'load' | 'save' | 'reload') → void }
  id; filePath; name; view; webContentsId; status /* Status, Task 6 */; ready /* Promise */;
  get isDirty()
  onHello(loadId); onDirty({ loadId, counter }); onSaveData(payload)
  save({ keepMine = false } = {}) → Promise<boolean>
  settle() → Promise<void>
  reloadInteractive() → Promise<void>
  promptSave() → Promise<'saved' | 'discard' | 'cancel'>   // M1 prompt: Save / Don't save / Cancel; 'cancel' also when the save fails or an edit came after the snapshot
  confirmClose() → Promise<boolean>                         // settle; if dirty, promptSave(); true unless 'cancel'
  onBannerAction(kind, action) → Promise<void>              // action is an action id or 'dismiss'
  dispose()
}
// security.js: WEB_PREFERENCES gains disableDialogs: true
// watch.js: sectionHashes → { outsideData, data }; classifyChange → { outsideData, data }
```

Behaviour carried over from `DocumentWindow` unchanged (save turn, follow-up save, snapshot counters, write-time conflict check, reload rules, error copy), except:

- `ask()` is gone. User-triggered prompts (save conflict, save error, reload prompt, close prompt, missing file on save) call `ui.sheet(options)` with the M1 options. Background events set status and call `ui.update()`: watcher sees ENOENT → `status.missing = true`; non-conforming file on disk → `status.nonConforming = report` (the `open-document` report); outside-data change while dirty → `status.updatedWhileDirty = true`; data change while dirty → `status.dataConflict = true` (replaces `diskDataChanged`); watch error → `status.checkError = <formatErrorReport text>`. A successful read clears `missing`, `nonConforming` and `checkError`; a reload clears `updatedWhileDirty` and `dataConflict`; a kind is removed from `status.dismissed` whenever its condition becomes false.

- Clean outside-data change: reload, then `status.updatedFromDisk = true` and clear it after 4000 ms (each time with `ui.update()`).

- Edit during auto-reload: the clean path reloads through `reloadFromDisk({ ifClean: true })`, which re-checks `isDirty` after `settle()` and right before replacing the page; if dirty by then it sets `status.updatedWhileDirty` instead and returns `false`.

- Load tags: `loadFromDisk` calls `tags.begin()` before `loadURL`; `onDirty` and `onSaveData` ignore payloads whose `loadId` the tags do not accept.

- `status.dirty` mirrors `isDirty`; every change of it calls `ui.update()`.

- `save({ keepMine: true })` (banner "Keep mine") adopts the disk state as known (`refreshKnown()`), clears `dataConflict` and writes without the conflict sheet.

- Banner actions: `copy-report` copies `nonConforming` or `checkError` to the clipboard; `keep-mine` → `save({ keepMine: true })`; `take-disk` and `discard-reload` → `reloadFromDisk()`; `save-reload` → `save()` (which reloads newer outside data when clean, as in M1); `dismiss` adds the kind to `status.dismissed`. `update-kit` and `undo-kit` arrive in Task 13.

- `ui.rendered('load')` after the first load, `'reload'` after every reload, `'save'` after every successful write.

- The wrapper `document-window.js` (Task 8 only): a `BaseWindow` with the document's view filling it; `ui.sheet` = `dialog.showMessageBox(win, options)` one at a time (returns `null` while one is open); `ui.update` = the M1 title and `setDocumentEdited`; the window's `close` handler uses `confirmClose()`; `registry.byWindow` keeps working.

- [ ] **Step 1: Write the failing tests**

```js
// load-tags.test.js
test('messages count only from the current, announced load', () => {
  const tags = new LoadTags();
  assert.equal(tags.accepts('a'), false);            // no hello yet
  assert.equal(tags.hello('a'), true);
  assert.equal(tags.accepts('a'), true);
  tags.begin();                                      // reload starts
  assert.equal(tags.accepts('a'), false);
  assert.equal(tags.hello('a'), false, 'a retired load cannot come back');
  assert.equal(tags.hello('b'), true);
  assert.equal(tags.accepts('b'), true);
});
// watch.test.js: rename the expected keys to outsideData; titles say "outside the data"
```

In `tools/smoke.js`: stub `doc.ui.sheet` where M1 stubbed `doc.ask`, read `doc.status.dataConflict` where it read `doc.diskDataChanged`, and add steps:

```js
step('a change signal from before a reload does not mark the new page dirty');
// send an IPC 'doc:dirty' with the previous loadId and counter 99 through ipcMain.emit with a fake event
// whose sender.id is the view's id, after a reload; assert doc.isDirty === false
step('an external change to a dirty document becomes status, never a sheet');
// sheet stub records calls; edit; change outside the data on disk; until(status.updatedWhileDirty); assert no sheet call
step('an edit that lands during an auto-reload becomes a banner');
// stub reloadFromDisk's last check: mark dirty between settle() and loadURL (wrap doc.settle to click "add" after it resolves)
// assert the page was not replaced (generation unchanged) and status.updatedWhileDirty
step('a clean reload shows "Updated from disk" for 4 seconds');
step('documents cannot show native dialogs');
// executeJavaScript('const t = Date.now(); alert(1); [confirm(1), Date.now() - t < 1000]') → [false, true]
```

- [ ] **Step 2: Run to verify they fail** — `npm test` → FAIL (`LoadTags` missing, watch keys). `npm run smoke` → FAIL.
- [ ] **Step 3: Implement** `load-tags.js`, `document.js`, the preload, IPC routing (`doc:hello` → `onHello`), `disableDialogs`, the `outsideData` rename (user-facing copy "This document was updated on disk." where M1 said "Its behaviour changed"), and the thin wrapper.
- [ ] **Step 4: Run** — `npm test` → PASS; `npm run smoke` → `[smoke] all checks passed`; `npm run probe` → no FAIL.
- [ ] **Step 5: Commit** — `git commit -m "refactor(host): Document without a window; status instead of background dialogs"`

---

### Task 9: One workspace window

The window holds every document. No host UI yet: tab strips and banner rows are blank space; tabs are switched from the menu.

Decisions: Q3 (one workspace), Q6 (restore), Q12 (closing quits; Cmd+W closes the active document; quit resumes after the summary), Q13 (close summary), Q19 (1–4, 9).

**Files:**

- Create: `doc-host/src/workspace.js`, `doc-host/test/open.test.js`
- Modify: `doc-host/src/open.js`, `doc-host/src/registry.js`, `doc-host/src/ipc.js`, `doc-host/src/menu.js`, `doc-host/src/main.js`, `doc-host/src/probe.js`, `doc-host/tools/smoke.js`
- Delete: `doc-host/src/document-window.js`

**Interfaces:**

- Consumes: Tasks 4–8.
- Produces:

```js
// open.js (Node fs only, unit-tested)
readDocumentFile(rawPath) → Promise<
    { kind: 'document', filePath, check }
  | { kind: 'not-document', filePath }
  | { kind: 'refused', filePath, report }      // formatReport(filePath, errors) — context 'open'
  | { kind: 'error', filePath: rawPath, message }>
// workspace.js
class Workspace {
  constructor({ storeDir, workspaceFile, allowDevTools = false })
  win; model; registry; hostUi /* null until Task 10 */;
  restore() → Promise<{ failed: [{ path, reason }] }>
  open(rawPath, { paneId } = {}) → Promise<Document | null>
  activeDocument() → Document | null
  documentById(docId) → Document | null
  apply(model)                          // set the model, lay out the views, update title, menu state and host UI
  select(docId); focusPane(paneId)
  closeDocument(docId) → Promise<boolean>
  confirmCloseAll() → Promise<boolean>  // the close summary
  quit() → Promise<void>                // confirmCloseAll → persist → dispose → app.exit(0)
  persist() → Promise<void>             // writes workspace.json
  sheet(options) → Promise<number | null>
}
```

Rules:

- `open` → `readDocumentFile`; already open (`registry.byPath`) → `select`; `not-document`, `refused` and `error` → a sheet with the M1 copy (the refusal keeps "Copy report"); a document → new `Document` (id = its random origin id), its view added above the host-UI view, `addTab(model, id, { paneId })`, `apply`. A file dropped on a document opens in that document's pane (`doc:dropped-files` → `open(p, { paneId: paneOf(sender) })`).

- `open.js` gets a comment on `realpath`: it returns the case stored on disk on macOS (APFS, verified 2026-10-07), so one file opened under two spellings is found by `byPath`; Windows is checked by hand in Task 14.

- `apply`: `computeLayout(model, win.getContentBounds() size, { bannerHeight })` where `bannerHeight(paneId)` is `bannerRowHeight(describeStatus(selected doc).banners.length)`; each pane's selected document view → visible, bounds = its `document` rect; every other view → hidden by the method Task 1 chose, bounds = its pane's `document` rect; re-run on `resize`.

- Focus: a document's `webContents` `focus` event → `focusPane(paneOf(doc))`; `select` also calls `view.webContents.focus()`.

- Title: `${dirty ? '• ' : ''}${label}` of the active document (labels from `documentLabels`), `EverythingApp` when empty; `setDocumentEdited(any document dirty)`; `setRepresentedFilename(active path or '')`.

- `closeDocument`: `doc.confirmClose()`; on `true` → `removeTab`, `apply`, `doc.dispose()`.

- `confirmCloseAll`: settle every document; dirty documents in `docsInOrder` order. None → `true`. One → `select` it, `promptSave()`; `'cancel'` → `false`. Several → sheet: message `Do you want to save the changes to ${n} documents?`, detail: up to 10 labels one per line, then `and ${n - 10} more` if needed, then a blank line and `Your changes will be lost if you don't save them.`, buttons `['Save all', 'Review each…', 'Cancel']`, `defaultId: 0`, `cancelId: 2`. Save all: for each, `await doc.save()`; if it returns `false` or the document is still dirty → `select` it and return `false`. Review each: for each, `select`, `promptSave()`; `'cancel'` → return `false` (nothing closes; "Don't save" choices only take effect when the window closes). Done → `true`.

- Quit: the window's `close` event and `app` `before-quit` both `preventDefault()` unless quitting is confirmed, then run `quit()`. `window-all-closed` → `app.quit()` on every platform. `persist()` writes `toWorkspaceFile(model, { pathOf, window: win.getNormalBounds() })`.

- `restore()`: `readWorkspaceFile`; open `pathsInFile` one by one without adding tabs; reasons `moved or deleted` (ENOENT), `not an EverythingApp document`, `no longer follows the document specification`, `could not be read: <message>`; `modelFromWorkspaceFile(value, idOf)`; window bounds through `fitBounds(value.window, screen.getAllDisplays())`. Failures are kept as `this.notice = { failed }` for the host UI (Task 10).

- `main.js`: single-instance lock as before; create the workspace; `restore()`; then open `early` and argv paths into the focused pane; no open dialog at start (the empty state offers Open… from Task 10). `second-instance` → open its paths, focus the window. `EV_PROBE` attaches the probe to the first opened document.

- Registry: `byWindow` removed (one window); `bySender`, `byPath` stay.

- Menu (`buildMenu({ workspace, isDev })`, item ids in parentheses; enabled states refreshed by `apply`):
  
  - File: Open… `CmdOrCtrl+O`; Save `CmdOrCtrl+S` (`save`); Close `CmdOrCtrl+W` (`close`); Close Window `CmdOrCtrl+Shift+W`; — ; Update Kit… (`update-kit`, Task 13); Undo Kit Update (`undo-kit`, Task 13); Reveal in Finder / Show in folder (`reveal`); Quit on Windows.
  - View: Document List (checkbox, `list-visible`); List / Thumbnails (radio, `list-mode-list`, `list-mode-thumbnails`); — ; Split Right `CmdOrCtrl+\` (`split-right`, Task 11), Split Down (`split-down`, Task 11); — ; Reload `CmdOrCtrl+R`; Developer Tools (dev builds; active document), Host UI Developer Tools (dev builds, Task 10).
  - Window: Minimize, Zoom; — ; Next Tab `Ctrl+Tab`, Previous Tab `Ctrl+Shift+Tab`; Select Tab ▸ Tab 1…9 `CmdOrCtrl+1`…`9`; Focus Pane ▸ Left/Right/Up/Down `CmdOrCtrl+Alt+Arrow`. Shortcuts that Task 1 found not to fire are handled with `before-input-event` on every web contents instead.

- [ ] **Step 1: Write the failing tests**

```js
// open.test.js
test('readDocumentFile classifies files', async (t) => {
  // tmp dir: a fixture copy → kind 'document' with check.ok; a plain .html → 'not-document';
  // a broken document → 'refused' with a report naming the file; a missing path → 'error'
});
test('readDocumentFile returns the path as stored on disk', async (t) => {
  // on case-insensitive volumes only (skip otherwise): open 'HOURS.EV.HTML' of 'hours.ev.html' → filePath ends with 'hours.ev.html'
});
```

Rewrite `tools/smoke.js` around a `Workspace` (sheets stubbed with `workspace.sheet = async (o) => answers.shift()`, recording `o`). Keep every M1 step, now addressing the active document, and add:

```js
step('three documents open as tabs in one window');            // one BaseWindow; docsInOrder has 3 ids; the last opened is active
step('opening an open document selects its tab');
step('Save acts on the active document only');                  // dirty two; the menu's Save handler (activeDocument().save()) → only the active one written
step('the title shows the active document and its unsaved marker');
step('Cmd+W closes the active document after its prompt');      // Save → written and gone
step('closing waits for a running save');                       // slow requestSnapshot; closeDocument resolves after the write; document gone only if clean
step('Save all saves every document; a read-only one stops closing');   // confirmCloseAll → false, that document active, others saved
step('Review each: Cancel keeps everything open');
step('an external change to a hidden document shows no sheet'); // sheet stub never called; status set
step('the workspace is written and restored');                  // persist(); a second Workspace on the same file: same tabs, panes, active document
step('restore with missing and broken files names each once');  // workspace.json listing four files: one deleted, one broken, one plain .html, one listed twice;
                                                                 // restore().failed = the first three with their reasons; the fourth opens once; the window shows
```

- [ ] **Step 2: Run to verify they fail** — `npm test` → FAIL (`readDocumentFile` missing); `npm run smoke` → FAIL.
- [ ] **Step 3: Implement** `readDocumentFile`, `Workspace`, the menu, IPC, `main.js`; delete `document-window.js`; point `probe.js` at the opened `Document`.
- [ ] **Step 4: Run** — `npm test`, `npm run smoke`, `npm run probe` → all pass.
- [ ] **Step 5: Manual check** — `npm start -- fixtures/hours-sheet.ev.html fixtures/todo-list.ev.html`: Ctrl+Tab switches, Cmd+S saves the visible one, Cmd+Q with both dirty shows the summary and quits after Save all, the next `npm start` restores both.
- [ ] **Step 6: Commit** — `git commit -m "feat(host): one workspace window holds every document"`

---

### Task 10: The host UI

Decisions Q2, Q4, Q11, Q18, Q19: one host-UI view beneath the documents renders the document list, tab strips, banner rows and empty state; it only reports intents; `ui:*` is accepted only from it.

**Files:**

- Create: `doc-host/src/host-ui.js`, `doc-host/src/ui-preload.js`, `doc-host/src/ui-intents.js`, `doc-host/src/ui-state.js`, `doc-host/src/ui/index.html`, `doc-host/src/ui/ui.css`, `doc-host/src/ui/ui.js`, `doc-host/test/ui-intents.test.js`, `doc-host/test/ui-state.test.js`
- Modify: `doc-host/src/urls.js`, `doc-host/src/protocol.js`, `doc-host/src/security.js`, `doc-host/src/workspace.js`, `doc-host/src/ipc.js`, `doc-host/src/menu.js`, `doc-host/fixtures/src/escape-probe/script.js` (+ reassemble), `doc-host/test/urls.test.js`, `doc-host/tools/smoke.js`

**Interfaces:**

- Consumes: Workspace (Task 9), `computeLayout` (5), `describeStatus`, `documentLabels` (6).
- Produces:

```js
// urls.js
UI_SCHEME = 'ev-ui'; UI_ORIGIN = 'ev-ui://host'; UI_FILES = ['index.html', 'ui.css', 'ui.js']
isAllowedUiRequest(url) → boolean        // UI_ORIGIN + '/' + one of UI_FILES, or data:
// protocol.js: registerSchemePrivileges registers ev-doc and ev-ui (standard, secure);
//   serveHostUi(ses) answers GET UI_ORIGIN/<UI_FILES> from src/ui with
//   CSP "default-src 'none'; script-src 'self'; style-src 'self'; img-src data:", 404 otherwise
// ui-intents.js
parseIntent(payload, { docIds: Set, paneIds: Set, splitIds: Set }) → Intent | null
// Intent = { type: 'select' | 'close', docId }
//        | { type: 'banner', docId, kind, action }            // kind in BADGE_ORDER ∪ {kit-updated, updated-from-disk}; action: [a-z-]{1,32}
//        | { type: 'open-dialog' } | { type: 'open-files', paths: string[] /* absolute, ≤ 100 */ }
//        | { type: 'list', visible?: boolean, mode?: 'list' | 'thumbnails', width?: number }
//        | { type: 'resize-split', splitId, sizes: number[] }
//        | { type: 'move-tab', docId, paneId, index } | { type: 'split', docId, paneId, edge }    // Task 11
//        | { type: 'drag', active: boolean }                                                    // Task 11
//        | { type: 'dismiss-notice' }
// ui-state.js
buildUiState({ model, layout, documents: [{ id, path, docType, status }], notice, platform }) → {
  layout, list: model.list, empty: boolean, platform,
  panes: [{ paneId, focused, selected, tabs: [{ docId, label, path, dirty, badge }] }],   // panesInOrder
  documents: { [docId]: { label, path, docType, dirty, badges, banners } },
  notice: { message: 'Some documents from your last session could not be opened:', items: [{ label, reason }] } | null,
}
// host-ui.js
class HostUi {
  constructor({ win, onIntent, allowDevTools })
  view; webContentsId; ready /* Promise */;
  pushState(state)                    // coalesced: at most one 'ui:state' per 16 ms, always the newest
  pushThumbnail(docId, dataUrl)       // Task 12
  raise(); lower()                    // Task 11
  dispose()
}
// ui-preload.js: contextBridge exposes window.evUi = { onState(cb), onThumbnail(cb), send(intent) }
//   (send → ipcRenderer.send('ui:intent', intent)); file drops on the host UI → send({ type: 'open-files', paths })
```

Rules:

- The host-UI view: `WEB_PREFERENCES` (sandboxed, isolated) with its own in-memory partition `ev-ui`, `ui-preload.js`; the session cancels every request `isAllowedUiRequest` refuses, denies permissions and downloads, uses the dead proxy; `hardenContents` applies (no navigation, no windows). It is the first child of `win.contentView` (index 0), bounds = the whole content area.

- `ipc.js`: `ui:intent` → `parseIntent` only when `event.sender.id === hostUi.webContentsId`, else ignored; `doc:*` keeps ignoring senders that are not documents (so a document can never send an intent, and the host UI can never act as a document).

- `Workspace` handles intents: `select`, `close` (→ `closeDocument`), `banner` (→ `doc.onBannerAction`), `open-dialog` (→ the M1 open dialog, files into the focused pane), `open-files`, `list` (→ `setList`), `resize-split`, `dismiss-notice`; and pushes `buildUiState` after every `apply` and every `ui.update()` of a document. While a notice exists the list is shown.

- `src/ui/ui.js` renders from state only, into absolutely positioned elements at the layout's rectangles: the list (entries in `panes` order, a 1 px separator between panes when there are several, label + `•` + one icon per badge; clicking selects; a 4 px resize handle on its right edge sending `list` widths), tab strips (label, `•` in place of the close button until hover, the badge icon, middle-click and × close), banner rows (up to 3 banners of the pane's selected document, then `+N more`; buttons send `banner` intents; `dismissLabel` button sends `dismiss`; `fadeMs` fades it out), dividers (4 px, resize cursor; dragging sends `resize-split`, the raise during the drag comes in Task 11), the empty state in the single pane's document rect (an "Open…" button sending `open-dialog`, the text "Drop a document here"), and the notice at the top of the list (items, an OK button). Every string goes in with `textContent`. `ui.css` follows `prefers-color-scheme`.

- Badge icons and titles: `missing` "Moved or deleted", `non-conforming` "No longer follows the specification", `data-conflict` "Changed on disk", `updated-while-dirty` "Updated on disk", `check-error` "Could not check for changes", `kit-update` "Kit update available".

- [ ] **Step 1: Write the failing tests**

```js
// ui-intents.test.js
const ids = { docIds: new Set(['d1']), paneIds: new Set(['p1']), splitIds: new Set(['s3']) };
test('valid intents pass', () => {
  assert.deepEqual(parseIntent({ type: 'select', docId: 'd1' }, ids), { type: 'select', docId: 'd1' });
  assert.deepEqual(parseIntent({ type: 'list', width: 300 }, ids), { type: 'list', width: 300 });
});
test('unknown ids, types and extra shapes are refused', () => {
  for (const p of [null, 'x', { type: 'select', docId: 'nope' }, { type: 'eval' }, { type: 'open-files', paths: ['rel.html'] },
    { type: 'banner', docId: 'd1', kind: 'kit-update', action: 'x'.repeat(33) }, { type: 'resize-split', splitId: 's3', sizes: [NaN, 1] }]) {
    assert.equal(parseIntent(p, ids), null, JSON.stringify(p));
  }
});
// ui-state.test.js
test('the state names panes, tabs and banners from the model and statuses', () => {
  // docs d1 /a/x.ev.html (dirty, kitUpdate 1.0.0→1.1.0), d2 /b/x.ev.html, both in p1, d2 selected
  // → panes[0].tabs = [{ docId: 'd1', label: 'x.ev.html · a', dirty: true, badge: 'kit-update' }, { docId: 'd2', label: 'x.ev.html · b', dirty: false, badge: null }] (plus path)
  // → documents.d1.banners[0].kind === 'kit-update'; empty === false
});
test('an empty workspace says so', () => { /* createModel() → empty: true, panes: [{ paneId: 'p1', focused: true, selected: null, tabs: [] }] */ });
test('the restore notice uses labels and reasons', () => {
  // notice { failed: [{ path: '/a/gone.ev.html', reason: 'moved or deleted' }] }
  // → { message: 'Some documents from your last session could not be opened:', items: [{ label: 'gone.ev.html', reason: 'moved or deleted' }] }
});
// urls.test.js
test('the host UI may load only its own files and data: URLs', () => {
  assert.equal(isAllowedUiRequest('ev-ui://host/ui.js'), true);
  for (const u of ['ev-ui://host/other.js', 'ev-ui://evil/ui.js', 'https://example.com/', 'file:///etc/hosts', 'ev-doc://x/']) {
    assert.equal(isAllowedUiRequest(u), false, u);
  }
});
```

Escape probe additions (`fixtures/src/escape-probe/script.js`, then reassemble):

```js
report('no host-UI bridge', typeof window.evUi === 'undefined');
await blockedFetch('fetch host UI', 'ev-ui://host/index.html');
report('window.open host UI', !window.open('ev-ui://host/index.html'));
const started = Date.now(); alert('probe'); report('alert does nothing', Date.now() - started < 1000);
report('confirm returns false', confirm('probe') === false);
try { await document.documentElement.requestFullscreen(); report('fullscreen refused', false); }
catch { report('fullscreen refused', true); }
```

Smoke additions (read the host UI with `workspace.hostUi.view.webContents.executeJavaScript`):

```js
step('the host UI lists every document and draws a tab per document');
step('clicking a tab selects the document');                 // click [data-doc-id] in the tab strip → activeDocId changes
step('a banner appears for a hidden document and its action works'); // updated-while-dirty → "Reload and discard my changes"
step('a document cannot send host-UI intents');              // ipcMain.emit('ui:intent', { sender: { id: doc.webContentsId } }, { type: 'close', docId }) → document still open
step('the empty state appears when the last document closes');
```

- [ ] **Step 2: Run to verify they fail** — `npm test` → FAIL; `npm run probe` → FAIL on the new lines (no host UI yet is fine for `evUi`; `alert` blocks if dialogs are not disabled); `npm run smoke` → FAIL.
- [ ] **Step 3: Implement** the URL rules, protocol, host-UI view and session, preload, intents, state, the page, and the workspace wiring; Host UI Developer Tools menu item in dev builds.
- [ ] **Step 4: Run** — `npm test`, `npm run probe`, `npm run smoke` → all pass.
- [ ] **Step 5: Manual check** — `npm start` with two fixtures: list and tabs show both, clicking switches, editing shows `•` on tab, list and title, Cmd+W on the last one shows the empty state, Open… works, light and dark mode both readable.
- [ ] **Step 6: Commit** — `git commit -m "feat(host): host UI view with document list, tabs, banners and empty state"`

---

### Task 11: Dragging tabs and splitting panes

Decision Q5: drag a tab onto a pane's edge to split, into a tab strip to move; Split Right / Split Down move the active document; dividers resize. Q18: while dragging, the host-UI view is raised over the documents with a transparent background (or the Task 1 fallback).

**Files:**

- Modify: `doc-host/src/host-ui.js`, `doc-host/src/workspace.js`, `doc-host/src/menu.js`, `doc-host/src/ui/ui.js`, `doc-host/src/ui/ui.css`, `doc-host/test/ui-intents.test.js`, `doc-host/tools/smoke.js`

**Interfaces:**

- Consumes: `moveTab`, `splitPane`, `canSplit`, `resizeSplit` (Task 4); intents `move-tab`, `split`, `drag` (Task 10).
- Produces: `HostUi.raise()` (re-add the view on top, `setBackgroundColor('#00000000')`, state flag `dragging: true` so the page drops its own backgrounds) and `HostUi.lower()` (back to index 0, opaque); `Workspace.splitActive(edge: 'right' | 'bottom')`.

Rules:

- A tab drag starts after the pointer moves 4 px with the button down; the page sends `drag {active: true}` and the workspace raises the host UI. Drop targets: a tab strip (insertion marker between tabs → `move-tab` with that index); a pane's document rect: its outer quarter on each side (→ `split` with that edge, shown as a half-pane highlight), the centre (→ `move-tab` to the end of that pane). Releasing over nothing, `pointercancel` or `lostpointercapture` cancels. Every end sends `drag {active: false}`.

- Divider drags raise the host UI the same way and send `resize-split` as the pointer moves (throttled to one per animation frame).

- The workspace lowers the host UI on `drag {active: false}`, on the window's `blur`, and on any other intent arriving while raised (Review Focus 3).

- `split` with `canSplit` false is ignored. Menu Split Right (`CmdOrCtrl+\`) and Split Down call `splitActive`; their `enabled` follows `canSplit` for the active document.

- [ ] **Step 1: Write the failing tests**

```js
// ui-intents.test.js
test('move-tab, split and drag intents', () => {
  assert.deepEqual(parseIntent({ type: 'split', docId: 'd1', paneId: 'p1', edge: 'top' }, ids), { type: 'split', docId: 'd1', paneId: 'p1', edge: 'top' });
  assert.equal(parseIntent({ type: 'split', docId: 'd1', paneId: 'p1', edge: 'middle' }, ids), null);
  assert.equal(parseIntent({ type: 'move-tab', docId: 'd1', paneId: 'p1', index: -1 }, ids), null);
});
```

Smoke:

```js
step('Split Right moves the active document into a new pane'); // two documents in p1 → splitActive('right') → two panes, views side by side (bounds)
step('a split intent from the host UI splits; a move-tab intent moves back and the pane disappears');
step('a drag raises the host UI and ending it lowers it');     // intent drag true → host UI view is the last child; false → first child
step('a drag ends when the window loses focus');               // drag true, win.emit('blur') → host UI first child again
step('Split Right is disabled for a pane\'s only tab');
```

- [ ] **Step 2: Run to verify they fail** — FAIL.
- [ ] **Step 3: Implement** raise/lower, the drag interaction in `ui.js` (pointer events and `setPointerCapture` on the dragged element), drop zones, divider dragging, `splitActive`, menu states.
- [ ] **Step 4: Run** — `npm test`, `npm run smoke` → pass.
- [ ] **Step 5: Manual check** — drag a tab to each of the four edges, into another tab strip, back until a pane disappears; resize a divider; release a drag outside the window and over the Dock; the documents stay clickable afterwards.
- [ ] **Step 6: Commit** — `git commit -m "feat(host): drag tabs between panes and split them"`

---

### Task 12: Thumbnails

Decision Q10: capture when a document is hidden, after every save and reload, 2 s after the last change while visible, once after first load (hidden too, if Task 1 says it works); show the document as last seen; placeholder until the first capture; memory only.

**Files:**

- Create: `doc-host/src/thumbnail-triggers.js`, `doc-host/src/thumbnails.js`, `doc-host/test/thumbnail-triggers.test.js`
- Modify: `doc-host/src/workspace.js`, `doc-host/src/host-ui.js`, `doc-host/src/ui/ui.js`, `doc-host/src/ui/ui.css`, `doc-host/tools/smoke.js`

**Interfaces:**

- Produces:

```js
// thumbnail-triggers.js (pure, timers injected)
createThumbnailTriggers({ capture: (docId, reason) => void, delayMs = 2000, captureHidden = true,
                          setTimeout = globalThis.setTimeout, clearTimeout = globalThis.clearTimeout }) → {
  loaded(docId, visible), hidden(docId), saved(docId), reloaded(docId), changed(docId, visible), forget(docId)
}
// thumbnails.js
captureThumbnail(webContents, { width }) → Promise<string | null>   // 'data:image/jpeg;base64,…' (quality 80), null when empty or failing
```

Rules: `loaded` captures at once if visible, or if hidden and `captureHidden`; `hidden`, `saved`, `reloaded` capture at once (and cancel a pending change capture); `changed` while visible (re)starts a `delayMs` timer; `forget` cancels. The workspace wires: `ui.rendered('load'|'save'|'reload')`, every `doc:dirty` of a visible document, and every document that becomes hidden in `apply`. `capture` calls `captureThumbnail(view.webContents, { width: (list.width − 16) × display scale factor })` and `hostUi.pushThumbnail(docId, dataUrl)`; the workspace keeps the newest data URL per document (memory only) and sends them with the state when the host UI reloads. In thumbnails mode each list entry shows the image at the list width minus 16 px (height by the image's own aspect ratio) with the label below; until a thumbnail exists, a placeholder box with the label and the document type.

- [ ] **Step 1: Write the failing tests** (`t.mock.timers.enable({ apis: ['setTimeout'] })`)

```js
test('a change while visible captures after 2 s of quiet', (t) => { /* changed, tick 1500, changed, tick 1999 → none; tick 1 → one 'changed' capture */ });
test('hiding, saving and reloading capture at once and cancel a pending change capture', (t) => {
  /* for each of hidden, saved, reloaded: changed('d1', true), tick 500, <trigger>('d1') → captures [['d1', reason]];
     tick 2000 → still exactly one capture */
});
test('a hidden first load is captured only when captureHidden', (t) => { /* loaded('d1', false) → [['d1', 'load']] with captureHidden true, [] with false; loaded('d2', true) → captured either way */ });
test('forget cancels a pending capture', (t) => { /* changed('d1', true), forget('d1'), tick 3000 → no capture */ });
```

Smoke: count captures through a `capture` spy on the workspace (`workspace.thumbnailCaptures` records `[docId, reason]`): save → `save`; switching tabs → `hidden` for the one left; an edit → `changed` after 2 s. (Whether the image itself has content is a manual check: captures fail without a display surface.)

- [ ] **Step 2: Run to verify they fail** — FAIL.
- [ ] **Step 3: Implement** triggers, capture, wiring and the thumbnails mode in the page.
- [ ] **Step 4: Run** — `npm test`, `npm run smoke` → pass.
- [ ] **Step 5: Manual check** — View → Thumbnails with three documents (one restored and never shown): each shows its last seen state; editing updates the visible one after about 2 s.
- [ ] **Step 6: Commit** — `git commit -m "feat(host): document list thumbnails"`

---

### Task 13: Kit update

Decision Q15: badge, File → Update Kit…, a banner the first time per run; a confirming sheet; unsaved data saved in the same write; reload; a "Kit updated" banner with Undo until the document closes.

**Files:**

- Modify: `doc-host/src/document.js`, `doc-host/src/workspace.js`, `doc-host/src/menu.js`, `doc-host/tools/smoke.js`

**Interfaces:**

- Consumes: `outdatedKit`, `findKit`, `newestKit` (Task 3), `writeDocument(…, { kit })` (Task 3), banner kinds (Task 6).
- Produces: `Document.updateKit() → Promise<boolean>`, `Document.undoKitUpdate() → Promise<boolean>`; banner actions `update-kit` and `undo-kit`.

Rules:

- `status.kitUpdate = outdatedKit(parts)` after every load and reload.

- `updateKit()`: sheet — message `Update the kit of ${name} from ${from} to ${to}?`, detail `Only the kit is replaced. The previous file is kept in the version store.` plus ` Your unsaved changes are saved with it.` when dirty, buttons `['Update kit', 'Cancel']`, `defaultId: 0`, `cancelId: 1`. On Update it runs in the save turn (after `settle()`, like a save): the data conflict check and its sheet apply as in `doSave`; `json` is a snapshot when dirty, else `null`; `writeDocument(filePath, json, { storeDir, expectedDataHash: known.data, kit: newestKit(api) })`; then the dirty counter rule of a save, `loadFromDisk()`, `status.kitUpdated = { from, to }`, `ui.update()`. Errors → the save error sheet with message `The kit of ${name} could not be updated. The file on disk was not changed.`

- `undoKitUpdate()`: no confirmation; the same write with `kit: findKit(kitUpdated.from)`; then `status.kitUpdated = null`. Available until the document is closed (the status lives with the document).

- Menu Update Kit… enabled iff the active document's `status.kitUpdate`; Undo Kit Update enabled iff `status.kitUpdated`.

- [ ] **Step 1: Write the failing smoke steps**

```js
step('an outdated kit shows its badge and banner');            // open fixtures/outdated-kit copy → describeStatus badge 'kit-update'
step('Update kit with unsaved changes writes kit and data in one write');
// type into the note; sheet stub → 0 (Update kit); on disk: kitVersion '1.1.0', kit text of 1.1.0, data has the text,
// style and script unchanged; exactly one new version in the store equal to the previous file; isDirty false; page reloaded
step('Undo brings kit 1.0.0 back');                            // banner action undo-kit → on disk kitVersion '1.0.0'; badge 'kit-update' again
step('a kit update that hits a data conflict asks first');     // external data change → conflict sheet → Cancel → nothing written
```

- [ ] **Step 2: Run to verify they fail** — `npm run smoke` → FAIL (`updateKit` missing).
- [ ] **Step 3: Implement** `updateKit`, `undoKitUpdate`, the banner actions and the menu items.
- [ ] **Step 4: Run** — `npm test`, `npm run smoke`, `npm run probe` → pass.
- [ ] **Step 5: Commit** — `git commit -m "feat(host): update and undo a document's kit"`

---

### Task 14: Acceptance walk-through and docs

**Files:**

- Modify: `firstSpec.md` (acceptance criterion 1 note), `docs/plans/m2-workspace.md` (results), `docs/document-spec.md` if the walk-through finds drift

- [ ] **Step 1: Automated** — `npm test`, `npm run probe`, `npm run smoke`: all pass; paste the summary lines into the results below.

- [ ] **Step 2: Walk through the M2 acceptance criteria** by hand where no test covers them, recording date and outcome next to each:
  
  1. **Open**: dialog, command line and drop each add a tab in the focused pane, selected in the tab strip and the list; opening an open document brings its tab forward.
  2. **Several documents**: five open; switching keeps unsaved changes and view state (scroll, filters).
  3. **Splits**: tab to each edge; Split Right / Down; move between strips; an emptied pane disappears; dividers resize.
  4. **Save**: Cmd/Ctrl+S saves only the active document; `•` on its tab, list entry and title.
  5. **List**: compact and thumbnails; restored, never-shown documents have a thumbnail or the placeholder (per Task 1).
  6. **Background changes**: an agent edits a hidden clean document (reload + "Updated from disk") and a hidden dirty one (banner + badge); no dialog, the active document is not interrupted.
  7. **Trust boundary**: `npm run probe` passes; no document draws over list, tab strips or banners.
  8. **Close summary**: Save all, a failing save stops on that document, Review each, Cancel.
  9. **Quit**: Cmd+Q continues after the close summary on macOS.
  10. **Restore**: documents, layout, tabs, active document, list mode, window size; missing files in one notice.
  11. **Kit update**: badge, Update kit with unsaved changes, one write, version store, reload, Undo; on disk only kit, version field and data changed.
  12. **Kit 1.1**: hours sheet shows no Save button in the host; in Chrome its Save button and status work; a fallback save is byte-identical to a host save (`npm test` covers the bytes).
  13. **Regression**: every M1 criterion in firstSpec still holds.
      Plus: on Windows, opening one file as `HOURS.EV.HTML` and `hours.ev.html` gives one tab (or record the failure as a known limit).

- [ ] **Step 3: firstSpec** — criterion 1 note: `(M1: drag and drop and command line; M2, <date>: opens as a tab in the focused pane, selected in the tab strip and the document list; double-click with M3)`.

- [ ] **Step 4: Commit** — `git commit -m "docs: record M2 acceptance results"`

---

## Known limits of M2 (by design)

- Sessions of closed documents are cleared but stay registered in Electron until the app quits; a long-running workspace accumulates one empty in-memory session per document opened.
- The drop guard can still be removed by a document calling `document.open()` (M1 limit; M4 moves the guard outside the page).
- A document that runs `if (confirm(…))` never takes that branch inside the host (dialogs are off); `evHost.confirm` is a later item.
- Hidden documents run throttled (timers at most once a second, after 5 minutes once a minute); a document showing a live clock updates late while hidden.
- `workspace.json` is written when the host quits; after a crash the previous run's layout is restored.
- Thumbnails need a display surface; without one (screen off, locked, headless) the list shows placeholders.
- Everything in "Not in M2" in firstSpec.md.

## Spike results (filled in by Task 1)

- Capture: Task 9 hides tabs with `setVisible(false)` (the brief's preferred method; it can be captured and its page stays `hidden`). Task 12 captures hidden documents with `capturePage(undefined, { stayHidden: true })`, and only for documents that have been shown since they opened; a restored background tab keeps its placeholder until its first show. Evidence: macOS 26.5.1, Electron 44.5.1, screen on, Windows not tested, no input needed. One 600×400 window with sandboxed views, 20 runs, both options (`default`, `stayHidden`). 4 runs (5–8, back to back) are excluded: 29 of 30 captures failed in each, the visible view's too, cause unconfirmed. In the other 16 runs the visible view, and a view hidden with `setVisible(false)` or removed with `removeChildView` after it had been shown, were captured every time (600×400 pixels for a 300×200 view on a 2× display). `document.visibilityState` of hidden views stayed `hidden` before and after every capture. Stale frames: after a script changed a hidden page's colour, `default` captures returned the previous frame in 10 of 35 cases (`removeChildView` 6 of 15, `setVisible(false)` 1 of 15, and 3 of the 5 cases where the visible view's page was `hidden` because its window was covered or minimised; the 3 stale ones were runs 18–20, window covered by another app). The retry, always `stayHidden` and at least 200 ms later, was current in 34 of 35. `stayHidden` taken in the first place was current in 15 of 15 for `removeChildView` and for the visible view, and 14 of 15 for `setVisible(false)`. So `stayHidden` alone may explain the retry result; the data cannot separate "retry helps" from "`stayHidden` helps". A thumbnail can still be one change behind. A view never painted always failed: a view never attached with "Current display surface not available for capture"; a view attached and hidden before its first load (a restored background tab, `hiddenFromStart`) with the same error. After a 300 ms show and re-hide, the never-attached view was captured 14 of 14 with `stayHidden` (`default`: 8 of 14, 6 `UnknownVizError`), but the restored-tab case only 8 of 14 with either option (6 "display surface" errors), so do not rely on a short show.
- Drag overlay: Task 11 raises the host view during a tab drag (`addChildView(hostView)`, transparent background) only to draw above the documents; the pointer does not depend on it, so no thumbnail fallback is needed. Evidence: macOS 26.5.1, Electron 44.5.1, Windows not tested, a human dragging with the mouse in a 900×640 window (host view at index 0 under two document views, drags started in the host's top strip). 5 drags: 3 raised (on `pointerdown` raise; on `pointerup` `addChildView(hostView, 0)`), 2 not raised as a control. The host view got every move over the documents with and without the raise (raised 321, 151 and 75; not raised 89 and 105) and every `pointerup`. No document got a pointer event in any drag, so on macOS a drag stays with the view where it started. `addChildView(hostView, 0)` put the host back at index 0 after all 3 raises; later moves and clicks reached the documents. Released outside the window (drag 4): the host got the moves outside it and the `pointerup` (x = −34), with no `pointercancel` and no window `blur`; `lostpointercapture` followed each `pointerup` within 1 ms. Cmd+Tab mid-drag (drag 5): app, window and page lost focus, the drag was not cancelled, and the `pointerup` came 2.5 s later. The pointer did not move in that time, so moves while another app is active were not tested. The human saw the documents while the host was raised. Nobody observed whether the host's own drawing (the red marker) showed above the documents, so Task 11's first step should look once.
- Dialogs: Task 9 and any document spec can rely on `disableDialogs: true` silencing `alert` and `confirm`: no box, an immediate return, and `confirm` returns `false`. `prompt()` does not return `null`; it throws `Error: prompt() is not supported.`, so a script stops at an unguarded `prompt()`, and text that says it returns `null` must say it throws. Evidence: macOS 26.5.1, Electron 44.5.1, Windows not tested, no input needed, 2 runs. In a sandboxed view with `disableDialogs: true`, `alert('x'); confirm('y')` took 0 and 1 ms and `c` was boolean `false`; the app's on-screen window count stayed at 1. A control view without `disableDialogs` opened a 260×96 box window, and its `confirm()` had not returned 4 s later. `prompt('z')` threw at once in both views.
- Shortcuts: Task 9 keeps `Ctrl+Tab`, `Ctrl+Shift+Tab`, `CmdOrCtrl+1` and `CmdOrCtrl+Alt+Right` as menu accelerators, and handles `CmdOrCtrl+\` (Split Right) with a `before-input-event` listener on every web contents. The listener acts on `keyDown`, matches `input.code === 'Backslash'` with `meta` (`control` on Windows) and not `input.key`, and calls `event.preventDefault()`, which also stops the menu accelerator, so it is correct whether or not the accelerator would fire. This is a safe default, not a measured result: `CmdOrCtrl+\` was not tested with plain ⌘, because every attempt had ⌥ held (⌘⌥⇧7 three times, ⌘⌥7 once, ⌘⌥⇧ + the `$` key once), and no event for plain ⌘ + `$` is in the log. Evidence: macOS 26.5.1, Electron 44.5.1, Windows not tested, a human pressing keys on a Swiss German layout; an application menu with the five accelerators and a sandboxed view that kept focus. The four accelerators above each fired their menu item (`triggeredByAccelerator: true`), 1–5 ms after `before-input-event`. The page's `keydown` saw every press, also those four. With ⌘ held, no `keyUp` came for the main key, hence `keyDown`. With ⌘ held, `key` was not the typed character: ⌘⌥⇧7 gave `key: '‡', code: 'Digit7'`, ⌘⌥7 gave `'¶'`, and ⌘⌥⇧ + the `$` key gave `key: '»', code: 'Backslash'`. So `code` names the physical key, but it was seen as `Backslash` only with ⌥⇧ held.

## Acceptance results (filled in by Task 14)

…
