# Format groundwork Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven-development (recommended) or executing-plans to implement this plan task by task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** EverythingApp 0.2.0 accepts and writes documents in the amended document specification v1: a document id, a manifest that declares text fields, published modules (CodeMirror first), kit 2.0.0 with helpers for data designed for merging, and fixtures that follow the new data rules.

**Architecture:** The frame (`src/frame.js`) gains three parts: `docId` (a field), `manifest` (a section) and `modules` (a list parsed by a small sub-parser, because it varies in length). Modules get a registry beside the kit (`modules/`, pinned by hash like `kit/`). The conformance check validates the new parts; the host assigns a document id in memory and writes it with the first write of any kind. Kit 2.0.0 rebuilds the new frame in the browser fallback and adds `newId`, `orderBetween`, `ordered`, `module` and `defineModule`. Nothing records history; no `evHost` change.

**Tech Stack:** Node.js ≥ 22 (tested on 25.9), Electron 44.5, CommonJS, `node:test`, jsdom 30 (tests only). New dev dependencies, exact versions: `esbuild` 0.28.2, `@codemirror/state` 6.7.6, `@codemirror/view` 6.43.14, `@codemirror/commands` 6.11.1 (module build only; no new runtime dependency).

**Spec:** [docs/document-spec.md](../document-spec.md) (normative; sections 2, 3 rule 10, 4, 5, 6, 7, 9, 10, 11), [firstSpec.md](../../firstSpec.md) ("Format groundwork"), [ADR 0003](../adr/0003-modules-published-with-the-kit.md), [ADR 0005](../adr/0005-manifest-section.md), [ADR 0006](../adr/0006-lists-are-maps-keyed-by-id.md), [glossary](../reference/glossary.md). Design decisions Q1–Q22 (2026-10-10) are logged in `.superpowers/sdd/decisions.md` (local) under "Format groundwork".

## Global Constraints

Everything from the M1–M3 Global Constraints still holds ([m1-loop.md](m1-loop.md#global-constraints), [m2-workspace.md](m2-workspace.md#global-constraints), [m3-distribution.md](m3-distribution.md#global-constraints)). The commit trailer stays, verbatim:

```text
Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
```

New for the format groundwork:

- `ev-host-api` stays `1`. The old frame (without `ev-doc-id`, manifest and module lines) is no longer accepted; kits 1.0.0 and 1.1.0 leave `kit/published.json`.
- Document id: `^([0-9a-f]{32})?$` (empty or 32 lowercase hex). New ids are 16 random bytes as hex (`crypto.randomBytes` in the host, `crypto.getRandomValues` in the kit).
- Item ids (`EvKit.newId()`): 16 lowercase hex characters (8 random bytes).
- Sort keys: non-empty strings over `0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz` that do not end with `0`, compared as plain strings.
- Text-field pattern: segments joined by `.`, each `*` or `^[A-Za-z_][A-Za-z0-9_]*$`.
- Module names: `^[a-z0-9]+(-[a-z0-9]+)*$`; module and kit versions `^\d+\.\d+\.\d+$`. A module's major version is the number before the first dot.
- A section's or module's element content is `'\n' + file text` for kit and module files (as today for the kit); manifest and data have no leading line break.
- The host never writes the style, manifest or script section; it writes the data block, the kit (on a confirmed kit update) and the document id (only while the id on disk is empty).
- Release: 0.2.0, the minor release of this milestone (`docs/guides/releasing.md`).

## Review Focus

1. **The host's own id write is not an outside change.** After the first save writes the id, no "Updated from disk" banner and no reload follow (the watcher's outside-data hash changes, but `acceptOnDisk(written)` adopts it). Pinned in Task 8 (smoke).
2. **Reload before the first save.** A document with an empty id that is reloaded from disk (outside change, View → Reload) keeps its in-memory id while the disk id is still empty, and adopts the disk id once one is there. Pinned in Task 6.
3. **Every host write carries the id.** A kit-update write of a clean document with an empty id writes the id too. Pinned in Task 6.
4. **One id per browser session.** In the fallback, the second and later saves of a session reuse the id the first save assigned (Firefox and Safari save by download, so every save produces a file). Pinned in Task 4.
5. **Many inserts at the same place.** 1,000 `orderBetween(null, first)` calls in a row (always inserting at the front) produce valid, strictly increasing keys. Pinned in Task 4.

## File structure

```text
doc-host/
  src/frame.js          + docId field, manifest section, modules list (parse + build)
  src/splice.js         + setDocId(html, docId)
  src/manifest.js       NEW checkManifest(text) → { manifest, errors }
  src/conformance.js    + docId rule, manifest-*, module-* codes
  src/doc-id.js         NEW newDocId()
  src/write.js          + docId option; meta.json records docId
  src/document.js       holds this.docId; passes it to every write; adopts the disk id
  kit/index.js          createKitRegistry(list, dir); test kits when EV_TEST_KITS=1
  kit/ev-kit-2.0.0.js   NEW kit 2.0.0
  kit/published.json    only 2.0.0
  modules/index.js      NEW module registry (findModule, newestModule)
  modules/published.json NEW
  modules/codemirror-1.0.0.js NEW (built, then pinned)
  modules/build.js      NEW esbuild build script (not packaged)
  modules/src/codemirror.js NEW build entry
  tools/pin-kit.js      also pins modules: pin-kit.js module <name> <version>
  tools/assemble.js     + manifest.json, meta.modules, docId
  tools/start.js        --smoke sets EV_TEST_KITS=1
  test/kits/            NEW test-only kit 1.9.0 + published.json (not packaged)
  fixtures/src/*        manifest.json added; hours sheet and to-do list on maps keyed by id
  electron-builder.yml  + modules/**, - modules/build.js, - modules/src/**
```

---

### Task 1: The new frame

**Files:**
- Modify: `doc-host/src/frame.js`, `doc-host/src/splice.js`, `doc-host/test/helpers.js`
- Test: `doc-host/test/frame.test.js`, `doc-host/test/splice.test.js`

**Interfaces:**
- Produces: `parts` gains `docId: string`, `manifest: string`, `modules: Array<{ name: string, version: string, text: string }>`; `buildDocument(parts)` and `parseDocument(html)` handle them; `setDocId(html, docId) → string` in `splice.js`; `makeParts()` defaults `docId: ''`, `manifest: '{}'`, `modules: []`.

- [ ] **Step 1: Write the failing tests** in `test/frame.test.js`:
  - `buildDocument produces the exact frame`: update the expected text to the frame of document-spec section 2, with `docId: '0123456789abcdef0123456789abcdef'`, `manifest: '{"textFields":["rows.*.note"]}'` and two modules `[{name:'alpha',version:'1.0.0',text:'\nA\n'},{name:'beta',version:'2.1.0',text:'\nB\n'}]`; assert the module lines are `  <script id="ev-module-alpha" data-module-version="1.0.0">\nA\n</script>\n  <script id="ev-module-beta" data-module-version="2.1.0">\nB\n</script>\n` directly before `  <script id="ev-script">`.
  - `parseDocument returns the parts of a built document` with zero, one and two modules (`assert.deepEqual(parseDocument(buildDocument(p)).parts, p)`).
  - `parseDocument refuses a module line with a missing version attribute` → `ok: false`, offset at that line.
  - `a module text ends at its closing tag in any letter case` (like the section test).
  - In `test/splice.test.js`: `setDocId fills an empty id and keeps every other byte`; `setDocId leaves a non-empty id unchanged`; `setDocId rejects an id that is not 32 lowercase hex` (TypeError).
- [ ] **Step 2: Run** `npm test` in `doc-host`. Expected: the new tests FAIL; the rest pass.
- [ ] **Step 3: Implement.** In `FRAME`, insert `'">\n  <meta name="ev-doc-id" content="', 'docId'` after `docTypeVersion`, `'</style>\n  <script type="application/json" id="ev-manifest">', 'manifest', '</script>\n</head>…'`, and a `'modules'` slot between `'</script>\n'` (after the kit) and `'  <script id="ev-script">'`. `SLOT_END`: `docId: /"/g`, `manifest: /<\/script/gi`. `parseDocument` handles `modules` with a loop instead of `SLOT_END`: while the text at `pos` starts with `  <script id="ev-module-`, read the name up to `"`, require `" data-module-version="`, read the version up to `"`, require `">`, read the text up to `/<\/script/gi`, require `</script>\n`; on any mismatch return `{ ok: false, offset, expected }` like the literal case. `buildDocument` renders `modules` as the joined lines. `setDocId` works through the frame like `replaceKit`. Update `makeParts` defaults.
- [ ] **Step 4: Run** `npm test`. Expected: frame and splice tests PASS. Conformance, kit and fixture tests may now FAIL (old frame); they are fixed by Tasks 2, 4 and 7. Note the failing test names in the commit message body.
- [ ] **Step 5: Commit** `feat(frame): document id, manifest and module lines`.

### Task 2: Conformance for the document id and the manifest

**Files:**
- Create: `doc-host/src/manifest.js`
- Modify: `doc-host/src/conformance.js`
- Test: `doc-host/test/conformance.test.js`, `doc-host/test/manifest.test.js` (new)

**Interfaces:**
- Consumes: `parts.docId`, `parts.manifest` (Task 1).
- Produces: `checkManifest(text) → { manifest: object | null, errors: Array<{ code, message }> }` in `src/manifest.js`; `checkDocument` result gains `manifest` (the parsed object, when valid).

- [ ] **Step 1: Write the failing tests** in `test/manifest.test.js`: `{}` and `{"textFields":["rows.*.note","intro"]}` pass; `{"textFields":[]}` passes; codes and inputs: `manifest-escape` for `{"textFields":["a<b"]}` written raw; `manifest-json` for `{`, `[]`, `null`; `manifest-key` for `{"textfields":[]}` (message names the key); `manifest-invalid` for `{"textFields":"rows.*.note"}`, `{"textFields":[1]}`, `["rows..note"]`, `["rows.*-x"]`, `["1abc"]`, `[""]`, and a repeated pattern. In `test/conformance.test.js`: a document with `docId: 'ABC'` fails with `field` (message names `docId`); an empty `docId` passes; a manifest problem appears in `checkDocument(...).errors` with its code.
- [ ] **Step 2: Run** `npm test`. Expected: the new tests FAIL.
- [ ] **Step 3: Implement** `checkManifest` (escape check, then `JSON.parse`, then object shape, then keys against `['textFields']`, then each pattern against the Global Constraints rule and uniqueness). Messages: `manifest-escape` "The manifest contains "<". Write every "<" in the manifest as <."; `manifest-json` "The manifest must contain a JSON object: …"; `manifest-key` "The manifest has the key "<key>", which the document specification does not define."; `manifest-invalid` "textFields must be a list of unique path patterns such as "rows.*.note"; found <JSON of the bad value>.". Add `docId: [/^([0-9a-f]{32})?$/, 'empty or 32 lowercase hex characters']` to `FIELD_RULES`; call `checkManifest(parts.manifest)` in `checkDocument`.
- [ ] **Step 4: Run** `npm test`. Expected: manifest and the new conformance tests PASS.
- [ ] **Step 5: Commit** `feat(conformance): document id rule and manifest check`.

### Task 3: Module registry and module conformance

**Files:**
- Create: `doc-host/modules/index.js`, `doc-host/modules/published.json` (`[]` for now)
- Modify: `doc-host/kit/index.js`, `doc-host/tools/pin-kit.js`, `doc-host/src/conformance.js`, `doc-host/electron-builder.yml`
- Test: `doc-host/test/modules.test.js` (new), `doc-host/test/conformance.test.js`

**Interfaces:**
- Produces: `createModuleRegistry(list, dir) → { MODULES, findModule(name, version), newestModule(name) }` and the default registry's functions exported from `modules/index.js` (each module `{ name, version, text, hash }`, `text` = `'\n' + file`); `node tools/pin-kit.js module <name> <version>` appends `{ name, version, file: "<name>-<version>.js", sha256 }` to `modules/published.json` with the same CR, `</script` and `<!--` checks as kits; `node tools/pin-kit.js <version> <api>` unchanged. Also `createKitRegistry(list, dir)` in `kit/index.js` (same exports as today, built from a list), so tests and Task 4 can inject kits.

- [ ] **Step 1: Write the failing tests:** `createModuleRegistry` throws "Published module <name> <version> was modified …" when a file's hash differs; `findModule` and `newestModule` return the right entries or `null` (temp dir with two fake module files). Conformance, with a registry injected through `checkDocument(input, { modules })` (default: the published registry): `module-unknown` for an unknown name and for an unknown version of a known name; `module-modified` for a changed text; `module-order` for `beta` before `alpha` and for a name listed twice; a valid module line passes.
- [ ] **Step 2: Run** `npm test`. Expected: the new tests FAIL.
- [ ] **Step 3: Implement** the registry (mirror of `kit/index.js`), the `module` mode of `pin-kit.js`, the three checks in `checkDocument` (messages: "Module <name> <version> is not a published module." / "The text of module <name> was modified. It must be the exact text of published module <name> <version>." / "Module lines must be sorted by name, each module once."), and `electron-builder.yml` `files`: add `modules/**`, `!modules/build.js`, `!modules/src/**`.
- [ ] **Step 4: Run** `npm test`. Expected: the new tests PASS.
- [ ] **Step 5: Commit** `feat(modules): module registry and conformance codes`.

### Task 4: Kit 2.0.0

**Files:**
- Create: `doc-host/kit/ev-kit-2.0.0.js`, `doc-host/test/kits/ev-kit-1.9.0.js`, `doc-host/test/kits/published.json`
- Modify: `doc-host/kit/published.json`, `doc-host/kit/index.js`, `doc-host/test/kit.test.js`, `doc-host/test/helpers.js`
- Delete: `doc-host/kit/ev-kit-1.0.0.js`, `doc-host/kit/ev-kit-1.1.0.js`

**Interfaces:**
- Consumes: the frame of Task 1.
- Produces: `window.EvKit` = frozen `{ version: '2.0.0', init, newId, orderBetween, ordered, module, defineModule }` with the semantics of document-spec section 7; `currentKit()` is 2.0.0. With `EV_TEST_KITS=1`, `kit/index.js` also loads `test/kits/published.json` when that file exists (it is never packaged); test kit 1.9.0 is kit 2.0.0's text with `KIT_VERSION = '1.9.0'` and the header line changed, so `outdatedKit` reports `{ from: '1.9.0', to: '2.0.0' }`.

- [ ] **Step 1: Write the failing tests** in `test/kit.test.js` (jsdom, as today):
  - The existing "fallback rebuild equals host build" test, now with `docId` set, a manifest and one fake module `{ name: 'sample', version: '1.2.0', text: "\nEvKit.defineModule('sample', '1.2.0', { hello: 1 });\n" }`: `doc.toHtml()` equals `buildDocument(parts)` with the new data.
  - `the first fallback save fills in a document id and later saves keep it` (picker stub records two saves; both have the same `ev-doc-id`, matching `/^[0-9a-f]{32}$/`; an existing id is kept).
  - `EvKit.module returns a defined module and checks its major version`: `module('sample', 1).hello === 1`; `module('sample', 2)` throws a message containing `sample` and `1.2.0`; `module('missing', 1)` throws a message containing `missing`; a second `defineModule('sample', …)` throws.
  - `newId returns 16 lowercase hex characters, different each time`.
  - `orderBetween`: `orderBetween(null, null) === 'V'`; `orderBetween('V', null) === 'l'`; `orderBetween(null, 'V') === 'G'`; `orderBetween('', …)`, `orderBetween('a0', …)`, `orderBetween('b', 'a')` and `orderBetween('a', 'a')` throw; 1,000 inserts at the front and 1,000 between two neighbours stay valid and strictly increasing (Review Focus 5).
  - `ordered` sorts by `order`, breaks ties by id, puts items without `order` last by id, and returns `[id, item]` pairs.
  - `kit 2.0.0 is the only published kit; with EV_TEST_KITS the test kit 1.9.0 is outdated by 2.0.0` (load `kit/index.js` in a child `node -e` with the env var, since the registry is built at require time).
- [ ] **Step 2: Run** `npm test`. Expected: the new tests FAIL.
- [ ] **Step 3: Write `kit/ev-kit-2.0.0.js`** from 1.1.0: `buildDocument` produces the frame of Task 1; `frame` also reads `docId` (`meta[name="ev-doc-id"]`) and the manifest text at load; `toHtml` reads the module elements (`script[id^="ev-module-"]`, in document order: name from the id, `data-module-version`, `textContent`) at call time, because they come after the kit; `save()` fills `frame.docId` with 16 random bytes as hex before its first `toHtml` if it is empty. `orderBetween` uses this algorithm (keys never end in `0`, so there is always room before a key):

  ```js
  var DIGITS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
  function midpoint(a, b) { // a < b; a may be '', b may be null (no upper bound)
    if (b !== null) {
      var n = 0;
      while ((a[n] || '0') === b[n]) n++;
      if (n > 0) return b.slice(0, n) + midpoint(a.slice(n), b.slice(n));
    }
    var da = a ? DIGITS.indexOf(a[0]) : 0;
    var db = b !== null ? DIGITS.indexOf(b[0]) : DIGITS.length;
    if (db - da > 1) return DIGITS[Math.round((da + db) / 2)];
    if (b !== null && b.length > 1) return b.slice(0, 1);
    return DIGITS[da] + midpoint(a.slice(1), null);
  }
  // orderBetween(before, after): validate both (non-empty, alphabet, not ending in '0'),
  // require before < after when both are given, return midpoint(before || '', after).
  ```
  Then pin it (`node tools/pin-kit.js 2.0.0 1`), remove 1.0.0 and 1.1.0 from `published.json` and the folder, add the test kit and its list, and make `helpers.js` use `currentKit()` as today.
- [ ] **Step 4: Run** `npm test`. Expected: kit tests PASS. Fixture tests still FAIL until Task 7.
- [ ] **Step 5: Commit** `feat(kit): kit 2.0.0 with document id, manifest, modules and data helpers`.

### Task 5: The `codemirror` module 1.0.0

**Files:**
- Create: `doc-host/modules/src/codemirror.js`, `doc-host/modules/build.js`, `doc-host/modules/codemirror-1.0.0.js` (generated)
- Modify: `doc-host/package.json` (dev dependencies, script `"build-module": "node modules/build.js"`), `doc-host/modules/published.json`
- Test: `doc-host/test/modules.test.js`

**Interfaces:**
- Consumes: `EvKit.defineModule` (Task 4), the registry and `pin-kit.js module` (Task 3).
- Produces: published module `codemirror` 1.0.0 exporting `EditorState`, `EditorView`, `keymap`, `history`, `defaultKeymap`, `historyKeymap`.

- [ ] **Step 1: Write the failing test** `codemirror 1.0.0 is published and loads in a document`: build a document (`makeParts` with `modules: [findModule('codemirror','1.0.0')]` and script `window.cm = EvKit.module('codemirror', 1);`), load it in jsdom; `cm.EditorState.create({ doc: 'x' }).doc.toString() === 'x'`; the six exports are functions or objects; the module text's first line matches `/^\/\* EverythingApp module codemirror 1\.0\.0: @codemirror\/state 6\.7\.6, @codemirror\/view 6\.43\.14, @codemirror\/commands 6\.11\.1; built by doc-host\/modules\/build\.js \*\/$/`.
- [ ] **Step 2: Run** `npm test`. Expected: FAIL (module not published).
- [ ] **Step 3: Implement.** `npm install --save-dev --save-exact esbuild@0.28.2 @codemirror/state@6.7.6 @codemirror/view@6.43.14 @codemirror/commands@6.11.1`. `modules/src/codemirror.js` imports the six names and calls `EvKit.defineModule('codemirror', MODULE_VERSION, { … })`. `node modules/build.js codemirror 1.0.0` bundles it with esbuild (`bundle`, `minify`, `format: 'iife'`, `target: 'chrome120'`, `define: { MODULE_VERSION: '"1.0.0"' }`, `legalComments: 'none'`), reads the three package versions from their `package.json` files, and writes the header line, `'\n'`, the bundle and a final `'\n'` to `modules/codemirror-1.0.0.js`. It refuses to overwrite a published module file. Then `node tools/pin-kit.js module codemirror 1.0.0`.
- [ ] **Step 4: Run** `npm test`. Expected: PASS. Run `node modules/build.js codemirror 1.0.0` into a temp path (an `--out` option) and compare: same bytes (the build is reproducible).
- [ ] **Step 5: Commit** `feat(modules): publish codemirror 1.0.0`.

### Task 6: The host assigns and writes the document id

**Files:**
- Create: `doc-host/src/doc-id.js`
- Modify: `doc-host/src/write.js`, `doc-host/src/document.js`
- Test: `doc-host/test/write.test.js`, `doc-host/test/doc-id.test.js` (new)

**Interfaces:**
- Consumes: `setDocId` (Task 1).
- Produces: `newDocId() → string` (32 lowercase hex); `writeDocument(filePath, json, { …, docId })`: when given and the id on disk is empty, the written file carries it; a non-empty id on disk is never replaced. `storeVersion` writes `docId` (the id of the written file, or `null`) into `meta.json`. `Document#docId`.

- [ ] **Step 1: Write the failing tests** in `test/write.test.js`: `a save writes the given id into a file with an empty id and changes nothing else outside the data block`; `a save never replaces an id already on disk` (disk has id A, option id B → file keeps A); `a kit write of a clean document writes the id too` (`json: null`, `kit`, `docId`; Review Focus 3); `meta.json records the document id`. In `test/doc-id.test.js`: `newDocId` matches `/^[0-9a-f]{32}$/` and differs between calls.
- [ ] **Step 2: Run** `npm test`. Expected: the new tests FAIL.
- [ ] **Step 3: Implement.** `newDocId()` = `crypto.randomBytes(16).toString('hex')`. In `writeDocument`, after the splice and kit steps: `if (docId && !check.parts.docId) next = setDocId(next, docId)`. `Document`: constructor sets `this.docId = parts.docId || newDocId()`; every `writeDocument` call passes `docId: this.docId`; `acceptOnDisk(html)` sets `this.docId` to the disk id when it is not empty (Review Focus 2: an empty disk id keeps the in-memory one).
- [ ] **Step 4: Run** `npm test`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(host): assign the document id and write it with the first write`.

### Task 7: Assemble tool and fixtures

**Files:**
- Modify: `doc-host/tools/assemble.js`, `doc-host/fixtures/src/{hours-sheet,todo-list,escape-probe,outdated-kit}/*`, `doc-host/fixtures/*.ev.html` (regenerated), `doc-host/test/fixtures.test.js`

**Interfaces:**
- Consumes: Tasks 1–5.
- Produces: `assemble.js` reads `manifest.json` (required, its JSON re-serialised with `JSON.stringify` and escaped like data), `meta.modules` (names; each resolved to `newestModule(name)`, sorted by name; unknown name → exit 1 with "Module <name> is not a published module."), writes `docId: ''`. Fixtures: hours sheet `{"rows":{}}` keyed by `EvKit.newId()`, shown sorted by date (no sort key), manifest `{"textFields":["rows.*.note"]}`; to-do list `{"items":{}}` with `text`, `done` and `order` (new items `orderBetween(last, null)`), listed with `EvKit.ordered`, manifest `{}`; `outdated-kit` assembled with `"kitVersion": "1.9.0"` (needs `EV_TEST_KITS=1` when assembling and opening).

- [ ] **Step 1: Update the tests** in `test/fixtures.test.js`: hours sheet in the host: after adding one row, `Object.keys(JSON.parse(host.handler()).rows).length === 1` and the key matches `/^[0-9a-f]{16}$/`; to-do list: one added item has `text: 'Buy milk', done: false` and a valid `order`; `every fixture has an empty document id and the current kit, except outdated-kit.ev.html on kit 1.9.0`; `every fixture passes the conformance check` (with `EV_TEST_KITS=1` for `outdated-kit`).
- [ ] **Step 2: Run** `npm test`. Expected: FAIL.
- [ ] **Step 3: Implement** the assemble changes, add `manifest.json` to every fixture source, rewrite the two scripts to the map shapes (data-shape comment at the top, per document-spec section 4), and regenerate all four fixtures.
- [ ] **Step 4: Run** `npm test`. Expected: all unit tests PASS.
- [ ] **Step 5: Commit** `feat(fixtures): new frame, manifests and data on maps keyed by id`.

### Task 8: Smoke test and probe

**Files:**
- Modify: `doc-host/tools/smoke.js`, `doc-host/tools/start.js`

**Interfaces:**
- Consumes: everything above.

- [ ] **Step 1: Update the smoke test.** `start.js --smoke` sets `EV_TEST_KITS=1`. Replace array assertions on `rows`/`items` with map-shaped ones (one small helper, e.g. `count(map)` / `texts(items)` via `ordered` order). After the first save of the hours copy: the id on disk matches `/^[0-9a-f]{32}$/`, everything else outside the data block is unchanged, and the document shows no "Updated from disk" banner and was not reloaded (Review Focus 1). A second save keeps the same id. The kit-update section uses `{ from: '1.9.0', to: '2.0.0' }`. New step `a document with the codemirror module renders under the document CSP`: assemble a temp document (not a fixture) with `modules: ['codemirror']` whose script creates an `EditorView` in `#ev-app` and records `securitypolicyviolation` events; open it; assert `.cm-editor` exists, `.cm-content` is editable and no violation was recorded.
- [ ] **Step 2: Run** `npm run smoke` and `npm run probe` in `doc-host`. Expected: smoke ends with its PASS line; probe 23 PASS, exit 0.
- [ ] **Step 3: Commit** `test(smoke): new frame, document id, test kit and codemirror under the CSP`.

### Task 9: Docs and release 0.2.0

**Files:**
- Modify: `firstSpec.md`, `docs/plans/format-groundwork.md`, `docs/reference/glossary.md` (if any term drifted), `doc-host/package.json`

- [ ] **Step 1: Docs.** firstSpec user story, criterion "Saving changes only the data block on disk": add "(the first save of a new document also writes its document id)". Check document-spec sections 2–11 against the code (frame text, codes, messages, kit functions) and fix whichever is wrong, asking the user where the code and the spec disagree on a decision. Fill in "Acceptance results" below.
- [ ] **Step 2: Manual check with the user** (the host from source, `npm start`): open a new hours sheet copy, add a row, save; the file now has an id, Reveal in Folder, reopen: same id; open the same file in Chrome, add a row, save through the fallback: the id stays.
- [ ] **Step 3: Release** per `docs/guides/releasing.md`: `npm version 0.2.0 --no-git-tag-version` in `doc-host`, commit `release: 0.2.0`, tag `v0.2.0`, push only after the user confirms. Watch the release run with Monitor. Expected: release run green; the installed 0.1.0 offers 0.2.0.
- [ ] **Step 4: Commit** `docs: format groundwork released as 0.2.0`.

## Known limits of the format groundwork (by design)

- No history, no merge: the document id and the manifest are written and checked, not yet used.
- No module update command (rule only, document-spec section 6) and no data-rule check in the host.
- Kit update has no real target until kit 2.0.1 exists; the path is exercised with the test-only kit 1.9.0.

## Acceptance results (filled in by Task 9)

Recorded 2026-10-10 on macOS 26 (arm64), from source.

1. **Unit tests:** 358/358 pass (`npm test`), including the frame, manifest, module, kit 2.0.0 (fallback id, `module`, `newId`, `orderBetween` with 1,000 inserts, `ordered`), write (id written once, never replaced, kit writes, `meta.json`) and fixture tests.
2. **Smoke test:** passes (`npm run smoke`). New steps: the first save writes the id and nothing else outside the data; the host's own id write causes no reload and no "Updated from disk" (this step found a needless reload, fixed in `Document#save`); later saves keep the id; a reload before the first save keeps the id assigned on open; the kit update 1.9.0 → 2.0.0 also writes the id; a document with `codemirror` 1.0.0 renders an editable editor under the document CSP with no violation.
3. **Probe:** 25 PASS, exit 0 (`npm run probe`).
4. **Whole-branch review** (a fresh reviewer): Review Focus 1–5 hold; one Important finding fixed before release: kit 2.0.0's fallback read the module elements at save time, so a script that rewrote the page saved a file without its modules; `init()` now reads them once (kit re-pinned, smoke passes again). Seven minors deferred (ledger).
5. **Specification check:** the frame text and the module line in document-spec section 2 equal `buildDocument` output byte for byte.
6. **Manual check (Task 9, Step 2): pass** (the user, 2026-10-10, from source). Saving the to-do list wrote the id (`429f27ec…`), and the two items it added carry the sort keys `V` and `l`, in the order they were added; the id stayed through reopening and a save from Chrome.
7. **Release 0.2.0 (Task 9, Step 3): pass.** CI on `main` and `release.yml` on `v0.2.0` passed (runs 38075232997, 38075233327); [EverythingApp 0.2.0](https://github.com/telemersion/EverythingApp/releases/tag/v0.2.0) holds the DMG and ZIP for arm64 and x64, `EverythingApp-Setup-0.2.0.exe`, the blockmaps, `latest-mac.yml` and `latest.yml`; not a pre-release, so installed 0.1.0 hosts offer it.

## Spike results

Recorded 2026-10-10 on macOS 26 (arm64), Node 25.9, `@automerge/automerge` 3.5.0, CodeMirror (`@codemirror/state` 6.7.6, `view` 6.43.14, `commands` 6.11.1, `lang-markdown` 6.5.2), esbuild 0.28, Electron 44.5.1 (doc-host's). The scripts were throwaway, in the session scratchpad outside the repository. Their core was a snapshot-diff module: it turns a before/after pair of JSON snapshots into Automerge operations (objects per key; arrays whose items have an `id` matched by id with an LCS, everything else delete + insert; other arrays by value; strings whole, as `ImmutableString`, except declared text fields).

1. **Automerge on a snapshot without its history: not possible; the fallback works.**
   - A document cannot exist at heads H without the changes before H. Changes after H, applied to an empty document, are queued as missing dependencies, and the document stays empty. Operations name object and element ids that come from the history, so a change cannot be built from the JSON snapshot alone either. Automerge 3.5's new `addCommits`/`addFragments`/`saveBundle` are storage and sync formats for Subduction, not a shallow document.
   - **Trap:** `changeAt(doc, H, …)` with heads the document does not know does not throw. It silently records a change with no dependencies. The host must check `A.hasHeads(doc, H)` first.
   - **Naive path loses data.** If Ben starts a fresh Automerge document from the snapshot (`A.from(S)`), edits offline and merges later, the two root-level `rows` objects conflict and one side wins as a whole. In the test, Anna's edit to r2 and her new row r4 vanished.
   - **Fallback works.** Ben's host keeps his saves as data (before/after snapshots on top of S). When the history up to H arrives, it replays each save with `changeAt(doc, H, …)`, chaining the returned `newHeads`. Result: all edits of both sides (`r1 r2:20 r3:30 r5 r4`), Ben's two saves are two changes with their notes, only those two travel to Anna, and both sides converge (`A.equals`). So the pristine file must carry the heads H as its marker, and offline saves on a pristine file without history are stored as data changes until then.
   - **Size of the history in the file (ADR 0002).** A synthetic hours sheet (2 rows per save, some edits, one text field): after 10 / 100 / 500 saves, the JSON data block is 1.9 / 19.1 / 96.1 KB, and Automerge's whole compressed history (`A.save`) is 1.1 / 4.3 / 14.6 KB (base64: 1.5 / 5.8 / 19.4 KB). The last 5 saves alone are 1.7 KB. Loading takes 8–22 ms. The data is repetitive, so real documents compress less well, but the history is no threat to file size for row-shaped data.
2. **Per-character merging of text from snapshot diffs: works, with known limits; the host needs its own bounded diff.**
   - `A.updateText(doc, path, newText)` diffs the two strings itself and records splices. Results: edits in different sentences and in the same word merge (`"The slow brown fox"`), and two different appends both survive, in either order. Accents, emoji and line breaks are fine. Undeclared strings (whole values) lose one side, as designed.
   - **Limits, as in every text CRDT:** two people fixing the same typo give `"thhe fox"`/`"thee fox"`. An edit inside a sentence that the other person moved or deleted comes out garbled (`"Keep.\n, reallyKeep too."`, `"Completely ntew."`). Text has no move, so a moved sentence is a delete plus an insert. This supports the rule "split long text into items".
   - **Performance trap:** `updateText` grows roughly quadratically when the strings differ a lot. A rewritten field took 0.6 s at 10,000 characters, 4.6 s at 30,000 and **48.7 s** at 100,000; a small edit is cheap (87 ms at 1,000,000 characters). A save like that would block the main process.
   - **Bounded diff:** diff-match-patch with `Diff_Timeout = 0.2` s, applied with `A.splice`, stays under 0.4 s (100k rewritten: 0.34 s). But on its own it **splits surrogate pairs** and corrupts emoji and flags (`"x 👍�y"`). Running it over graphemes (`Intl.Segmenter`, each distinct grapheme mapped to one code unit) fixes that: correct for emoji, flags, ZWJ families and combining accents; 0.37 s at 30k and 0.72 s at 100k completely rewritten; same merge results as `updateText` on all test cases. The merge engine should use this or something equivalent, ideally off the main thread.
3. **Snapshot comparison on lists with stable ids: good for insert, delete and edit; reorder needs a sort key.** Base rows r1–r5; A and B edit concurrently; results:

   | Case | Array with ids | Map by id + sort key | Array without ids |
   | --- | --- | --- | --- |
   | Both append / both insert after r2 | both rows, in either order ✓ | ✓ | ✓ |
   | A deletes r2, B edits r2 | r2 gone (delete wins) | r2 gone | r2 comes back with B's edit |
   | Both delete r3 | ✓ | ✓ | ✓ |
   | Both edit r1, different fields | ✓ both kept | ✓ | r1 twice |
   | Both edit r1.hours | one wins (conflict kept by Automerge) | same | r1 twice |
   | A moves r4 to top, B edits r4 | moved, **B's edit lost** | ✓ moved and edited | r4 twice |
   | A moves r4 to top, B moves it to the end | **r4 twice (same id)** | ✓ once (one move wins) | r4 twice |
   | A sorts the whole list, B inserts after r2 | B's row lands first | same | same |
   | A sorts the whole list, B edits r1 | **B's edit lost** | ✓ | r1 twice |

   - Ids are indispensable: without them every concurrent edit duplicates a row. With ids in an array, a move is a delete plus an insert, so a concurrent edit of the moved row is lost and two concurrent moves duplicate it (two rows with one id, which the script and the next diff must survive). A map keyed by id with a sort key handles every case, provided a move gives only the moved row a new key between its neighbours. Renumbering all rows turns every move into a change of every row.
   - A whole-list sort written into the data scatters concurrent inserts. Sorting by date or name is a view, not an edit: the script sorts for display and stores no order (rule 4, "store nothing derived").
   - "Delete wins over a concurrent edit" (the row disappears even though B edited it) is Automerge's behaviour for both shapes. Whether that is right for us is a design question.
   - Cost: one edited row in a list of 1,000 / 5,000 / 20,000 rows takes 2 / 5 / 19 ms per save (after trimming the common prefix and suffix). Reversing 5,000 rows takes 0.55 s, and the plain LCS table needs n×m memory, so the engine needs a linear-space diff (Myers or patience) for large reorders.
4. **CodeMirror 6 as a module: about 200–270 KB, and it runs under the document CSP.**

   | Bundle (esbuild, IIFE, `chrome120`) | Minified | gzip | Unminified |
   | --- | --- | --- | --- |
   | state + view only | 205 KB | 67 KB | 496 KB |
   | + `commands` (history, default keymap) | 270 KB | 89 KB | 667 KB |
   | `codemirror` `basicSetup` | 388 KB | 127 KB | 920 KB |
   | minimal + `lang-markdown` | 501 KB | 174 KB | 1,065 KB |

   - In the minimal bundle, `view` alone is 152 KB. `commands` pulls in `@codemirror/language` and `@lezer/*` (41 KB). For comparison, the hours sheet fixture is 20 KB, so one module makes a document 10–25 times larger. Documents stay well under the 60 MB limit, but every copy carries every module it uses.
   - In a hidden Electron 44 window with the host's CSP (`default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; …`), sandbox, context isolation and `disableDialogs`, inline as `<script id="ev-module-codemirror">` exposing `window.EvCodeMirror`, both the minimal bundle and `basicSetup` loaded with no `securitypolicyviolation`. Typing worked, and Cmd+Z undid it. CodeMirror injects its styles as a runtime `<style>` element (no `adoptedStyleSheets`), which the fallback save ignores because it rebuilds the file from the frame.
   - Neither bundle contains `</script` or `<!--`, so they can be inlined unescaped. A module slot's parser must still guarantee this for every published module.
   - Side note for the host, not documents: Automerge's wasm is 3.6 MB (1.1 MB gzip) in the host's main process.

5. **Deterministic start of a history (added during the design round).** Two hosts that each start a history independently from the same snapshot produce the identical first change when the change is made with an actor derived from the document id, `time: 0` and a fixed message (same heads, byte for byte). Two copies rooted that way, edited concurrently, merged correctly (`r1:10 r2:20 rb ra`). Condition: the snapshot's key order must be canonical (the host sorts keys before it records the first change). So copies of a document made before any history existed can still share a common root, provided their data blocks were identical at that point.

### Questions these results raise for the design round

- The marker in a pristine file: heads H (one or more 64-hex hashes), and where in the frame it lives.
- Offline saves on a pristine file without history: the file carries them as data (snapshots or diffs on top of S), converted with `changeAt` at H later. Their encoding, and what happens if H never becomes available.
- Whether the data design rules make "map keyed by id + fractional sort key" the required shape for ordered lists, or only a recommendation; and whether "sorting is a view" becomes a rule.
- Delete versus concurrent edit: accept Automerge's "delete wins", or surface it ("Ben edited a row you deleted").
- Text field declaration: path patterns such as `rows[].note` and `notes.*.body` were enough in the spikes.
- Module granularity and naming: one CodeMirror module (which cut?) or several smaller ones; the global's name (`EvCodeMirror` fits the `ev` namespace rule, which the script section must not use).
