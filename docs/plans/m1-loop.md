# M1 "Loop" Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven-development (recommended) or executing-plans to implement this plan task by task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A desktop host that opens a conforming EverythingApp document in a sandboxed window, lets the user edit it, and saves the data back into the same file safely: open → edit → save in place.

**Architecture:** An Electron app in `doc-host/`. Pure Node modules (frame, splice, conformance, write, watch) carry the rules and are unit-tested with the built-in test runner. The kit (browser JavaScript inside every document) mirrors the frame and is tested in jsdom. A thin Electron layer serves each document from memory under `ev-doc://<random-id>/` in its own in-memory session, exposes the data-only `window.evHost` through a preload, and owns every file write. Two end-to-end checks run the real app: `npm run probe` (sandbox escape attempts) and `npm run smoke` (save loop and external changes).

**Tech Stack:** Node.js ≥ 22 (tested on 25.9), Electron ≥ 35 (tested on 44.5.1), jsdom 30 (tests only), CommonJS, `node:test`.

**Source of truth:** [firstSpec.md](../../firstSpec.md) (product spec, decisions) and [docs/reference/glossary.md](../reference/glossary.md). Every piece of code in this plan was run and passed before the plan was written: 69 unit tests, 12 sandbox probes, the save smoke test.

## Global Constraints

- Repository root is `EverythingApp/`; the host lives in `doc-host/`. Run every command from `doc-host/` unless a step says otherwise.
- CommonJS with `'use strict';` in every file. No runtime dependencies. Dev dependencies: `electron`, `jsdom` only.
- LF line endings everywhere. `.gitattributes` (`* text=auto eol=lf`) already enforces this in Git; configure your editor the same way.
- Every name defined by the specification starts with `ev` (`ev-` for meta names and ids, `ev` for JS globals).
- The frame text is fixed. `src/frame.js` and the kit's `buildDocument` must stay byte-identical; `test/kit.test.js` guards this.
- Published kit files never change. A changed kit is a new file `kit/ev-kit-<version>.js` pinned with `tools/pin-kit.js`.
- The host writes nothing next to a document except the short-lived `<name>.tmp`. Versions go to `<userData>/versions/<sha256(path)[0..32]>/` and keep the newest 20 saves plus the newest save of each of the last 30 days.
- Size limits: data 50 MB, document file 60 MB.
- UI text is English.
- Manual checks use `/tmp` and macOS paths; on Windows use `%TEMP%` and the equivalent Explorer actions.
- If Electron starts as plain Node (prints a Node version, or `app` is undefined), `ELECTRON_RUN_AS_NODE=1` is set in your terminal (VS Code does this). Always start Electron through `npm start`, `npm run probe` or `npm run smoke`; `tools/start.js` clears the variable.
- Commit messages end with:

  ```
  Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
  ```

## File structure

```
doc-host/
  package.json
  src/
    frame.js            # the frame: build and parse documents (pure)
    splice.js           # replace the data block, keep every other byte (pure)
    conformance.js      # check a file against the specification, format the report (pure)
    validate.js         # check a data snapshot from a document (pure)
    write.js            # version store + atomic write (Node fs)
    watch.js            # section hashes, change classification, file watcher (Node fs)
    urls.js             # ev-doc:// URL rules (pure)
    argv.js             # file paths from a command line (pure)
    registry.js         # open documents by sender, window, path
    protocol.js         # ev-doc:// scheme and handler, CSP (Electron)
    security.js         # session and web contents lockdown (Electron)
    preload.js          # window.evHost (API v1) + file drops (Electron, sandboxed)
    ipc.js              # route preload messages to documents (Electron)
    document-window.js  # one open document: window, view, save, dirty, close, external changes (Electron)
    open.js             # open a path: conformance, refusal dialog, focus if open (Electron)
    menu.js             # application menu (Electron)
    probe.js            # test support for npm run probe (Electron)
    main.js             # app lifecycle and open sources (Electron)
  kit/
    ev-kit-1.0.0.js     # published kit (browser JavaScript inside every document)
    published.json      # pinned hashes of published kits (generated)
    index.js            # kit registry: find, current, hashes
  tools/
    pin-kit.js          # publish a kit version (pin its hash)
    assemble.js         # build a document from meta.json, style.css, script.js, data.json
    start.js            # start Electron (clears ELECTRON_RUN_AS_NODE; --probe, --smoke)
    smoke.js            # end-to-end save test (Electron main script)
  fixtures/
    src/hours-sheet/    # sources of the hours sheet (reference example)
    src/escape-probe/   # sources of the sandbox probe document
    hours-sheet.ev.html # assembled
    escape-probe.ev.html
  test/
    helpers.js
    *.test.js
docs/
  document-spec.md      # Document specification v1 (normative)
```

---

### Task 1: Host package and the frame

The frame is the fixed skeleton every document shares. `buildDocument(parts)` and `parseDocument(html)` are exact inverses for conforming documents; the rest of the host is built on them.

**Files:**
- Create: `doc-host/package.json`
- Create: `doc-host/src/frame.js`
- Test: `doc-host/test/frame.test.js`

**Interfaces:**
- Produces: `FRAME: string[]` (even entries literal text, odd entries slot names `lang, api, docType, docTypeVersion, title, style, data, kitVersion, kit, script`); `buildDocument(parts: Record<slot, string>) => string`; `parseDocument(html: string) => { ok: true, parts } | { ok: false, offset: number, expected: string }` where `expected` is the frame text that should start at `offset`; `lineOf(text: string, offset: number) => number` (1-based).

- [ ] **Step 1: Create the package**

From the repository root:

```bash
mkdir -p doc-host/src doc-host/test doc-host/kit doc-host/tools doc-host/fixtures
```

Create `doc-host/package.json`:

```json
{
  "name": "everythingapp-host",
  "productName": "EverythingApp",
  "version": "0.1.0",
  "private": true,
  "main": "src/main.js",
  "scripts": {
    "test": "node --test \"test/**/*.test.js\"",
    "start": "node tools/start.js",
    "probe": "node tools/start.js --probe fixtures/escape-probe.ev.html",
    "assemble": "node tools/assemble.js",
    "smoke": "node tools/start.js --smoke"
  },
  "devDependencies": {
    "electron": "^44.5.1",
    "jsdom": "^30.1.2"
  }
}
```

Then install the dev dependencies:

```bash
cd doc-host
npm install
```

Expected: `added … packages`, and `node_modules/` (already ignored by the root `.gitignore`).

- [ ] **Step 2: Write the failing test**

Create `doc-host/test/frame.test.js`:

```js
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { buildDocument, parseDocument, lineOf } = require('../src/frame');

const PARTS = {
  lang: 'en', api: '1', docType: 'demo', docTypeVersion: '1.0', title: 'Demo',
  style: '\nbody{}\n', data: '{"a":1}', kitVersion: '9.9.9', kit: '\n/* kit */\n', script: '\n/* script */\n',
};

test('buildDocument produces the exact frame', () => {
  assert.equal(buildDocument(PARTS), [
    '<!DOCTYPE html>',
    '<html lang="en">',
    '<head>',
    '  <meta charset="utf-8">',
    '  <meta name="ev-host-api" content="1">',
    '  <meta name="ev-doc-type" content="demo" data-version="1.0">',
    '  <title>Demo</title>',
    '  <style id="ev-style">',
    'body{}',
    '</style>',
    '</head>',
    '<body>',
    '  <div id="ev-app"></div>',
    '  <script type="application/json" id="ev-data">{"a":1}</script>',
    '  <script id="ev-kit" data-kit-version="9.9.9">',
    '/* kit */',
    '</script>',
    '  <script id="ev-script">',
    '/* script */',
    '</script>',
    '</body>',
    '</html>',
    '',
  ].join('\n'));
});

test('parseDocument returns the parts of a built document', () => {
  const result = parseDocument(buildDocument(PARTS));
  assert.equal(result.ok, true);
  assert.deepEqual(result.parts, PARTS);
});

test('parseDocument reports the offset of the first difference', () => {
  const html = buildDocument(PARTS).replace('<head>\n', '<head>\n  <meta name="viewport" content="x">\n');
  const result = parseDocument(html);
  assert.equal(result.ok, false);
  assert.equal(lineOf(html, result.offset), 4);
  assert.match(html.slice(result.offset), /^name="viewport"/);
});

test('a section cannot contain its closing tag, in any letter case', () => {
  const html = buildDocument({ ...PARTS, script: '\nconst s = "</SCRIPT>";\n' });
  assert.equal(parseDocument(html).ok, false);
});

test('trailing content after </html> is rejected', () => {
  assert.equal(parseDocument(buildDocument(PARTS) + '<!-- extra -->\n').ok, false);
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `node --test test/frame.test.js`
Expected: FAIL with `Cannot find module '../src/frame'`.

- [ ] **Step 4: Implement the frame**

Create `doc-host/src/frame.js`:

```js
'use strict';

// The document frame of the EverythingApp document specification (API v1).
// Even entries are literal text, odd entries are slot names. Every conforming
// document is exactly buildDocument(parts) for some parts. The kit
// (kit/ev-kit-*.js) builds the same text in the browser; test/kit.test.js
// keeps the two in sync.
const FRAME = [
  '<!DOCTYPE html>\n<html lang="', 'lang',
  '">\n<head>\n  <meta charset="utf-8">\n  <meta name="ev-host-api" content="', 'api',
  '">\n  <meta name="ev-doc-type" content="', 'docType',
  '" data-version="', 'docTypeVersion',
  '">\n  <title>', 'title',
  '</title>\n  <style id="ev-style">', 'style',
  '</style>\n</head>\n<body>\n  <div id="ev-app"></div>\n  <script type="application/json" id="ev-data">', 'data',
  '</script>\n  <script id="ev-kit" data-kit-version="', 'kitVersion',
  '">', 'kit',
  '</script>\n  <script id="ev-script">', 'script',
  '</script>\n</body>\n</html>\n',
];

// Where each slot's content ends. Attribute slots end at the closing quote,
// the title at the next tag, sections at their closing tag (browsers end
// <style> and <script> elements case-insensitively).
const SLOT_END = {
  lang: /"/g,
  api: /"/g,
  docType: /"/g,
  docTypeVersion: /"/g,
  title: /</g,
  style: /<\/style/gi,
  data: /<\/script/gi,
  kitVersion: /"/g,
  kit: /<\/script/gi,
  script: /<\/script/gi,
};

function buildDocument(parts) {
  return FRAME.map((piece, i) => (i % 2 === 1 ? parts[piece] : piece)).join('');
}

// Returns { ok: true, parts } or { ok: false, offset, expected }, where
// expected is the frame text that should have started at offset.
function parseDocument(html) {
  const parts = {};
  let pos = 0;
  for (let i = 0; i < FRAME.length; i += 2) {
    const literal = FRAME[i];
    if (!html.startsWith(literal, pos)) {
      const offset = firstMismatch(html, literal, pos);
      return { ok: false, offset, expected: literal.slice(offset - pos) };
    }
    pos += literal.length;
    const slot = FRAME[i + 1];
    if (slot === undefined) break;
    const end = SLOT_END[slot];
    end.lastIndex = pos;
    const match = end.exec(html);
    if (!match) return { ok: false, offset: html.length, expected: FRAME[i + 2] };
    parts[slot] = html.slice(pos, match.index);
    pos = match.index;
  }
  if (pos !== html.length) return { ok: false, offset: pos, expected: '(end of file)' };
  return { ok: true, parts };
}

function firstMismatch(html, literal, pos) {
  let k = 0;
  while (k < literal.length && html[pos + k] === literal[k]) k++;
  return pos + k;
}

function lineOf(text, offset) {
  let line = 1;
  for (let i = 0; i < offset && i < text.length; i++) if (text[i] === '\n') line++;
  return line;
}

module.exports = { FRAME, buildDocument, parseDocument, lineOf };
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `node --test test/frame.test.js`
Expected: `ℹ pass 5`, `ℹ fail 0`.

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json src/frame.js test/frame.test.js
git commit -m "feat(host): package scaffold and document frame

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Kit 1.0.0 and the data splice

The host writes data with `splice`; a browser writes data with the kit's fallback. Both must produce the same bytes. This task delivers both sides and the test that ties them together.

Watch out: the kit's own source contains frame tag text such as `<script type="application/json" id="ev-data">` (it builds the frame in the browser). Never locate parts of a document by searching for tag text; always go through `parseDocument`.

**Files:**
- Create: `doc-host/kit/ev-kit-1.0.0.js`
- Create: `doc-host/tools/pin-kit.js`
- Create: `doc-host/kit/published.json` (generated by `tools/pin-kit.js`)
- Create: `doc-host/kit/index.js`
- Create: `doc-host/src/splice.js`
- Create: `doc-host/test/helpers.js`
- Test: `doc-host/test/splice.test.js`, `doc-host/test/kit.test.js`

**Interfaces:**
- Consumes: `buildDocument`, `parseDocument` (Task 1).
- Produces:
  - `kit/index.js`: `KITS: { version, api, text, hash }[]` (`text` is the kit **section** text: `'\n'` + file content); `MAX_API_VERSION: number`; `findKit(version: string) => kit | null`; `currentKit(api?: number) => kit`; `kitSectionText(file: string) => string`; `sha256(text: string) => string` (hex).
  - `src/splice.js`: `escapeJson(json: string) => string`; `splice(html: string, json: string) => string` (throws `TypeError` for non-strings, `SyntaxError` for invalid JSON, `Error('The file does not match the document frame.')`).
  - `test/helpers.js`: `SAMPLE_DATA`, `makeParts(overrides?) => parts`, `makeDocument(overrides?) => string`. The default test document's script is `window.testDoc = EvKit.init();`.
  - Browser: `window.EvKit = { version: '1.0.0', init(options?) }`; `init` returns frozen `{ data, hosted, changed(), save(), toHtml() }` (see `docs/document-spec.md` §5, written in Task 4).

- [ ] **Step 1: Write the kit**

Create `doc-host/kit/ev-kit-1.0.0.js` exactly as below. Every character counts: the file is pinned by hash in the next step, and every document will carry this text.

```js
/* EverythingApp kit 1.0.0 (host API v1). Part of the document frame:
   the host checks this exact text by hash. Do not edit it in a document. */
(function () {
  'use strict';

  var KIT_VERSION = '1.0.0';
  var kitText = document.currentScript.textContent;
  var styleText = document.getElementById('ev-style').textContent;
  var docTypeMeta = document.querySelector('meta[name="ev-doc-type"]');
  var frame = {
    lang: document.documentElement.getAttribute('lang'),
    api: document.querySelector('meta[name="ev-host-api"]').getAttribute('content'),
    docType: docTypeMeta.getAttribute('content'),
    docTypeVersion: docTypeMeta.getAttribute('data-version'),
    title: document.querySelector('head > title').textContent
  };
  var initialized = false;

  function escapeJson(json) {
    return json.replace(/</g, '\\u003c');
  }

  // Must produce exactly the frame of doc-host/src/frame.js.
  function buildDocument(p) {
    return '<!DOCTYPE html>\n<html lang="' + p.lang + '">\n<head>\n' +
      '  <meta charset="utf-8">\n' +
      '  <meta name="ev-host-api" content="' + p.api + '">\n' +
      '  <meta name="ev-doc-type" content="' + p.docType + '" data-version="' + p.docTypeVersion + '">\n' +
      '  <title>' + p.title + '</title>\n' +
      '  <style id="ev-style">' + p.style + '</style>\n' +
      '</head>\n<body>\n' +
      '  <div id="ev-app"></div>\n' +
      '  <script type="application/json" id="ev-data">' + p.data + '<\/script>\n' +
      '  <script id="ev-kit" data-kit-version="' + p.kitVersion + '">' + p.kit + '<\/script>\n' +
      '  <script id="ev-script">' + p.script + '<\/script>\n' +
      '</body>\n</html>\n';
  }

  // ---------- Browser fallback: save a new copy of this file ----------

  var DB_NAME = 'ev-kit-handles';
  var STORE = 'handles';
  var fileHandle = null;

  function openDb() {
    return new Promise(function (resolve, reject) {
      var req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = function () { req.result.createObjectStore(STORE); };
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error); };
    });
  }

  function loadHandle() {
    return openDb().then(function (db) {
      return new Promise(function (resolve, reject) {
        var q = db.transaction(STORE).objectStore(STORE).get(location.href);
        q.onsuccess = function () { resolve(q.result || null); };
        q.onerror = function () { reject(q.error); };
      });
    }).catch(function () { return null; });
  }

  function storeHandle(handle) {
    return openDb().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(STORE, 'readwrite');
        tx.objectStore(STORE).put(handle, location.href);
        tx.oncomplete = resolve;
        tx.onerror = function () { reject(tx.error); };
      });
    }).catch(function () { /* not critical: the picker appears again next time */ });
  }

  function suggestedName() {
    var last = decodeURIComponent(location.pathname.split('/').pop() || '');
    return last || frame.docType + '.ev.html';
  }

  async function writeWithPicker(html) {
    if (!fileHandle) fileHandle = await loadHandle();
    if (fileHandle) {
      var perm = await fileHandle.queryPermission({ mode: 'readwrite' });
      if (perm !== 'granted') perm = await fileHandle.requestPermission({ mode: 'readwrite' });
      if (perm !== 'granted') fileHandle = null;
    }
    if (!fileHandle) {
      fileHandle = await window.showSaveFilePicker({
        suggestedName: suggestedName(),
        types: [{ description: 'EverythingApp document', accept: { 'text/html': ['.html'] } }]
      });
      await storeHandle(fileHandle);
    }
    var w = await fileHandle.createWritable();
    await w.write(html);
    await w.close();
  }

  function download(html) {
    var a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([html], { type: 'text/html' }));
    a.download = suggestedName();
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
  }

  async function fallbackSave(html) {
    try {
      if (window.showSaveFilePicker) await writeWithPicker(html);
      else download(html);
      return true;
    } catch (err) {
      if (err && err.name === 'AbortError') return false;
      fileHandle = null;
      alert('Saving failed: ' + (err && err.message ? err.message : err));
      return false;
    }
  }

  // ---------- Public interface ----------

  function init(options) {
    if (initialized) throw new Error('EvKit.init() may only be called once.');
    initialized = true;
    options = options || {};

    var scriptEl = document.getElementById('ev-script');
    var scriptText = scriptEl ? scriptEl.textContent : '';
    var data = JSON.parse(document.getElementById('ev-data').textContent || '{}');
    if (data === null || typeof data !== 'object' || Array.isArray(data)) data = {};
    var getData = typeof options.getData === 'function' ? options.getData : function () { return data; };
    var onDirtyChange = typeof options.onDirtyChange === 'function' ? options.onDirtyChange : function () {};
    var host = window.evHost && window.evHost.version >= 1 ? window.evHost : null;
    var dirty = false;

    function serialize() {
      return JSON.stringify(getData());
    }

    function toHtml() {
      return buildDocument({
        lang: frame.lang, api: frame.api, docType: frame.docType,
        docTypeVersion: frame.docTypeVersion, title: frame.title,
        style: styleText, data: escapeJson(serialize()),
        kitVersion: KIT_VERSION, kit: kitText, script: scriptText
      });
    }

    function setDirty(value) {
      if (dirty === value) return;
      dirty = value;
      onDirtyChange(value);
    }

    function save() {
      if (host) return Promise.resolve(false);
      return fallbackSave(toHtml()).then(function (ok) {
        if (ok) setDirty(false);
        return ok;
      });
    }

    if (host) {
      // The host owns saving, the dirty marker and the close prompt.
      host.onSaveRequest(serialize);
    } else {
      window.addEventListener('keydown', function (e) {
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
          e.preventDefault();
          save();
        }
      });
      window.addEventListener('beforeunload', function (e) {
        if (dirty) { e.preventDefault(); e.returnValue = ''; }
      });
    }

    return Object.freeze({
      data: data,
      hosted: !!host,
      changed: function () {
        if (host) host.markDirty();
        else setDirty(true);
      },
      save: save,
      toHtml: toHtml
    });
  }

  Object.defineProperty(window, 'EvKit', {
    value: Object.freeze({ version: KIT_VERSION, init: init }),
    writable: false,
    configurable: false
  });
})();
```

- [ ] **Step 2: Write the publishing tool and pin the kit**

Create `doc-host/tools/pin-kit.js`:

```js
'use strict';

// Publishes a kit: node tools/pin-kit.js <version> <api>
// Adds the kit file's hash to kit/published.json. Run once per kit version.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const [version, api] = process.argv.slice(2);
if (!/^\d+\.\d+\.\d+$/.test(version || '') || !/^[1-9]\d*$/.test(api || '')) {
  console.error('Usage: node tools/pin-kit.js <version> <api>   e.g. 1.0.0 1');
  process.exit(1);
}
const kitDir = path.join(__dirname, '..', 'kit');
const file = `ev-kit-${version}.js`;
const text = '\n' + fs.readFileSync(path.join(kitDir, file), 'utf8');
if (text.includes('\r')) throw new Error(`${file} contains CR characters; use LF line endings.`);
if (/<\/script|<!--/i.test(text)) throw new Error(`${file} contains "</script" or "<!--"; escape it as "<\\/script".`);

const listPath = path.join(kitDir, 'published.json');
const list = fs.existsSync(listPath) ? JSON.parse(fs.readFileSync(listPath, 'utf8')) : [];
if (list.some((k) => k.version === version)) throw new Error(`Kit ${version} is already published.`);
const sha256 = crypto.createHash('sha256').update(text, 'utf8').digest('hex');
list.push({ version, api: Number(api), file, sha256 });
fs.writeFileSync(listPath, JSON.stringify(list, null, 2) + '\n');
console.log(`Published kit ${version} (API v${api}): ${sha256}`);
```

Run: `node tools/pin-kit.js 1.0.0 1`
Expected: `Published kit 1.0.0 (API v1): 4001f0446766ed308d5a7bec037a289609714f4c19a4b2e8a94e16088fc4cd89`

If your hash differs, your kit file differs from the plan (whitespace, quotes, a missing line). Delete `kit/published.json`, fix the file, and run the command again until the hash matches.

- [ ] **Step 3: Write the kit registry**

Create `doc-host/kit/index.js`:

```js
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

// Published kits never change. published.json pins each kit file's hash;
// loading fails loudly if a published kit file was edited.
const PUBLISHED = require('./published.json');

function sha256(text) {
  return crypto.createHash('sha256').update(text, 'utf8').digest('hex');
}

// The kit section of a document is a newline followed by the kit file.
function kitSectionText(file) {
  return '\n' + fs.readFileSync(path.join(__dirname, file), 'utf8');
}

const KITS = PUBLISHED.map((entry) => {
  const text = kitSectionText(entry.file);
  const hash = sha256(text);
  if (hash !== entry.sha256) {
    throw new Error(`Published kit ${entry.version} was modified (${entry.file}). Publish a new kit version instead.`);
  }
  return Object.freeze({ version: entry.version, api: entry.api, text, hash });
});

const MAX_API_VERSION = Math.max(...KITS.map((k) => k.api));

function findKit(version) {
  return KITS.find((k) => k.version === version) || null;
}

function currentKit(api = MAX_API_VERSION) {
  const kits = KITS.filter((k) => k.api === api);
  return kits[kits.length - 1];
}

module.exports = { KITS, MAX_API_VERSION, findKit, currentKit, kitSectionText, sha256 };
```

- [ ] **Step 4: Write the test helpers and the failing tests**

Create `doc-host/test/helpers.js`:

```js
'use strict';

const { buildDocument } = require('../src/frame');
const { escapeJson } = require('../src/splice');
const { currentKit } = require('../kit');

const SAMPLE_DATA = { rows: [{ note: 'a<b', price: '$&' }] };

// Parts of a small, valid test document. Override any slot.
function makeParts(overrides = {}) {
  const kit = currentKit();
  return {
    lang: 'en',
    api: '1',
    docType: 'test-doc',
    docTypeVersion: '1.0',
    title: 'Test document',
    style: '\nbody { margin: 0; }\n',
    data: escapeJson(JSON.stringify(SAMPLE_DATA)),
    kitVersion: kit.version,
    kit: kit.text,
    script: '\nwindow.testDoc = EvKit.init();\n',
    ...overrides,
  };
}

function makeDocument(overrides) {
  return buildDocument(makeParts(overrides));
}

module.exports = { SAMPLE_DATA, makeParts, makeDocument };
```

Create `doc-host/test/splice.test.js`:

```js
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { escapeJson, splice } = require('../src/splice');
const { makeDocument } = require('./helpers');

test('escapeJson writes every < as \\u003c', () => {
  assert.equal(escapeJson('{"a":"</script><b>"}'), '{"a":"\\u003c/script>\\u003cb>"}');
});

test('splice replaces only the data block', () => {
  const html = makeDocument();
  const out = splice(html, '{"rows":[]}');
  const start = html.indexOf('id="ev-data">') + 'id="ev-data">'.length;
  assert.equal(out.slice(0, start), html.slice(0, start));
  assert.ok(out.endsWith(html.slice(html.indexOf('</script>', start))));
  assert.ok(out.includes('id="ev-data">{"rows":[]}</script>'));
});

test('splice escapes < in the data', () => {
  const out = splice(makeDocument(), '{"x":"</script><!--"}');
  assert.ok(out.includes('{"x":"\\u003c/script>\\u003c!--"}'));
});

test('splice keeps $ sequences literally', () => {
  const out = splice(makeDocument(), '{"x":"$& $1 $$ $`"}');
  assert.ok(out.includes('{"x":"$& $1 $$ $`"}'));
});

test('splice rejects invalid JSON and non-strings', () => {
  assert.throws(() => splice(makeDocument(), '{nope'), SyntaxError);
  assert.throws(() => splice(makeDocument(), { a: 1 }), TypeError);
});

test('splice rejects a file that does not match the frame', () => {
  const html = makeDocument();
  assert.throws(() => splice(html.replace('id="ev-data"', 'id="other"'), '{}'), /does not match the document frame/);
  const twice = html.replace('<div id="ev-app"></div>', '<script type="application/json" id="ev-data">{}</script>');
  assert.throws(() => splice(twice, '{}'), /does not match the document frame/);
});

test('splice finds the real data block although the kit source mentions its tag', () => {
  const html = makeDocument();
  assert.ok(html.split('id="ev-data">').length > 2, 'the kit contains the tag text');
  assert.ok(splice(html, '{"ok":1}').includes('<div id="ev-app"></div>\n  <script type="application/json" id="ev-data">{"ok":1}</script>'));
});
```

Create `doc-host/test/kit.test.js`:

```js
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');
const { parseDocument, buildDocument } = require('../src/frame');
const { splice } = require('../src/splice');
const { KITS, findKit } = require('../kit');
const { SAMPLE_DATA, makeDocument, makeParts } = require('./helpers');

// Loads a document in jsdom. Records which window listeners the document's
// scripts register (jsdom registers some of its own; those are ignored).
function load(html, { host } = {}) {
  const dom = new JSDOM(html, {
    runScripts: 'dangerously',
    url: 'https://example.test/sample.ev.html',
    beforeParse(window) {
      window.registered = [];
      const add = window.addEventListener.bind(window);
      window.addEventListener = (type, ...rest) => {
        if (window.document.currentScript) window.registered.push(type);
        return add(type, ...rest);
      };
      if (host) window.evHost = host;
    },
  });
  return dom.window;
}

function fakeHost() {
  return {
    version: 1,
    handler: null,
    dirtyCalls: 0,
    onSaveRequest(fn) { this.handler = fn; },
    markDirty() { this.dirtyCalls++; },
  };
}

test('published kits are LF-only and never contain </script or <!--', () => {
  for (const kit of KITS) {
    assert.ok(!kit.text.includes('\r'), kit.version);
    assert.ok(!/<\/script|<!--/i.test(kit.text), kit.version);
  }
  assert.ok(findKit('1.0.0'));
});

test('toHtml() reproduces the original file when nothing changed', () => {
  const html = makeDocument();
  const window = load(html);
  assert.equal(window.testDoc.toHtml(), html);
});

test('toHtml() equals a host save of the same data, byte for byte', () => {
  const html = makeDocument();
  const window = load(html);
  window.testDoc.data.rows.push({ note: 'new </script> row', hours: 2 });
  const json = JSON.stringify(window.testDoc.data);
  assert.equal(window.testDoc.toHtml(), splice(html, json));
});

test('toHtml() keeps the frame even when the script changes the DOM', () => {
  const script = '\nwindow.testDoc = EvKit.init();\ndocument.title = "changed";\ndocument.body.className = "x";\n' +
    'document.getElementById("ev-app").textContent = "rendered";\n';
  const html = makeDocument({ script });
  const window = load(html);
  assert.equal(window.testDoc.toHtml(), html);
  assert.deepEqual(parseDocument(window.testDoc.toHtml()).parts, makeParts({ script }));
});

test('doc.data is the parsed data block', () => {
  const window = load(makeDocument());
  assert.equal(JSON.stringify(window.testDoc.data), JSON.stringify(SAMPLE_DATA));
});

test('without a host: fallback mode with key binding, unload guard and dirty callback', () => {
  const script = '\nwindow.dirtyLog = [];\nwindow.testDoc = EvKit.init({ onDirtyChange: (d) => window.dirtyLog.push(d) });\n';
  const window = load(makeDocument({ script }));
  assert.equal(window.testDoc.hosted, false);
  assert.ok(window.registered.includes('keydown'));
  assert.ok(window.registered.includes('beforeunload'));
  window.testDoc.changed();
  window.testDoc.changed();
  assert.deepEqual(Array.from(window.dirtyLog), [true]);
});

test('with a host: no key binding, no unload guard; changes and saves go through evHost', () => {
  const host = fakeHost();
  const window = load(makeDocument(), { host });
  assert.equal(window.testDoc.hosted, true);
  assert.ok(!window.registered.includes('keydown'));
  assert.ok(!window.registered.includes('beforeunload'));
  window.testDoc.changed();
  assert.equal(host.dirtyCalls, 1);
  window.testDoc.data.rows = [];
  assert.equal(host.handler(), '{"rows":[]}');
});

test('getData option replaces the data source', () => {
  const host = fakeHost();
  const script = '\nwindow.testDoc = EvKit.init({ getData: () => ({ replaced: true }) });\n';
  load(makeDocument({ script }), { host });
  assert.equal(host.handler(), '{"replaced":true}');
});

test('init() may only be called once and EvKit cannot be replaced', () => {
  const window = load(makeDocument());
  assert.throws(() => window.EvKit.init(), /only be called once/);
  assert.throws(() => { window.EvKit = null; }, TypeError);
  assert.equal(typeof window.EvKit.init, 'function');
});

test('the kit builds the same frame as frame.js', () => {
  const parts = makeParts({ title: 'Ünïcode – title', lang: 'de-CH' });
  const window = load(buildDocument(parts));
  assert.equal(window.testDoc.toHtml(), buildDocument(parts));
});
```

- [ ] **Step 5: Run the tests to verify they fail**

Run: `node --test test/splice.test.js test/kit.test.js`
Expected: FAIL with `Cannot find module '../src/splice'`.

- [ ] **Step 6: Implement the splice**

Create `doc-host/src/splice.js`:

```js
'use strict';

const { parseDocument, buildDocument } = require('./frame');

// Every "<" becomes <, so the data can never close its script element.
function escapeJson(json) {
  return json.replace(/</g, '\\u003c');
}

// Replaces the content of the data block and keeps every other byte.
// The data block is located through the frame, not by searching for its
// tag: the kit's source contains that tag text too. No regex replacement
// is involved, so "$" in the data stays literal.
function splice(html, json) {
  if (typeof json !== 'string') throw new TypeError('The data must be a JSON string.');
  JSON.parse(json);
  const frame = parseDocument(html);
  if (!frame.ok) throw new Error('The file does not match the document frame.');
  return buildDocument({ ...frame.parts, data: escapeJson(json) });
}

module.exports = { escapeJson, splice };
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `npm test`
Expected: `ℹ pass 22`, `ℹ fail 0` (frame 5, splice 7, kit 10).

- [ ] **Step 8: Commit**

```bash
git add kit tools/pin-kit.js src/splice.js test/helpers.js test/splice.test.js test/kit.test.js
git commit -m "feat(host): kit 1.0.0 and data splice with byte-identical saves

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Conformance check

The host refuses every file that breaks the specification and explains why, precisely enough that an agent can repair the file from the report.

**Files:**
- Create: `doc-host/src/conformance.js`
- Test: `doc-host/test/conformance.test.js`

**Interfaces:**
- Consumes: `parseDocument`, `lineOf` (Task 1); `findKit`, `sha256`, `MAX_API_VERSION` (Task 2).
- Produces: `isDocument(text: string) => boolean` (true if and only if the text contains `<meta name="ev-host-api"`); `checkDocument(html: string) => { ok: boolean, errors: { code, message, line? }[], parts?, api? }`; `formatReport(filePath: string, errors) => string`. Error codes: `bom, line-endings, api-missing, api-invalid, api-newer, frame, field, kit-unknown, kit-modified, kit-api, data-escape, data-json, data-shape, script-comment`. For `api-newer` the result contains only that error.

- [ ] **Step 1: Write the failing test**

Create `doc-host/test/conformance.test.js`:

```js
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { isDocument, checkDocument, formatReport } = require('../src/conformance');
const { makeDocument, makeParts } = require('./helpers');

// The kit's source contains frame tags as text, so mutate the real tag,
// which is always the last occurrence.
function replaceLast(text, search, replacement) {
  const i = text.lastIndexOf(search);
  return text.slice(0, i) + replacement + text.slice(i + search.length);
}

function codes(html) {
  return checkDocument(html).errors.map((e) => e.code);
}

test('a valid document passes and returns its parts', () => {
  const result = checkDocument(makeDocument());
  assert.equal(result.ok, true);
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.parts, makeParts());
  assert.equal(result.api, 1);
});

test('isDocument looks for the ev-host-api meta tag only', () => {
  assert.equal(isDocument(makeDocument()), true);
  assert.equal(isDocument('<!DOCTYPE html><html><body>hello</body></html>'), false);
});

// Each case breaks one rule of the specification.
const INVALID = [
  ['bom', () => '\ufeff' + makeDocument()],
  ['line-endings', () => makeDocument().replace(/\n/g, '\r\n')],
  ['api-missing', () => makeDocument().replace('<meta name="ev-host-api" content="1">', '')],
  ['api-invalid', () => makeDocument({ api: 'one' })],
  ['frame', () => makeDocument().replace('<head>\n', '<head>\n  <meta name="viewport" content="width=device-width">\n')],
  ['frame', () => replaceLast(makeDocument(), '</body>', '<!-- note -->\n</body>')],
  ['frame', () => makeDocument().replace('<div id="ev-app"></div>', '<div id="ev-app">rendered</div>')],
  ['frame', () => makeDocument({ style: '\n</style><style>\n' })],
  ['frame', () => replaceLast(makeDocument(), 'id="ev-script"', 'id="script"')],
  ['field', () => makeDocument({ title: 'Tom &amp; Jerry' })],
  ['field', () => makeDocument({ docType: 'Hours Sheet' })],
  ['kit-unknown', () => makeDocument({ kitVersion: '0.0.1' })],
  ['kit-modified', () => makeDocument({ kit: makeParts().kit.replace('use strict', 'use  strict') })],
  ['data-escape', () => makeDocument({ data: '{"a":"<b>"}' })],
  ['data-json', () => makeDocument({ data: '{"a":' })],
  ['data-shape', () => makeDocument({ data: '[1,2,3]' })],
  ['script-comment', () => makeDocument({ script: '\nconst s = "<!--";\n' })],
];

for (const [code, make] of INVALID) {
  test(`refuses: ${code} (${make.toString().slice(6, 70)}…)`, () => {
    const result = checkDocument(make());
    assert.equal(result.ok, false);
    assert.ok(codes(make()).includes(code), `expected ${code}, got ${codes(make())}`);
  });
}

test('a newer API version is refused with the update message only', () => {
  const result = checkDocument(makeDocument({ api: '2' }));
  assert.equal(result.ok, false);
  assert.deepEqual(result.errors.map((e) => e.code), ['api-newer']);
  assert.match(result.errors[0].message, /needs a newer EverythingApp \(API v2\)\. Update the host, or open it in Chrome\./);
});

test('CRLF files still get their other problems reported', () => {
  const html = makeDocument({ data: '[1]' }).replace(/\n/g, '\r\n');
  assert.deepEqual(codes(html), ['line-endings', 'data-shape']);
});

test('frame errors point at the line and show expected and found text', () => {
  const html = makeDocument().replace('<head>\n', '<head>\n  <meta name="viewport" content="x">\n');
  const [error] = checkDocument(html).errors;
  assert.equal(error.line, 4);
  assert.match(error.message, /expected "charset=\\"utf-8\\">" but found "name=\\"viewport\\"/);
});

test('formatReport lists every problem and mentions Chrome', () => {
  const report = formatReport('/tmp/hours.ev.html', [
    { code: 'frame', message: 'Broken.', line: 3 },
    { code: 'data-json', message: 'Bad JSON.' },
  ]);
  assert.match(report, /could not open hours\.ev\.html/);
  assert.match(report, /- \[frame\] line 3: Broken\./);
  assert.match(report, /- \[data-json\] Bad JSON\./);
  assert.match(report, /open the file in Chrome/);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test test/conformance.test.js`
Expected: FAIL with `Cannot find module '../src/conformance'`.

- [ ] **Step 3: Implement the check**

Create `doc-host/src/conformance.js`:

```js
'use strict';

const path = require('node:path');
const { parseDocument, lineOf } = require('./frame');
const { findKit, sha256, MAX_API_VERSION } = require('../kit');

// The value may not contain quotes, so the kit's own source (which builds
// this tag from string pieces) never matches.
const API_META = /<meta name="ev-host-api" content="([^"']*)">/;

const FIELD_RULES = {
  lang: [/^[A-Za-z]{2,3}(-[A-Za-z0-9]+)*$/, 'a language tag such as "en" or "de-CH"'],
  docType: [/^[a-z0-9]+(-[a-z0-9]+)*$/, 'lowercase words joined by "-", such as "hours-sheet"'],
  docTypeVersion: [/^\d+(\.\d+)*$/, 'a version such as "1.0"'],
  title: [/^[^<&\n]*$/, 'plain text without "<", "&" or line breaks'],
  kitVersion: [/^\d+\.\d+\.\d+$/, 'a kit version such as "1.0.0"'],
};

// A file is a document if and only if it contains the ev-host-api meta tag.
function isDocument(text) {
  return /<meta name="ev-host-api"/.test(text);
}

function problem(code, message, line) {
  return line ? { code, message, line } : { code, message };
}

function preview(text) {
  const firstLine = text.split('\n')[0];
  return JSON.stringify(firstLine.length > 60 ? firstLine.slice(0, 60) + '…' : firstLine);
}

// Checks a file against the document specification.
// Returns { ok, errors: [{ code, message, line? }], parts?, api? }.
function checkDocument(html) {
  const errors = [];

  if (html.charCodeAt(0) === 0xfeff) {
    errors.push(problem('bom', 'The file starts with a byte order mark. Save it as UTF-8 without BOM.', 1));
  }
  const cr = html.indexOf('\r');
  if (cr >= 0) {
    errors.push(problem('line-endings', 'The file contains CR characters. Documents use LF line endings only.', lineOf(html, cr)));
  }

  const apiMatch = API_META.exec(html);
  if (!apiMatch) {
    errors.push(problem('api-missing', 'The <meta name="ev-host-api"> tag is missing.'));
  } else if (!/^[1-9]\d*$/.test(apiMatch[1])) {
    errors.push(problem('api-invalid', `ev-host-api must be a positive whole number, found "${apiMatch[1]}".`));
  } else if (Number(apiMatch[1]) > MAX_API_VERSION) {
    return {
      ok: false,
      errors: [problem('api-newer',
        `This document needs a newer EverythingApp (API v${apiMatch[1]}). Update the host, or open it in Chrome.`)],
    };
  }

  // Keep checking a normalised copy, so one BOM or CRLF problem does not hide the rest.
  const text = html.replace(/^\ufeff/, '').replace(/\r\n?/g, '\n');
  const frame = parseDocument(text);
  if (!frame.ok) {
    errors.push(problem('frame',
      `The file does not match the document frame: expected ${preview(frame.expected)} ` +
      `but found ${preview(text.slice(frame.offset))}.`, lineOf(text, frame.offset)));
    return { ok: false, errors };
  }
  const parts = frame.parts;

  for (const [field, [rule, description]] of Object.entries(FIELD_RULES)) {
    if (!rule.test(parts[field])) {
      errors.push(problem('field', `The ${field} value ${JSON.stringify(parts[field])} is not ${description}.`));
    }
  }

  const kit = findKit(parts.kitVersion);
  if (!kit) {
    errors.push(problem('kit-unknown', `Kit ${parts.kitVersion} is not a published kit.`));
  } else if (sha256(parts.kit) !== kit.hash) {
    errors.push(problem('kit-modified', `The kit section was modified. It must be the exact text of published kit ${kit.version}.`));
  } else if (String(kit.api) !== parts.api) {
    errors.push(problem('kit-api', `Kit ${kit.version} belongs to API v${kit.api}, but the document declares API v${parts.api}.`));
  }

  if (parts.data.includes('<')) {
    errors.push(problem('data-escape', 'The data block contains "<". Write every "<" in the data as \\u003c.'));
  }
  let data;
  try {
    data = JSON.parse(parts.data);
  } catch (err) {
    errors.push(problem('data-json', `The data block is not valid JSON: ${err.message}`));
  }
  if (data !== undefined && (data === null || typeof data !== 'object' || Array.isArray(data))) {
    errors.push(problem('data-shape', 'The data block must contain a JSON object.'));
  }

  if (parts.script.includes('<!--')) {
    errors.push(problem('script-comment', 'The script section contains "<!--", which changes how browsers parse it. Write "<\\!--" instead.'));
  }

  return { ok: errors.length === 0, errors, parts, api: Number(parts.api) };
}

// The text shown in the refusal dialog and copied by "Copy report".
function formatReport(filePath, errors) {
  const lines = [
    `EverythingApp could not open ${path.basename(filePath)}.`,
    `File: ${filePath}`,
    '',
    'The file does not follow the EverythingApp document specification:',
    ...errors.map((e) => `- [${e.code}]${e.line ? ` line ${e.line}:` : ''} ${e.message}`),
    '',
    'You can still open the file in Chrome, where it saves through the browser fallback.',
  ];
  return lines.join('\n');
}

module.exports = { isDocument, checkDocument, formatReport };
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test`
Expected: `ℹ pass 45`, `ℹ fail 0`.

- [ ] **Step 5: Commit**

```bash
git add src/conformance.js test/conformance.test.js
git commit -m "feat(host): conformance check with copyable report

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Document specification v1

The normative contract for whoever writes documents, written now that the frame, kit and conformance rules exist in code. It also takes over two facts from the product spec's "To document" table.

**Files:**
- Create: `docs/document-spec.md` (repository root, not `doc-host/`)
- Modify: `firstSpec.md` (section "To document")

**Interfaces:**
- Consumes: the frame (Task 1), kit interface (Task 2), error codes (Task 3). The document must match them exactly; if code and document disagree, the code is right and the document gets fixed.

- [ ] **Step 1: Write the specification**

Create `docs/document-spec.md`:

````markdown
# EverythingApp document specification v1

Status: normative · Host API v1 · Kit 1.0.0

This specification defines what an EverythingApp document is and how it talks to the host. It is the contract for everyone who writes documents: people, Claude, and the future skill. A document works with EverythingApp exactly when it follows this specification. Terms are defined in the [glossary](reference/glossary.md).

## 1. What a document is

A document is a single HTML file that carries its own data and renders its own editor. It consists of a fixed **frame** and three **sections**:

| Section | Element | Written by | Contains |
| --- | --- | --- | --- |
| Style | `<style id="ev-style">` | Generator or agent | All CSS |
| Data | `<script type="application/json" id="ev-data">` | Host (and the browser fallback) | The data block: one JSON object |
| Script | `<script id="ev-script">` | Generator or agent | All JavaScript; renders the UI into `#ev-app` |

The frame also contains the **kit** (`<script id="ev-kit">`), a script published with this specification. The kit loads the data, connects to the host and implements the browser fallback. Documents use it and never change it.

**Behaviour** is the style and script sections together. Behaviour is cheap to replace; the data block is what the user cares about.

## 2. The frame

Every document is exactly this text, with the `{placeholders}` filled in. Nothing may be added, removed or reformatted: no extra elements, attributes, comments, whitespace or line breaks outside the placeholders.

```text
<!DOCTYPE html>
<html lang="{lang}">
<head>
  <meta charset="utf-8">
  <meta name="ev-host-api" content="{api}">
  <meta name="ev-doc-type" content="{docType}" data-version="{docTypeVersion}">
  <title>{title}</title>
  <style id="ev-style">{style}</style>
</head>
<body>
  <div id="ev-app"></div>
  <script type="application/json" id="ev-data">{data}</script>
  <script id="ev-kit" data-kit-version="{kitVersion}">{kit}</script>
  <script id="ev-script">{script}</script>
</body>
</html>
```

The file ends with a single line break after `</html>`.

| Placeholder | Rule | Example |
| --- | --- | --- |
| `lang` | Language tag | `en`, `de-CH` |
| `api` | Host API version the document needs; `1` for this specification | `1` |
| `docType` | Kind of document: lowercase words joined by `-` | `hours-sheet` |
| `docTypeVersion` | Version of this document type's behaviour | `1.0` |
| `title` | Plain text without `<`, `&` or line breaks | `Hours sheet` |
| `style` | CSS; must not contain `</style` | |
| `data` | The data block (section 4) | `{"rows":[]}` |
| `kitVersion` | Version of the published kit in `kit` | `1.0.0` |
| `kit` | The exact text of that published kit | |
| `script` | JavaScript; must not contain `</script` or `<!--` | |

## 3. Rules

1. **Namespace.** Every name defined by this specification starts with `ev`: `ev-` for meta names and element ids, `ev` for JavaScript globals (`window.evHost`, `EvKit`). The script section must not define names with this prefix.
2. **Self-contained.** No external scripts, stylesheets, fonts or images. Inline everything; embed assets as `data:` URIs. Inside the host, every network request is blocked.
3. **Runtime UI.** The script section renders all UI into `#ev-app` at load time. `#ev-app` is empty in the saved file.
4. **The host owns saving.** When `window.evHost` exists, the document shows no Save button and registers neither a Ctrl/Cmd+S handler nor `beforeunload`. The kit enforces this when you use it as described in section 5. *Why:* in Electron, a cancelled `beforeunload` silently stops the window from closing with no dialog, so a document that registers it would block the host's close prompt.
5. **UTF-8, LF only, no BOM.** *Why:* the HTML parser turns CRLF into LF inside `<style>` and `<script>`. The kit's fallback rebuilds the file from that parsed text, so a CRLF file would change bytes outside the data block on its first browser save.
6. **No storage between sessions.** Inside the host, `localStorage`, IndexedDB and cookies start empty on every open. View state (filters, scroll position) lasts one session. Anything that should survive belongs in the data block.
7. **No navigation, no new windows.** Links that navigate away, `window.open`, iframes and form submissions are blocked.

## 4. The data block

- Contains exactly one JSON **object** (not an array, not `null`).
- Every `<` is written as `<`, so data can never close its script element. `JSON.stringify` output followed by `.replace(/</g, '\\u003c')` satisfies this; the kit and the host do it for you.
- The shape of the object is up to the document type. Document it in a comment at the top of the script section, for example:

  ```js
  // Data shape: {"rows":[{"date":"YYYY-MM-DD","person":"","task":"","hours":0,"note":""}]}
  ```

- An empty document starts with an empty object or empty collections (e.g. `{"rows":[]}`) and must render usefully.

## 5. The kit interface (kit 1.0.0)

The kit runs before the script section and defines `window.EvKit`.

```js
const doc = EvKit.init({ onDirtyChange: (dirty) => showStatus(dirty) });
const data = doc.data;        // the parsed data block; change it in place
// … render into document.getElementById('ev-app') …
doc.changed();                // call after every change to data
```

`EvKit.init(options)` may be called exactly once. Options (all optional):

| Option | Type | Meaning |
| --- | --- | --- |
| `getData` | `() => object` | Returns the object to save. Default: `doc.data`. Use it if the script replaces the data object instead of changing it in place. |
| `onDirtyChange` | `(dirty: boolean) => void` | Called in the browser fallback when unsaved changes appear or are saved. Never called inside the host, because the host shows the dirty state itself. |

`init` returns a frozen object:

| Member | Meaning |
| --- | --- |
| `data` | The parsed data block. |
| `hosted` | `true` inside EverythingApp, `false` in a plain browser. Show your own Save button and status line only when `false`. |
| `changed()` | Reports a change to the data. Inside the host it marks the document dirty; in a browser it updates the fallback's dirty state. |
| `save()` | Browser only: saves through the fallback and returns a promise of `true` (saved) or `false` (cancelled or failed). Inside the host it does nothing and returns `false`. |
| `toHtml()` | The complete document text with the current data, exactly as a save would write it. |

In a browser, the kit also saves on Ctrl/Cmd+S and warns before leaving the page with unsaved changes.

## 6. Host API v1 (`window.evHost`)

Documents normally use the kit and never touch `evHost` directly. For reference:

| Member | Signature | Meaning |
| --- | --- | --- |
| `version` | `number` | `1` |
| `onSaveRequest` | `(handler: () => string) => void` | Registers the function the host calls when the user saves (menu, Ctrl/Cmd+S, close prompt). It returns the data as a JSON string. |
| `markDirty` | `() => void` | Signals that the data changed since the last save. |

The host decides when to save. The document never starts a write, never sees its file path and can never write its own behaviour. The API is data-only in every version.

## 7. Browser fallback

Outside the host, the kit saves a new copy of the whole file. It rebuilds the file from the frame, the original section texts and the current data, so a browser save produces exactly the bytes a host save would.

| Browser | Mechanism | Experience |
| --- | --- | --- |
| Chrome, Edge | File System Access API; the file handle is remembered per page address | Pick the file once; afterwards at most an "Allow editing" prompt per session |
| Firefox, Safari | Download | A new copy lands in Downloads; replace the original with it |

## 8. Conformance

The host checks every file before opening it and refuses any file that breaks this specification. The refusal lists every problem, offers a "Copy report" button (paste the report to an agent to fix the file) and points to opening the file in Chrome, where the fallback still works.

| Code | Problem |
| --- | --- |
| `bom` | The file starts with a byte order mark. |
| `line-endings` | The file contains CR characters. |
| `api-missing` | `<meta name="ev-host-api">` is missing. |
| `api-invalid` | `ev-host-api` is not a positive whole number. |
| `api-newer` | The document needs a newer host. Nothing else is checked. |
| `frame` | The text differs from the frame (section 2). The report shows the line, the expected text and the text found. |
| `field` | A placeholder value breaks its rule (section 2). |
| `kit-unknown` | `data-kit-version` names no published kit. |
| `kit-modified` | The kit text differs from the published kit. |
| `kit-api` | The kit belongs to a different API version. |
| `data-escape` | The data block contains a raw `<`. |
| `data-json` | The data block is not valid JSON. |
| `data-shape` | The data block is not a JSON object. |
| `script-comment` | The script section contains `<!--`. |

A file is treated as a document if and only if it contains `<meta name="ev-host-api"`, whatever its file name. Naming documents `<name>.ev.html` is recommended.

## 9. Writing a document

The reliable way is to write the sections separately and assemble them, which inserts the current kit verbatim:

```
doc-host/fixtures/src/<name>/
  meta.json   {"lang":"en","title":"…","docType":"…","docTypeVersion":"1.0"}
  style.css
  script.js
  data.json
```

```
cd doc-host
npm run assemble -- fixtures/src/<name> <output>.ev.html
```

`doc-host/fixtures/src/hours-sheet/` is the reference example.

Recommendations for generators:

- Keep behaviour readable, not minified, so a person can see what a generated document does.
- Keep the data shape flat and documented at the top of the script section.
- Render an empty data block gracefully.
- Never write `</script`, `</style` or `<!--` inside a section; write `<\/script` in JavaScript strings.
````

- [ ] **Step 2: Check the specification against the code**

From `doc-host/`:

```bash
node -e "const {FRAME}=require('./src/frame'); console.log(FRAME.map((p,i)=>i%2?'{'+p+'}':p).join(''))"
```

Expected: the printed text is identical to the frame block in section 2 of `docs/document-spec.md`.

```bash
grep -o "problem('[a-z-]*'" src/conformance.js | sort -u
```

Expected: the same 14 codes as the table in section 8.

- [ ] **Step 3: Mark the carried-over facts in the product spec**

In `firstSpec.md`, section "To document", delete the two table rows whose destination is `docs/document-spec.md` (the CRLF fact and the `beforeunload` fact). Keep the auto-update row. Below the table, add:

```markdown
Carried over: the CRLF and `beforeunload` facts now live in [docs/document-spec.md](docs/document-spec.md) (rules 4 and 5).
```

- [ ] **Step 4: Commit**

From the repository root:

```bash
git add docs/document-spec.md firstSpec.md
git commit -m "docs: document specification v1

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Safe write and version store

Saving reads the file from disk, checks it still conforms, splices the data, keeps the previous file in the version store, writes `<name>.tmp`, flushes it and renames it over the original. Any failure leaves the original untouched.

**Files:**
- Create: `doc-host/src/validate.js`
- Create: `doc-host/src/write.js`
- Test: `doc-host/test/validate.test.js`, `doc-host/test/write.test.js`

**Interfaces:**
- Consumes: `checkDocument` (Task 3), `splice` (Task 2).
- Produces:
  - `src/validate.js`: `MAX_DATA_BYTES = 52428800`; `validateSnapshot(json: unknown, maxBytes?) => string | null` (an error message, or `null` if it may be written).
  - `src/write.js`: `writeDocument(filePath: string, json: string, { storeDir: string, now?: Date }) => Promise<string>` (resolves with the new file content); `pathKey(filePath) => string` (32 hex chars); `selectVersionsToDelete(names: string[], now: Date, { keepLatest = 20, keepDays = 30 }?) => string[]`; `storeVersion(...)`; `sha256(text) => string`.
  - Version store layout: `<storeDir>/<pathKey>/<ISO timestamp with ":" and "." as "-">.html` plus `meta.json` `{ path, fileName, docType, dataHash, lastSeen }`.

- [ ] **Step 1: Write the failing tests**

Create `doc-host/test/validate.test.js`:

```js
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { validateSnapshot } = require('../src/validate');

test('accepts a JSON object', () => {
  assert.equal(validateSnapshot('{"rows":[]}'), null);
});

test('rejects non-strings, invalid JSON and non-objects', () => {
  assert.match(validateSnapshot(undefined), /no data/);
  assert.match(validateSnapshot('{nope'), /invalid JSON/);
  assert.match(validateSnapshot('[1,2]'), /JSON object/);
  assert.match(validateSnapshot('null'), /JSON object/);
});

test('rejects data over the size limit', () => {
  assert.match(validateSnapshot('{"a":"xxxxxxxxxx"}', 10), /larger than/);
});
```

Create `doc-host/test/write.test.js`:

```js
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { pathKey, selectVersionsToDelete, writeDocument } = require('../src/write');
const { splice } = require('../src/splice');
const { makeDocument } = require('./helpers');

async function setup() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ev-write-'));
  const filePath = path.join(dir, 'sample.ev.html');
  const storeDir = path.join(dir, 'store');
  await fs.writeFile(filePath, makeDocument(), 'utf8');
  return { dir, filePath, storeDir };
}

test('writeDocument changes only the data block and returns the new content', async () => {
  const { filePath, storeDir } = await setup();
  const original = await fs.readFile(filePath, 'utf8');
  const result = await writeDocument(filePath, '{"rows":[{"hours":3}]}', { storeDir });
  const onDisk = await fs.readFile(filePath, 'utf8');
  assert.equal(onDisk, splice(original, '{"rows":[{"hours":3}]}'));
  assert.equal(result, onDisk);
});

test('writeDocument keeps the previous file and meta.json in the version store', async () => {
  const { filePath, storeDir } = await setup();
  const original = await fs.readFile(filePath, 'utf8');
  await writeDocument(filePath, '{"rows":[]}', { storeDir, now: new Date('2026-10-06T10:00:00.000Z') });
  const entry = path.join(storeDir, pathKey(filePath));
  const names = (await fs.readdir(entry)).sort();
  assert.deepEqual(names, ['2026-10-06T10-00-00-000Z.html', 'meta.json']);
  assert.equal(await fs.readFile(path.join(entry, names[0]), 'utf8'), original);
  const meta = JSON.parse(await fs.readFile(path.join(entry, 'meta.json'), 'utf8'));
  assert.equal(meta.fileName, 'sample.ev.html');
  assert.equal(meta.docType, 'test-doc');
  assert.equal(meta.lastSeen, '2026-10-06T10:00:00.000Z');
});

test('two saves in the same millisecond keep both versions', async () => {
  const { filePath, storeDir } = await setup();
  const now = new Date('2026-10-06T10:00:00.000Z');
  await writeDocument(filePath, '{"n":1}', { storeDir, now });
  await writeDocument(filePath, '{"n":2}', { storeDir, now });
  const names = await fs.readdir(path.join(storeDir, pathKey(filePath)));
  assert.equal(names.filter((n) => n.endsWith('.html')).length, 2);
});

test('writeDocument leaves no .tmp file behind', async () => {
  const { dir, filePath, storeDir } = await setup();
  await writeDocument(filePath, '{}', { storeDir });
  assert.deepEqual((await fs.readdir(dir)).sort(), ['sample.ev.html', 'store']);
});

test('a non-conforming file on disk is not touched', async () => {
  const { filePath, storeDir } = await setup();
  const broken = makeDocument().replace('<head>\n', '<head>\n  <meta name="x" content="y">\n');
  await fs.writeFile(filePath, broken, 'utf8');
  await assert.rejects(writeDocument(filePath, '{}', { storeDir }), /no longer follows the document specification/);
  assert.equal(await fs.readFile(filePath, 'utf8'), broken);
});

test('invalid JSON is rejected before anything is written', async () => {
  const { filePath, storeDir } = await setup();
  const original = await fs.readFile(filePath, 'utf8');
  await assert.rejects(writeDocument(filePath, '{nope', { storeDir }), SyntaxError);
  assert.equal(await fs.readFile(filePath, 'utf8'), original);
  await assert.rejects(fs.access(storeDir));
});

test('a write that cannot create the .tmp file leaves the original intact', {
  skip: process.platform === 'win32' && 'chmod does not make folders read-only on Windows',
}, async () => {
  const { dir } = await setup();
  const target = path.join(dir, 'locked.ev.html');
  await fs.writeFile(target, makeDocument(), 'utf8');
  const original = await fs.readFile(target, 'utf8');
  await fs.chmod(dir, 0o555); // read-only folder: the .tmp file cannot be created
  try {
    await assert.rejects(writeDocument(target, '{}', { storeDir: path.join(os.tmpdir(), 'ev-store-ro') }));
  } finally {
    await fs.chmod(dir, 0o755);
  }
  assert.equal(await fs.readFile(target, 'utf8'), original);
  assert.ok(!(await fs.readdir(dir)).some((n) => n.endsWith('.tmp')));
});

test('selectVersionsToDelete keeps the newest 20 plus one per day for 30 days', () => {
  const now = new Date('2026-10-31T12:00:00.000Z');
  const names = [];
  // Oct 1–31, three saves a day.
  for (let day = 1; day <= 31; day++) {
    for (const hour of ['08', '12', '16']) {
      names.push(`2026-10-${String(day).padStart(2, '0')}T${hour}-00-00-000Z.html`);
    }
  }
  names.push('meta.json');
  const doomed = selectVersionsToDelete(names, now);
  const kept = names.filter((n) => n.endsWith('.html') && !doomed.includes(n));
  // Newest 20 cover Oct 25 (16h) to Oct 31; one per day for Oct 2–24.
  assert.equal(kept.length, 20 + 23);
  assert.ok(!kept.includes('2026-10-01T16-00-00-000Z.html'), 'older than 30 days');
  assert.ok(kept.includes('2026-10-02T16-00-00-000Z.html'));
  assert.ok(!kept.includes('2026-10-02T08-00-00-000Z.html'));
  assert.ok(!doomed.includes('meta.json'));
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test test/validate.test.js test/write.test.js`
Expected: FAIL with `Cannot find module '../src/validate'` and `Cannot find module '../src/write'`.

- [ ] **Step 3: Implement validation**

Create `doc-host/src/validate.js`:

```js
'use strict';

const MAX_DATA_BYTES = 50 * 1024 * 1024;

// Checks a snapshot the document handed to the host. Returns an error
// message, or null if the snapshot may be written.
function validateSnapshot(json, maxBytes = MAX_DATA_BYTES) {
  if (typeof json !== 'string') return 'The document returned no data (expected a JSON string).';
  if (Buffer.byteLength(json, 'utf8') > maxBytes) {
    return `The data is larger than ${Math.round(maxBytes / 1024 / 1024)} MB.`;
  }
  let value;
  try {
    value = JSON.parse(json);
  } catch (err) {
    return `The document returned invalid JSON: ${err.message}`;
  }
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return 'The data must be a JSON object.';
  }
  return null;
}

module.exports = { MAX_DATA_BYTES, validateSnapshot };
```

- [ ] **Step 4: Implement the write**

Create `doc-host/src/write.js`:

```js
'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { checkDocument } = require('./conformance');
const { splice } = require('./splice');

const KEEP_LATEST = 20;
const KEEP_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

function sha256(text) {
  return crypto.createHash('sha256').update(text, 'utf8').digest('hex');
}

// One folder per document in the version store, keyed by its absolute path.
function pathKey(filePath) {
  return sha256(path.resolve(filePath)).slice(0, 32);
}

// Version files are named by their UTC timestamp, so names sort by time.
function versionFileName(now) {
  return now.toISOString().replace(/[:.]/g, '-') + '.html';
}

// Keeps the newest KEEP_LATEST versions plus the newest version of each of
// the last KEEP_DAYS days. Returns the names to delete.
function selectVersionsToDelete(names, now, { keepLatest = KEEP_LATEST, keepDays = KEEP_DAYS } = {}) {
  const sorted = names.filter((n) => n.endsWith('.html')).sort();
  const keep = new Set(sorted.slice(-keepLatest));
  const newestPerDay = new Map();
  for (const name of sorted) newestPerDay.set(name.slice(0, 10), name);
  const firstDay = new Date(now.getTime() - (keepDays - 1) * DAY_MS).toISOString().slice(0, 10);
  for (const [day, name] of newestPerDay) if (day >= firstDay) keep.add(name);
  return sorted.filter((n) => !keep.has(n));
}

async function storeVersion({ storeDir, filePath, content, parts, now }) {
  const dir = path.join(storeDir, pathKey(filePath));
  await fs.mkdir(dir, { recursive: true });
  let name = versionFileName(now);
  for (let n = 1; await exists(path.join(dir, name)); n++) {
    name = versionFileName(now).replace('.html', `-${n}.html`);
  }
  await fs.writeFile(path.join(dir, name), content, 'utf8');
  const meta = {
    path: path.resolve(filePath),
    fileName: path.basename(filePath),
    docType: parts.docType,
    dataHash: sha256(parts.data),
    lastSeen: now.toISOString(),
  };
  await fs.writeFile(path.join(dir, 'meta.json'), JSON.stringify(meta, null, 2) + '\n', 'utf8');
  for (const old of selectVersionsToDelete(await fs.readdir(dir), now)) {
    await fs.unlink(path.join(dir, old));
  }
  return path.join(dir, name);
}

async function exists(p) {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

// Writes new data into a document on disk:
// 1. read the current file and check that it still conforms,
// 2. splice the data into it,
// 3. keep the current file in the version store,
// 4. write <name>.tmp next to it, flush, and rename it over the original.
// Any error leaves the original untouched. Returns the new file content.
async function writeDocument(filePath, json, { storeDir, now = new Date() }) {
  const current = await fs.readFile(filePath, 'utf8');
  const check = checkDocument(current);
  if (!check.ok) {
    throw new Error('The file on disk no longer follows the document specification, so it was not changed: ' +
      check.errors.map((e) => e.message).join(' '));
  }
  const next = splice(current, json);
  await storeVersion({ storeDir, filePath, content: current, parts: check.parts, now });

  const tmp = `${filePath}.tmp`;
  try {
    const handle = await fs.open(tmp, 'w');
    try {
      await handle.writeFile(next, 'utf8');
      await handle.sync();
    } finally {
      await handle.close();
    }
    await fs.rename(tmp, filePath);
  } catch (err) {
    await fs.rm(tmp, { force: true });
    throw err;
  }
  return next;
}

module.exports = { pathKey, selectVersionsToDelete, storeVersion, writeDocument, sha256 };
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npm test`
Expected: `ℹ pass 56`, `ℹ fail 0`. (On Windows, one write test is skipped: `chmod` cannot make a folder read-only there.)

- [ ] **Step 6: Commit**

```bash
git add src/validate.js src/write.js test/validate.test.js test/write.test.js
git commit -m "feat(host): atomic write with central version store

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: Change detection

The host has to tell an agent's behaviour edit apart from a data change. It hashes behaviour (everything but the data block) and data separately, and watches the document's folder, because an atomic save replaces the file rather than changing it.

**Files:**
- Create: `doc-host/src/watch.js`
- Test: `doc-host/test/watch.test.js`

**Interfaces:**
- Consumes: `buildDocument` (Task 1).
- Produces: `sectionHashes(parts) => { behaviour: string, data: string }`; `classifyChange(before, after) => { behaviour: boolean, data: boolean }`; `watchFile(filePath: string, onChange: () => void, { debounceMs = 200 }?) => { close() }`.

- [ ] **Step 1: Write the failing test**

Create `doc-host/test/watch.test.js`:

```js
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { sectionHashes, classifyChange, watchFile } = require('../src/watch');
const { makeParts } = require('./helpers');

test('a data change is not a behaviour change', () => {
  const before = sectionHashes(makeParts());
  const after = sectionHashes(makeParts({ data: '{"rows":[]}' }));
  assert.deepEqual(classifyChange(before, after), { behaviour: false, data: true });
});

test('script, style and title changes are behaviour changes', () => {
  const before = sectionHashes(makeParts());
  for (const change of [{ script: '\n// v2\n' }, { style: '\n/* v2 */\n' }, { title: 'Renamed' }]) {
    assert.deepEqual(classifyChange(before, sectionHashes(makeParts(change))), { behaviour: true, data: false });
  }
});

test('identical parts are no change', () => {
  assert.deepEqual(classifyChange(sectionHashes(makeParts()), sectionHashes(makeParts())), { behaviour: false, data: false });
});

test('watchFile reports a replaced file once, debounced, and ignores siblings', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ev-watch-'));
  const file = path.join(dir, 'doc.ev.html');
  await fs.writeFile(file, 'v1');
  let calls = 0;
  const watcher = watchFile(file, () => { calls++; }, { debounceMs: 50 });
  try {
    // macOS reports the file's own creation late; let that settle first.
    await new Promise((r) => setTimeout(r, 300));
    calls = 0;
    await fs.writeFile(path.join(dir, 'other.txt'), 'x');
    await new Promise((r) => setTimeout(r, 150));
    assert.equal(calls, 0, 'sibling files are ignored');
    await fs.writeFile(`${file}.tmp`, 'v2');
    await fs.rename(`${file}.tmp`, file);
    await new Promise((r) => setTimeout(r, 300));
    assert.equal(calls, 1);
  } finally {
    watcher.close();
  }
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test test/watch.test.js`
Expected: FAIL with `Cannot find module '../src/watch'`.

- [ ] **Step 3: Implement change detection**

Create `doc-host/src/watch.js`:

```js
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { buildDocument } = require('./frame');

function sha256(text) {
  return crypto.createHash('sha256').update(text, 'utf8').digest('hex');
}

// Behaviour is everything except the data block: the frame fields, style,
// kit and script. Hashing the document with an empty data block covers it.
function sectionHashes(parts) {
  return {
    behaviour: sha256(buildDocument({ ...parts, data: '' })),
    data: sha256(parts.data),
  };
}

function classifyChange(before, after) {
  return {
    behaviour: before.behaviour !== after.behaviour,
    data: before.data !== after.data,
  };
}

// Calls onChange (debounced) whenever the file may have changed. Watches the
// folder, because an atomic save replaces the file with a new one.
function watchFile(filePath, onChange, { debounceMs = 200 } = {}) {
  const name = path.basename(filePath);
  let timer = null;
  const watcher = fs.watch(path.dirname(filePath), (_event, changed) => {
    if (changed && changed.toString() !== name) return;
    clearTimeout(timer);
    timer = setTimeout(onChange, debounceMs);
  });
  watcher.on('error', () => {});
  return {
    close() {
      clearTimeout(timer);
      watcher.close();
    },
  };
}

module.exports = { sectionHashes, classifyChange, watchFile };
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test test/watch.test.js` three times.
Expected: `ℹ pass 4` every time. macOS reports a file's own creation late, which the test lets settle first. If the watcher test is flaky on your machine, raise the waits in the test, not the debounce in `watch.js`.

- [ ] **Step 5: Commit**

```bash
git add src/watch.js test/watch.test.js
git commit -m "feat(host): section hashes and file watcher

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: Fixtures: hours sheet and escape probe

Documents are assembled from their sections, so the kit is always inserted verbatim. The hours sheet (adapted from the prototype `hours-sheet.html` at the repository root) is the reference example. The escape probe is a document that tries to break out of the sandbox; Task 8 runs it.

Changes from the prototype: the data comes from `EvKit.init()`; under the host there is no Save button, no status line and no own key handling; `#app` became `#ev-app`; the whole save code (DOM clone, file handle, download) is gone because the kit does it.

**Files:**
- Create: `doc-host/tools/assemble.js`
- Create: `doc-host/fixtures/src/hours-sheet/meta.json`, `data.json`, `style.css`, `script.js`
- Create: `doc-host/fixtures/src/escape-probe/meta.json`, `data.json`, `style.css`, `script.js`
- Create (generated): `doc-host/fixtures/hours-sheet.ev.html`, `doc-host/fixtures/escape-probe.ev.html`
- Test: `doc-host/test/fixtures.test.js`

**Interfaces:**
- Consumes: `buildDocument` (Task 1), `escapeJson`, `currentKit` (Task 2), `checkDocument`, `formatReport` (Task 3).
- Produces: `npm run assemble -- <source folder> <output file>` (exit 1 with a report if the result does not conform); the two fixture documents. The escape probe prints lines `[probe] PASS …` / `[probe] FAIL …` and finally `[probe] done` to the console.

- [ ] **Step 1: Write the failing test**

Create `doc-host/test/fixtures.test.js`:

```js
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { JSDOM } = require('jsdom');
const { checkDocument } = require('../src/conformance');

const FIXTURES = path.join(__dirname, '..', 'fixtures');
const documents = fs.readdirSync(FIXTURES).filter((n) => n.endsWith('.ev.html'));

for (const name of documents) {
  test(`${name} conforms and is up to date with fixtures/src`, () => {
    const html = fs.readFileSync(path.join(FIXTURES, name), 'utf8');
    assert.deepEqual(checkDocument(html).errors, []);
    const src = path.join(FIXTURES, 'src', name.replace('.ev.html', ''));
    const out = path.join(require('node:os').tmpdir(), `ev-fixture-${process.pid}-${name}`);
    execFileSync(process.execPath, [path.join(__dirname, '..', 'tools', 'assemble.js'), src, out]);
    assert.equal(fs.readFileSync(out, 'utf8'), html, 'run: npm run assemble -- fixtures/src/<name> fixtures/<name>.ev.html');
  });
}

function loadHoursSheet(host) {
  const html = fs.readFileSync(path.join(FIXTURES, 'hours-sheet.ev.html'), 'utf8');
  const dom = new JSDOM(html, {
    runScripts: 'dangerously',
    url: 'https://example.test/hours-sheet.ev.html',
    beforeParse(window) { if (host) window.evHost = host; },
  });
  return dom.window.document;
}

test('hours sheet in the host: no Save button, rows reach the host', () => {
  const host = { version: 1, handler: null, dirty: 0, onSaveRequest(fn) { this.handler = fn; }, markDirty() { this.dirty++; } };
  const document = loadHoursSheet(host);
  assert.equal(document.getElementById('save'), null);
  document.getElementById('add').click();
  assert.equal(host.dirty, 1);
  assert.equal(JSON.parse(host.handler()).rows.length, 1);
});

test('hours sheet in a browser: own Save button and status line', () => {
  const document = loadHoursSheet(null);
  assert.ok(document.getElementById('save'));
  document.getElementById('add').click();
  assert.equal(document.getElementById('status').textContent, 'Unsaved changes');
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test test/fixtures.test.js`
Expected: FAIL with `ENOENT` for `fixtures/hours-sheet.ev.html`.

- [ ] **Step 3: Write the assemble tool**

Create `doc-host/tools/assemble.js`:

```js
'use strict';

// Builds a document from its sources:
//   node tools/assemble.js <source folder> <output file>
// The source folder holds meta.json ({ lang, title, docType, docTypeVersion }),
// style.css, script.js and data.json. The current kit is inserted verbatim.
const fs = require('node:fs');
const path = require('node:path');
const { buildDocument } = require('../src/frame');
const { escapeJson } = require('../src/splice');
const { checkDocument, formatReport } = require('../src/conformance');
const { currentKit } = require('../kit');

const [srcDir, outFile] = process.argv.slice(2);
if (!srcDir || !outFile) {
  console.error('Usage: node tools/assemble.js <source folder> <output file>');
  process.exit(1);
}

const read = (name) => fs.readFileSync(path.join(srcDir, name), 'utf8');
const meta = JSON.parse(read('meta.json'));
const kit = currentKit();
const html = buildDocument({
  lang: meta.lang,
  api: String(kit.api),
  docType: meta.docType,
  docTypeVersion: meta.docTypeVersion,
  title: meta.title,
  style: '\n' + read('style.css'),
  data: escapeJson(JSON.stringify(JSON.parse(read('data.json')))),
  kitVersion: kit.version,
  kit: kit.text,
  script: '\n' + read('script.js'),
});

const check = checkDocument(html);
if (!check.ok) {
  console.error(formatReport(outFile, check.errors));
  process.exit(1);
}
fs.writeFileSync(outFile, html, 'utf8');
console.log(`Wrote ${outFile} (kit ${kit.version}, ${html.length} characters)`);
```

- [ ] **Step 4: Write the hours sheet sources**

```bash
mkdir -p fixtures/src/hours-sheet fixtures/src/escape-probe
printf '{"lang":"en","title":"Hours sheet","docType":"hours-sheet","docTypeVersion":"1.0"}\n' > fixtures/src/hours-sheet/meta.json
printf '{"rows":[]}\n' > fixtures/src/hours-sheet/data.json
sed -n '7,122p' ../hours-sheet.html | sed 's/^  //' > fixtures/src/hours-sheet/style.css
shasum -a 256 fixtures/src/hours-sheet/style.css
```

Expected checksum: `c801262c158144acc6ce22f1122bc2b844f26e2594c1e4052ec5e53d82858e4e`. (The CSS is the prototype's `<style>` content, unindented by two spaces.)

Create `doc-host/fixtures/src/hours-sheet/script.js`:

```js
// Hours sheet: one row per work session.
// Data shape: {"rows":[{"date":"YYYY-MM-DD","person":"","task":"","hours":0,"note":""}]}
(function () {
  'use strict';

  const doc = EvKit.init({ onDirtyChange: (dirty) => showStatus(dirty) });
  const data = doc.data;
  data.rows = Array.isArray(data.rows) ? data.rows : [];

  const todayStr = () => {
    const d = new Date();
    return new Date(d - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  };

  // ---------- Build the UI (only exists at runtime, never saved) ----------
  // In the host, the host owns saving: no Save button and no status line.
  const app = document.getElementById('ev-app');
  app.innerHTML = `
    <main>
      <header>
        <h1>Hours sheet</h1>
        ${doc.hosted ? '' : '<span id="status">Saved</span>'}
      </header>

      <div class="bar">
        <button id="add" class="primary">Add row</button>
        <label>Person
          <select id="fPerson"><option value="">All</option></select>
        </label>
        <label>Month
          <input type="month" id="fMonth">
        </label>
        <button id="clearFilter" title="Show all rows">Clear filter</button>
        <span class="spacer"></span>
        <button id="sort">Sort by date</button>
        ${doc.hosted ? '' : '<button id="save" class="primary">Save</button>'}
      </div>

      <div class="sheet">
        <table>
          <thead>
            <tr>
              <th class="c-date">Date</th>
              <th class="c-person">Person</th>
              <th class="c-task">Task</th>
              <th class="c-hours num">Hours</th>
              <th>Note</th>
              <th class="c-del"></th>
            </tr>
          </thead>
          <tbody id="rows"></tbody>
          <tfoot>
            <tr>
              <td colspan="3">Total</td>
              <td class="num" id="total">0</td>
              <td colspan="2" id="count" style="font-weight:400;color:var(--muted)"></td>
            </tr>
          </tfoot>
        </table>
        <div class="empty" id="empty" hidden>No entries yet. Use “Add row” to log the first work session.</div>
      </div>

      <div id="people"></div>

      <p class="hint">
        ${doc.hosted
          ? 'Save with <kbd>Ctrl</kbd>+<kbd>S</kbd> (or <kbd>Cmd</kbd>+<kbd>S</kbd>) or File → Save.'
          : 'Save with <kbd>Ctrl</kbd>+<kbd>S</kbd> (or <kbd>Cmd</kbd>+<kbd>S</kbd>). In Chrome and Edge, pick this file once ' +
            'and it is remembered; later saves overwrite it. In other browsers a new copy of this page is downloaded; ' +
            'replace the old file with it.'}
      </p>
    </main>
    <datalist id="persons"></datalist>
    <datalist id="tasks"></datalist>
  `;

  const $ = (id) => document.getElementById(id);
  const tbody = $('rows');

  // ---------- Helpers ----------
  const fmt = (n) => (Math.round(n * 100) / 100).toLocaleString('en-US', { maximumFractionDigits: 2 });

  function showStatus(dirty) {
    const s = $('status');
    if (!s) return;
    s.textContent = dirty ? 'Unsaved changes' : 'Saved';
    s.classList.toggle('dirty', dirty);
  }

  function unique(field) {
    return [...new Set(data.rows.map(r => (r[field] || '').trim()).filter(Boolean))]
      .sort((a, b) => a.localeCompare(b));
  }

  function fillDatalist(id, values) {
    const dl = $(id);
    dl.innerHTML = '';
    values.forEach(v => { const o = document.createElement('option'); o.value = v; dl.append(o); });
  }

  function refreshLists() {
    const persons = unique('person');
    fillDatalist('persons', persons);
    fillDatalist('tasks', unique('task'));
    const sel = $('fPerson');
    const current = sel.value;
    sel.innerHTML = '<option value="">All</option>';
    persons.forEach(p => { const o = document.createElement('option'); o.value = p; o.textContent = p; sel.append(o); });
    sel.value = persons.includes(current) ? current : '';
  }

  function isVisible(r) {
    const p = $('fPerson').value, m = $('fMonth').value;
    if (p && (r.person || '').trim() !== p) return false;
    if (m && !(r.date || '').startsWith(m)) return false;
    return true;
  }

  function applyFilterAndTotals() {
    let total = 0, shown = 0;
    const byPerson = new Map();
    const trs = tbody.children;
    for (let i = 0; i < trs.length; i++) {
      const r = data.rows[i];
      const vis = isVisible(r);
      trs[i].hidden = !vis;
      if (vis) {
        shown++;
        const h = Number(r.hours) || 0;
        total += h;
        const key = (r.person || '').trim() || '(no person)';
        byPerson.set(key, (byPerson.get(key) || 0) + h);
      }
    }
    $('total').textContent = fmt(total);
    $('count').textContent = shown + (shown === 1 ? ' entry' : ' entries');
    $('empty').hidden = data.rows.length > 0;

    const box = $('people');
    box.innerHTML = '';
    [...byPerson.entries()].sort((a, b) => a[0].localeCompare(b[0])).forEach(([name, h]) => {
      const s = document.createElement('span');
      s.textContent = name;
      const b = document.createElement('b');
      b.textContent = fmt(h) + ' h';
      s.append(b);
      box.append(s);
    });
  }

  // ---------- Rows ----------
  function cell(cls, input) {
    const td = document.createElement('td');
    if (cls) td.className = cls;
    td.append(input);
    return td;
  }

  function field(row, key, type, extra = {}) {
    const i = document.createElement('input');
    i.type = type;
    i.setAttribute('aria-label', key);
    Object.entries(extra).forEach(([k, v]) => i.setAttribute(k, v));
    i.value = key === 'hours' ? (row.hours || '') : (row[key] || '');
    i.addEventListener('input', () => {
      row[key] = key === 'hours' ? (parseFloat(i.value.replace(',', '.')) || 0) : i.value;
      doc.changed();
      applyFilterAndTotals();
    });
    if (key === 'person' || key === 'task') i.addEventListener('change', refreshLists);
    return i;
  }

  function makeRow(row) {
    const tr = document.createElement('tr');
    tr.append(
      cell('', field(row, 'date', 'date')),
      cell('', field(row, 'person', 'text', { list: 'persons', autocomplete: 'off' })),
      cell('', field(row, 'task', 'text', { list: 'tasks', autocomplete: 'off' })),
      cell('num', field(row, 'hours', 'text', { inputmode: 'decimal', placeholder: '0' })),
      cell('', field(row, 'note', 'text'))
    );
    const del = document.createElement('td');
    del.className = 'del';
    const b = document.createElement('button');
    b.textContent = '×';
    b.title = 'Delete row';
    b.setAttribute('aria-label', 'Delete row');
    b.addEventListener('click', () => {
      const idx = data.rows.indexOf(row);
      if (idx < 0) return;
      data.rows.splice(idx, 1);
      tr.remove();
      doc.changed();
      refreshLists();
      applyFilterAndTotals();
    });
    del.append(b);
    tr.append(del);
    return tr;
  }

  function renderAll() {
    tbody.innerHTML = '';
    data.rows.forEach(r => tbody.append(makeRow(r)));
    refreshLists();
    applyFilterAndTotals();
  }

  $('add').addEventListener('click', () => {
    const last = data.rows[data.rows.length - 1];
    const row = {
      date: $('fMonth').value ? ($('fMonth').value + '-01') : todayStr(),
      person: $('fPerson').value || (last ? last.person : '') || '',
      task: '', hours: 0, note: ''
    };
    if ($('fMonth').value && todayStr().startsWith($('fMonth').value)) row.date = todayStr();
    data.rows.push(row);
    const tr = makeRow(row);
    tbody.append(tr);
    doc.changed();
    applyFilterAndTotals();
    const target = row.person ? tr.querySelector('td:nth-child(3) input') : tr.querySelector('td:nth-child(2) input');
    target.focus();
  });

  $('sort').addEventListener('click', () => {
    data.rows.sort((a, b) => (a.date || '').localeCompare(b.date || ''));
    doc.changed();
    renderAll();
  });

  $('fPerson').addEventListener('change', applyFilterAndTotals);
  $('fMonth').addEventListener('input', applyFilterAndTotals);
  $('clearFilter').addEventListener('click', () => {
    $('fPerson').value = ''; $('fMonth').value = '';
    applyFilterAndTotals();
  });

  if (!doc.hosted) $('save').addEventListener('click', () => doc.save());

  renderAll();
})();
```

- [ ] **Step 5: Write the escape probe sources**

```bash
printf '{"lang":"en","title":"Escape probe","docType":"escape-probe","docTypeVersion":"1.0"}\n' > fixtures/src/escape-probe/meta.json
printf '{"runs":0}\n' > fixtures/src/escape-probe/data.json
```

Create `doc-host/fixtures/src/escape-probe/style.css`:

```css
body { font: 14px/1.5 system-ui, sans-serif; margin: 24px; }
.pass { color: #0a7d32; }
.fail { color: #b3261e; font-weight: 600; }
```

Create `doc-host/fixtures/src/escape-probe/script.js`:

```js
// Escape probe: tries everything a document must not be able to do and
// reports each attempt as PASS (blocked) or FAIL (possible). Run it with
// `npm run probe`; the host prints the results and exits 1 on any FAIL.
// Data shape: {"runs":0}
(async function () {
  'use strict';

  const doc = EvKit.init();
  const list = document.createElement('ul');
  document.getElementById('ev-app').append(list);

  function report(name, pass, detail) {
    const line = `[probe] ${pass ? 'PASS' : 'FAIL'} ${name}${detail ? ' (' + detail + ')' : ''}`;
    const li = document.createElement('li');
    li.className = pass ? 'pass' : 'fail';
    li.textContent = line;
    list.append(li);
    console.log(line);
  }

  async function blockedFetch(name, url) {
    try {
      await fetch(url);
      report(name, false, 'request succeeded');
    } catch {
      report(name, true);
    }
  }

  function blockedImage(name, url) {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => { report(name, false, 'image loaded'); resolve(); };
      img.onerror = () => { report(name, true); resolve(); };
      img.src = url;
    });
  }

  report('runs inside the host', doc.hosted);
  report('host API is data-only', Object.keys(window.evHost).sort().join(',') === 'markDirty,onSaveRequest,version',
    Object.keys(window.evHost).join(','));
  report('no Node.js in the page', typeof require === 'undefined' && typeof process === 'undefined');
  report('storage starts empty', localStorage.length === 0);
  localStorage.setItem('probe', 'set');

  await blockedFetch('fetch https', 'https://example.com/');
  await blockedFetch('fetch file://', 'file:///etc/hosts');
  await blockedFetch('fetch own origin', location.origin + '/other.html');
  await blockedImage('image from https', 'https://www.google.com/favicon.ico');
  await blockedImage('image from file://', 'file:///System/Library/CoreServices/Finder.app/Contents/Resources/Finder.icns');

  const opened = window.open('https://example.com/');
  report('window.open', !opened);

  const violations = [];
  document.addEventListener('securitypolicyviolation', (e) => violations.push(e.blockedURI));
  const frame = document.createElement('iframe');
  frame.src = 'https://example.com/';
  document.body.append(frame);
  await new Promise((resolve) => setTimeout(resolve, 500));
  report('iframe to https', violations.some((uri) => uri.startsWith('https://example.com')));

  const before = location.href;
  location.href = 'https://example.com/';
  await new Promise((resolve) => setTimeout(resolve, 1000));
  report('navigation away', location.href === before);
  console.log('[probe] done');
})();
```

- [ ] **Step 6: Assemble both documents**

```bash
npm run assemble -- fixtures/src/hours-sheet fixtures/hours-sheet.ev.html
npm run assemble -- fixtures/src/escape-probe fixtures/escape-probe.ev.html
```

Expected: `Wrote fixtures/hours-sheet.ev.html (kit 1.0.0, 19360 characters)` and `Wrote fixtures/escape-probe.ev.html (kit 1.0.0, 10158 characters)`.

- [ ] **Step 7: Run the tests to verify they pass**

Run: `npm test`
Expected: `ℹ pass 64`, `ℹ fail 0`.

- [ ] **Step 8: Check the fallback in a real browser**

Open `fixtures/hours-sheet.ev.html` in Chrome (File → Open File). Expected: the sheet renders with a Save button and "Saved" status. Add a row: the status changes to "Unsaved changes". Press Cmd/Ctrl+S, pick a file name in a temporary folder, save. Then run `node -e "console.log(require('./src/conformance').checkDocument(require('fs').readFileSync(process.argv[1],'utf8')).errors)" <saved file>`. Expected: `[]`.

- [ ] **Step 9: Commit**

```bash
git add tools/assemble.js fixtures test/fixtures.test.js
git commit -m "feat(host): assemble tool, hours sheet and escape probe fixtures

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 8: Sandboxed document window

The Electron shell: open a document (dialog, command line, drag and drop, macOS dock), refuse non-conforming files with a report, and run conforming ones sandboxed. No saving yet. The deliverable is verified by the escape probe: every attempt to leave the sandbox must fail.

Security model in brief: each opened document gets a random id, its own **in-memory** session (`session.fromPartition('ev-doc-<id>')`, no `persist:`), and is served from memory under `ev-doc://<id>/` with a strict CSP. The session cancels every request outside that origin, denies all permissions and downloads. The web contents cannot navigate, open windows or block closing. The preload exposes only `window.evHost` (version, onSaveRequest, markDirty).

**Files:**
- Create: `doc-host/src/urls.js`, `src/argv.js`, `src/registry.js`, `src/protocol.js`, `src/security.js`, `src/preload.js`, `src/ipc.js`, `src/document-window.js`, `src/open.js`, `src/menu.js`, `src/probe.js`, `src/main.js`, `tools/start.js`
- Test: `doc-host/test/urls.test.js`, `doc-host/test/argv.test.js`

**Interfaces:**
- Consumes: `isDocument`, `checkDocument`, `formatReport` (Task 3); fixtures (Task 7).
- Produces:
  - `src/urls.js`: `SCHEME = 'ev-doc'`; `originFor(id) => 'ev-doc://<id>'`; `isDocumentUrl(url, origin) => boolean` (only `<origin>/`); `isAllowedRequest(url, origin) => boolean` (own origin, `data:`, `blob:`).
  - `src/argv.js`: `pathsFromArgv(argv, { isPackaged, cwd }) => string[]`.
  - `src/registry.js`: `class Registry { documents: Set; add(doc); remove(doc); bySender(webContentsId); byWindow(win); byPath(filePath) }`.
  - `src/protocol.js`: `CSP`; `registerSchemePrivileges()` (before `app` is ready); `serveDocument(session, origin, getHtml: () => string)`.
  - `src/security.js`: `hardenSession(session, origin)`; `hardenContents(webContents)`; `WEB_PREFERENCES`.
  - `src/ipc.js`: `registerIpc({ registry, open })`, routing `doc:dirty` → `doc.onDirty(counter)`, `doc:save-data` → `doc.onSaveData(payload)`, `doc:dropped-files` → `open(path)`.
  - `src/document-window.js` (stage 1): `class DocumentWindow({ filePath, html, storeDir, registry })` with `filePath, name, html, origin, session, win, view, webContentsId, focus(), updateTitle(), onDirty(), onSaveData(), dispose(), ask(options) => Promise<number | null>`.
  - `src/open.js`: `openPath(rawPath, { registry, storeDir }) => Promise<DocumentWindow | null>`.
  - `src/menu.js` (stage 1): `buildMenu({ current, showOpenDialog, isDev }) => Menu`.
  - `src/probe.js`: `attachProbe(doc)` (only used with `EV_PROBE=1`).
  - IPC channels: main → preload `doc:request-save (requestId)`; preload → main `doc:save-data ({ requestId, json, changes, error })`, `doc:dirty (counter)`, `doc:dropped-files (paths)`.

- [ ] **Step 1: Write the failing tests for the pure parts**

Create `doc-host/test/urls.test.js`:

```js
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { originFor, isDocumentUrl, isAllowedRequest } = require('../src/urls');

const origin = originFor('0123abcd');

test('originFor builds an ev-doc origin', () => {
  assert.equal(origin, 'ev-doc://0123abcd');
});

test('only the document URL itself is served', () => {
  assert.equal(isDocumentUrl('ev-doc://0123abcd/', origin), true);
  assert.equal(isDocumentUrl('ev-doc://0123abcd/other.html', origin), false);
  assert.equal(isDocumentUrl('ev-doc://0123abcd/?x=1', origin), false);
  assert.equal(isDocumentUrl('ev-doc://ffff/', origin), false);
});

test('a document session may only request its own origin, data: and blob:', () => {
  assert.equal(isAllowedRequest('ev-doc://0123abcd/', origin), true);
  assert.equal(isAllowedRequest('data:image/png;base64,AAAA', origin), true);
  assert.equal(isAllowedRequest('blob:ev-doc://0123abcd/5f2c', origin), true);
  for (const url of ['https://example.com/', 'http://localhost/', 'file:///etc/hosts', 'ev-doc://ffff/', 'ws://x/']) {
    assert.equal(isAllowedRequest(url, origin), false, url);
  }
});
```

Create `doc-host/test/argv.test.js`:

```js
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathsFromArgv } = require('../src/argv');

test('development: skips electron and the app folder', () => {
  const argv = ['/x/Electron', '.', 'a.ev.html', '--inspect', '/abs/b.html'];
  assert.deepEqual(pathsFromArgv(argv, { isPackaged: false, cwd: '/work' }), [path.resolve('/work', 'a.ev.html'), path.resolve('/abs/b.html')]);
});

test('packaged: skips only the executable', () => {
  assert.deepEqual(pathsFromArgv(['/App', 'c.html'], { isPackaged: true, cwd: '/w' }), [path.resolve('/w', 'c.html')]);
});
```

Run: `node --test test/urls.test.js test/argv.test.js`
Expected: FAIL with `Cannot find module '../src/urls'` and `Cannot find module '../src/argv'`.

- [ ] **Step 2: Implement the pure parts**

Create `doc-host/src/urls.js`:

```js
'use strict';

// Pure URL rules for document sessions (no Electron imports, unit-tested).

const SCHEME = 'ev-doc';

function originFor(id) {
  return `${SCHEME}://${id}`;
}

// The only URL the protocol handler answers: the document itself.
function isDocumentUrl(url, origin) {
  return url === `${origin}/`;
}

// Requests a document session may make at all. Everything else is cancelled.
function isAllowedRequest(url, origin) {
  return url.startsWith(`${origin}/`) || url.startsWith('data:') || url.startsWith('blob:');
}

module.exports = { SCHEME, originFor, isDocumentUrl, isAllowedRequest };
```

Create `doc-host/src/argv.js`:

```js
'use strict';

const path = require('node:path');

// File paths from a command line. In development argv is
// [electron, '.', ...files]; in a packaged app it is [app, ...files].
// Chromium switches (starting with "-") are skipped.
function pathsFromArgv(argv, { isPackaged, cwd }) {
  return argv
    .slice(isPackaged ? 1 : 2)
    .filter((arg) => arg && !arg.startsWith('-'))
    .map((arg) => path.resolve(cwd, arg));
}

module.exports = { pathsFromArgv };
```

Create `doc-host/src/registry.js`:

```js
'use strict';

// Open documents, findable by web contents (IPC sender), window and path.
class Registry {
  constructor() {
    this.documents = new Set();
  }

  add(doc) {
    this.documents.add(doc);
  }

  remove(doc) {
    this.documents.delete(doc);
  }

  bySender(webContentsId) {
    for (const doc of this.documents) if (doc.webContentsId === webContentsId) return doc;
    return null;
  }

  byWindow(win) {
    for (const doc of this.documents) if (doc.win === win) return doc;
    return null;
  }

  byPath(filePath) {
    for (const doc of this.documents) if (doc.filePath === filePath) return doc;
    return null;
  }
}

module.exports = { Registry };
```

Run: `npm test`
Expected: `ℹ pass 69`, `ℹ fail 0`.

- [ ] **Step 3: Write the protocol and the lockdown**

Create `doc-host/src/protocol.js`:

```js
'use strict';

const { protocol } = require('electron');
const { SCHEME, isDocumentUrl } = require('./urls');

const CSP = [
  "default-src 'none'",
  "style-src 'unsafe-inline'",
  "script-src 'unsafe-inline'",
  'img-src data: blob:',
  'font-src data:',
].join('; ');

// Must run before the app is ready.
function registerSchemePrivileges() {
  protocol.registerSchemesAsPrivileged([{ scheme: SCHEME, privileges: { standard: true, secure: true } }]);
}

// Serves exactly one URL in this session: the document, from memory, with a
// strict CSP. Every other request on the scheme gets a 404.
function serveDocument(ses, origin, getHtml) {
  ses.protocol.handle(SCHEME, (request) => {
    if (request.method !== 'GET' || !isDocumentUrl(request.url, origin)) {
      return new Response('Not found', { status: 404 });
    }
    return new Response(getHtml(), {
      status: 200,
      headers: {
        'content-type': 'text/html; charset=utf-8',
        'content-security-policy': CSP,
        'cache-control': 'no-store',
      },
    });
  });
}

module.exports = { CSP, registerSchemePrivileges, serveDocument };
```

Create `doc-host/src/security.js`:

```js
'use strict';

const { isAllowedRequest } = require('./urls');

// Locks down a document's (in-memory) session: no permissions, no
// downloads, no requests outside the document's own origin.
function hardenSession(ses, origin) {
  ses.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
  ses.setPermissionCheckHandler(() => false);
  ses.setDevicePermissionHandler(() => false);
  ses.webRequest.onBeforeRequest({ urls: ['<all_urls>'] }, (details, callback) => {
    callback({ cancel: !isAllowedRequest(details.url, origin) });
  });
  ses.on('will-download', (event) => event.preventDefault());
}

// Locks down a document's web contents: no navigation, no new windows, no
// webviews, and a document cannot block closing with beforeunload.
function hardenContents(wc) {
  wc.on('will-navigate', (event) => event.preventDefault());
  wc.on('will-redirect', (event) => event.preventDefault());
  wc.on('will-attach-webview', (event) => event.preventDefault());
  wc.on('will-prevent-unload', (event) => event.preventDefault());
  wc.setWindowOpenHandler(() => ({ action: 'deny' }));
}

const WEB_PREFERENCES = Object.freeze({
  contextIsolation: true,
  sandbox: true,
  nodeIntegration: false,
  webSecurity: true,
  webviewTag: false,
  navigateOnDragDrop: false,
  spellcheck: false,
});

module.exports = { hardenSession, hardenContents, WEB_PREFERENCES };
```

- [ ] **Step 4: Write the preload and the IPC routing**

Create `doc-host/src/preload.js`:

```js
'use strict';

// Host API v1 (window.evHost). Runs sandboxed, in an isolated world.
const { contextBridge, ipcRenderer, webUtils } = require('electron');

let saveHandler = null;
let changes = 0;

ipcRenderer.on('doc:request-save', (_event, requestId) => {
  let json = null;
  let error = null;
  if (!saveHandler) {
    error = 'The document did not register a save handler (evHost.onSaveRequest).';
  } else {
    try {
      json = saveHandler();
    } catch (err) {
      error = `The document failed to produce its data: ${err && err.message ? err.message : err}`;
    }
  }
  ipcRenderer.send('doc:save-data', { requestId, json, changes, error });
});

contextBridge.exposeInMainWorld('evHost', {
  version: 1,
  onSaveRequest: (handler) => {
    if (typeof handler === 'function') saveHandler = handler;
  },
  markDirty: () => ipcRenderer.send('doc:dirty', ++changes),
});

// Files dropped onto a document open in the host. Only real drops from the
// user count (isTrusted); the document never sees the paths.
function hasFiles(event) {
  return !!event.dataTransfer && Array.from(event.dataTransfer.types).includes('Files');
}

window.addEventListener('dragover', (event) => {
  if (hasFiles(event)) event.preventDefault();
}, true);

window.addEventListener('drop', (event) => {
  if (!event.isTrusted || !hasFiles(event)) return;
  event.preventDefault();
  event.stopPropagation();
  const paths = Array.from(event.dataTransfer.files)
    .map((file) => webUtils.getPathForFile(file))
    .filter(Boolean);
  if (paths.length) ipcRenderer.send('doc:dropped-files', paths);
}, true);
```

Create `doc-host/src/ipc.js`:

```js
'use strict';

const path = require('node:path');
const { ipcMain } = require('electron');

// Routes messages from the preload to their document. The sender decides
// which document a message belongs to; messages never carry a target path.
function registerIpc({ registry, open }) {
  ipcMain.on('doc:dirty', (event, counter) => registry.bySender(event.sender.id)?.onDirty(counter));
  ipcMain.on('doc:save-data', (event, payload) => registry.bySender(event.sender.id)?.onSaveData(payload));
  ipcMain.on('doc:dropped-files', (event, paths) => {
    if (!registry.bySender(event.sender.id) || !Array.isArray(paths)) return;
    for (const p of paths) if (typeof p === 'string' && path.isAbsolute(p)) open(p);
  });
}

module.exports = { registerIpc };
```

- [ ] **Step 5: Write the document window (stage 1: open only)**

Create `doc-host/src/document-window.js`:

```js
'use strict';

const path = require('node:path');
const crypto = require('node:crypto');
const { BaseWindow, WebContentsView, session, dialog } = require('electron');
const { serveDocument } = require('./protocol');
const { hardenSession, hardenContents, WEB_PREFERENCES } = require('./security');
const { originFor } = require('./urls');

// One open document: its window, its sandboxed view, its file on disk.
// The main process owns the path; the document only ever sends data.
class DocumentWindow {
  constructor({ filePath, html, storeDir, registry }) {
    this.filePath = filePath;
    this.name = path.basename(filePath);
    this.storeDir = storeDir;
    this.registry = registry;
    this.html = html; // what the protocol handler serves
    this.prompting = false;

    const id = crypto.randomBytes(16).toString('hex');
    this.origin = originFor(id);
    this.session = session.fromPartition(`ev-doc-${id}`); // no "persist:" = in memory
    hardenSession(this.session, this.origin);
    serveDocument(this.session, this.origin, () => this.html);

    this.win = new BaseWindow({ width: 1100, height: 800, title: this.name });
    this.view = new WebContentsView({
      webPreferences: { ...WEB_PREFERENCES, session: this.session, preload: path.join(__dirname, 'preload.js') },
    });
    this.webContentsId = this.view.webContents.id;
    this.win.contentView.addChildView(this.view);
    this.layout();
    this.win.on('resize', () => this.layout());
    hardenContents(this.view.webContents);

    this.win.on('closed', () => this.dispose());
    if (process.platform === 'darwin') this.win.setRepresentedFilename(filePath);

    registry.add(this);
    this.updateTitle();
    this.view.webContents.loadURL(`${this.origin}/`);
  }

  layout() {
    const { width, height } = this.win.getContentBounds();
    this.view.setBounds({ x: 0, y: 0, width, height });
  }

  focus() {
    if (this.win.isMinimized()) this.win.restore();
    this.win.focus();
  }

  updateTitle() {
    if (this.win.isDestroyed()) return;
    this.win.setTitle(this.name);
  }

  // IPC from the preload; saving follows in the next task.
  onDirty() {}

  onSaveData() {}

  dispose() {
    this.registry.remove(this);
    if (!this.view.webContents.isDestroyed()) this.view.webContents.close();
    this.session.protocol.unhandle('ev-doc');
    this.session.clearStorageData().catch(() => {});
  }

  // One dialog at a time per document. Returns the button index, or null if
  // another dialog was already open.
  async ask(options) {
    if (this.prompting || this.win.isDestroyed()) return null;
    this.prompting = true;
    try {
      const { response } = await dialog.showMessageBox(this.win, options);
      return response;
    } finally {
      this.prompting = false;
    }
  }
}

module.exports = { DocumentWindow };
```

- [ ] **Step 6: Write opening, the menu and the app**

Create `doc-host/src/open.js`:

```js
'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { dialog, clipboard } = require('electron');
const { isDocument, checkDocument, formatReport } = require('./conformance');
const { DocumentWindow } = require('./document-window');

const MAX_FILE_BYTES = 60 * 1024 * 1024;

// Opens a file in the host: refuses anything that is not a conforming
// document, focuses the window if the document is already open.
async function openPath(rawPath, { registry, storeDir }) {
  let filePath;
  let html;
  try {
    filePath = await fs.realpath(path.resolve(rawPath));
    const stat = await fs.stat(filePath);
    if (!stat.isFile()) throw new Error('This is not a file.');
    if (stat.size > MAX_FILE_BYTES) throw new Error('The file is larger than 60 MB.');
    html = await fs.readFile(filePath, 'utf8');
  } catch (err) {
    await dialog.showMessageBox({ type: 'error', message: `${path.basename(rawPath)} could not be opened.`, detail: err.message });
    return null;
  }

  const open = registry.byPath(filePath);
  if (open) {
    open.focus();
    return open;
  }

  if (!isDocument(html)) {
    await dialog.showMessageBox({
      type: 'info',
      message: `${path.basename(filePath)} is not an EverythingApp document.`,
      detail: 'EverythingApp opens HTML documents that contain <meta name="ev-host-api">.',
    });
    return null;
  }

  const check = checkDocument(html);
  if (!check.ok) {
    const report = formatReport(filePath, check.errors);
    const { response } = await dialog.showMessageBox({
      type: 'warning',
      message: `EverythingApp refused to open ${path.basename(filePath)}.`,
      detail: report,
      buttons: ['Copy report', 'OK'],
      defaultId: 1,
    });
    if (response === 0) clipboard.writeText(report);
    return null;
  }

  return new DocumentWindow({ filePath, html, storeDir, registry });
}

module.exports = { openPath };
```

Create `doc-host/src/menu.js`:

```js
'use strict';

const { Menu, shell } = require('electron');

// current() returns the focused DocumentWindow or null.
function buildMenu({ current, showOpenDialog, isDev }) {
  const isMac = process.platform === 'darwin';
  const withDoc = (fn) => () => {
    const doc = current();
    if (doc) fn(doc);
  };

  const template = [
    ...(isMac ? [{ role: 'appMenu' }] : []),
    {
      label: 'File',
      submenu: [
        { label: 'Open…', accelerator: 'CmdOrCtrl+O', click: () => showOpenDialog() },
        { type: 'separator' },
        { label: 'Close', accelerator: 'CmdOrCtrl+W', click: withDoc((doc) => doc.win.close()) },
        { type: 'separator' },
        { label: isMac ? 'Reveal in Finder' : 'Show in folder', click: withDoc((doc) => shell.showItemInFolder(doc.filePath)) },
        ...(isMac ? [] : [{ type: 'separator' }, { role: 'quit' }]),
      ],
    },
    { role: 'editMenu' },
    {
      label: 'View',
      submenu: [
        ...(isDev ? [{
          label: 'Developer Tools',
          accelerator: isMac ? 'Alt+Cmd+I' : 'Ctrl+Shift+I',
          click: withDoc((doc) => doc.view.webContents.toggleDevTools()),
        }] : []),
      ],
    },
    { role: 'windowMenu' },
  ];
  return Menu.buildFromTemplate(template);
}

module.exports = { buildMenu };
```

Create `doc-host/src/probe.js`:

```js
'use strict';

// Test support (only active with EV_PROBE=1): prints the document's
// "[probe]" console lines to stdout and quits when it reports "done".
// Exit code 1 if any line says FAIL.
const { app } = require('electron');

function attachProbe(doc) {
  let failed = false;
  doc.view.webContents.on('console-message', (event) => {
    const { message } = event;
    if (!message || !message.startsWith('[probe]')) return;
    console.log(message);
    if (message.includes('FAIL')) failed = true;
    if (message === '[probe] done') app.exit(failed ? 1 : 0);
  });
  setTimeout(() => {
    console.log('[probe] FAIL timeout: the probe did not finish');
    app.exit(1);
  }, 15000);
}

module.exports = { attachProbe };
```

Create `doc-host/src/main.js`:

```js
'use strict';

const path = require('node:path');
const { app, BaseWindow, Menu, dialog } = require('electron');
const { registerSchemePrivileges } = require('./protocol');
const { Registry } = require('./registry');
const { registerIpc } = require('./ipc');
const { openPath } = require('./open');
const { buildMenu } = require('./menu');
const { pathsFromArgv } = require('./argv');
const { attachProbe } = require('./probe');

app.setName('EverythingApp');
registerSchemePrivileges();

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  const registry = new Registry();
  const storeDir = () => path.join(app.getPath('userData'), 'versions');
  const open = (p) => openPath(p, { registry, storeDir: storeDir() }).then((doc) => {
    if (doc && process.env.EV_PROBE) attachProbe(doc);
    return doc;
  });
  const current = () => {
    const win = BaseWindow.getFocusedWindow();
    return win ? registry.byWindow(win) : null;
  };

  async function showOpenDialog() {
    const { canceled, filePaths } = await dialog.showOpenDialog({
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'EverythingApp documents', extensions: ['html', 'htm'] }, { name: 'All files', extensions: ['*'] }],
    });
    if (!canceled) for (const p of filePaths) await open(p);
  }

  registerIpc({ registry, open });

  // macOS: files dropped on the dock icon or opened via Finder.
  const early = [];
  app.on('open-file', (event, p) => {
    event.preventDefault();
    if (app.isReady()) open(p);
    else early.push(p);
  });

  app.on('second-instance', (_event, argv, cwd) => {
    for (const p of pathsFromArgv(argv, { isPackaged: app.isPackaged, cwd })) open(p);
  });

  app.whenReady().then(async () => {
    Menu.setApplicationMenu(buildMenu({ current, showOpenDialog, isDev: !app.isPackaged }));
    const paths = [...early, ...pathsFromArgv(process.argv, { isPackaged: app.isPackaged, cwd: process.cwd() })];
    for (const p of paths) await open(p);
    if (paths.length === 0) await showOpenDialog();
    if (registry.documents.size === 0 && process.platform !== 'darwin') app.quit();
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin' || process.env.EV_PROBE) app.quit();
  });
}
```

Create `doc-host/tools/start.js`:

```js
'use strict';

// Starts the host: node tools/start.js [--probe | --smoke] [file ...]
// Clears ELECTRON_RUN_AS_NODE, which terminals inside VS Code set and which
// would make Electron behave like plain Node. --probe enables src/probe.js;
// --smoke runs tools/smoke.js instead of the app.
const path = require('node:path');
const { spawn } = require('node:child_process');
const electron = require('electron');

const args = process.argv.slice(2);
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
let entry = '.';
if (args[0] === '--probe') {
  args.shift();
  env.EV_PROBE = '1';
} else if (args[0] === '--smoke') {
  args.shift();
  entry = 'tools/smoke.js';
}
const files = args.map((f) => path.resolve(f));
const child = spawn(electron, [entry, ...files], { stdio: 'inherit', env, cwd: path.join(__dirname, '..') });
child.on('exit', (code) => process.exit(code ?? 1));
```

- [ ] **Step 7: Run the escape probe**

Run: `npm run probe`
Expected (a window flashes open and closes, exit code 0):

```
[probe] PASS runs inside the host
[probe] PASS host API is data-only (version,onSaveRequest,markDirty)
[probe] PASS no Node.js in the page
[probe] PASS storage starts empty
[probe] PASS fetch https
[probe] PASS fetch file://
[probe] PASS fetch own origin
[probe] PASS image from https
[probe] PASS image from file://
[probe] PASS window.open
[probe] PASS iframe to https
[probe] PASS navigation away
[probe] done
```

Electron may also print `Failed to load URL: https://example.com/ with error: ERR_BLOCKED_BY_CSP`; that is the iframe being blocked. Any `FAIL` line is a security bug: stop and fix it before continuing.

Run `npm run probe` a second time: `storage starts empty` must still PASS (sessions are in memory).

- [ ] **Step 8: Check opening by hand**

1. `npm start -- fixtures/hours-sheet.ev.html`. Expected: a window titled `hours-sheet.ev.html` shows the sheet without a Save button and without a status line. Edit → Copy/Paste work in the inputs.
2. File → Open… → pick `fixtures/hours-sheet.ev.html` again. Expected: the existing window comes to the front; no second window.
3. Make a broken copy with an extra meta tag: `node -e "const fs=require('fs'); fs.writeFileSync('/tmp/broken.ev.html', fs.readFileSync('fixtures/hours-sheet.ev.html','utf8').replace('<head>\n','<head>\n  <meta name=\"x\" content=\"y\">\n'))"`, then File → Open… → `/tmp/broken.ev.html`. Expected: "EverythingApp refused to open broken.ev.html." with a `[frame] line 4` entry and the Chrome hint. "Copy report" puts the report on the clipboard.
4. File → Open… → any plain `.html` page (e.g. `../hours-sheet.html`, the prototype). Expected: "hours-sheet.html is not an EverythingApp document."
5. Drag `fixtures/escape-probe.ev.html` from Finder/Explorer onto the hours-sheet window. Expected: a second window opens with the probe; the hours sheet does not navigate.
6. View → Developer Tools (development only) opens the tools for the focused document.
7. Close all windows. On Windows the app quits; on macOS it stays in the dock.

- [ ] **Step 9: Commit**

```bash
git add src test tools/start.js
git commit -m "feat(host): sandboxed document window with ev-doc protocol

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 9: Save loop, dirty marker, close prompt

The host pulls the data from the document on Ctrl/Cmd+S, File → Save or the close prompt, validates it, and writes it with `writeDocument`. Dirty state belongs to the host: every `markDirty()` raises a counter; a save records the counter of its snapshot, and the marker clears only if nothing changed after that snapshot.

**Files:**
- Modify: `doc-host/src/document-window.js` (replace with stage 2)
- Modify: `doc-host/src/menu.js` (add Save and Reload)
- Create: `doc-host/tools/smoke.js`

**Interfaces:**
- Consumes: `validateSnapshot` (Task 5), `writeDocument` (Task 5), `checkDocument`, `formatReport` (Task 3), IPC routing (Task 8).
- Produces: `DocumentWindow` gains `isDirty: boolean`, `latestChange`, `savedChange`, `save() => Promise<boolean>` (one save at a time), `requestSnapshot()`, `reloadFromDisk() => Promise<boolean>`, `reloadInteractive()`, `onClose(event)`, `confirmClose()`, `showReport(errors, intro)`. `npm run smoke` exits 0 when the save loop works.

- [ ] **Step 1: Write the failing end-to-end test**

Create `doc-host/tools/smoke.js`:

```js
'use strict';

// End-to-end smoke test of the save loop, run as Electron's main script:
//   npm run smoke
// Opens a copy of the hours sheet, adds a row through the UI, saves and
// checks the file on disk.
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const { app } = require('electron');
const { registerSchemePrivileges } = require('../src/protocol');
const { Registry } = require('../src/registry');
const { registerIpc } = require('../src/ipc');
const { openPath } = require('../src/open');
const { checkDocument } = require('../src/conformance');
const { parseDocument } = require('../src/frame');

registerSchemePrivileges();

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function until(label, condition, timeoutMs = 5000) {
  const start = Date.now();
  while (!(await condition())) {
    if (Date.now() - start > timeoutMs) throw new Error(`Timed out waiting for: ${label}`);
    await wait(50);
  }
}

function step(text) {
  console.log(`[smoke] ${text}`);
}

async function run() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ev-smoke-'));
  const filePath = await fs.realpath(dir).then((d) => path.join(d, 'hours.ev.html'));
  const storeDir = path.join(dir, 'store');
  await fs.copyFile(path.join(__dirname, '..', 'fixtures', 'hours-sheet.ev.html'), filePath);
  const original = await fs.readFile(filePath, 'utf8');

  const registry = new Registry();
  registerIpc({ registry, open: (p) => openPath(p, { registry, storeDir }) });
  const doc = await openPath(filePath, { registry, storeDir });
  assert.ok(doc, 'the fixture opens');
  const wc = doc.view.webContents;
  await until('page loaded', () => !wc.isLoading());
  const js = (code) => wc.executeJavaScript(code);

  step('the document runs hosted, without its own Save button');
  assert.equal(await js('!!document.getElementById("add") && !document.getElementById("save")'), true);

  step('adding a row marks the document dirty');
  await js('document.getElementById("add").click()');
  await until('dirty', () => doc.isDirty);
  assert.match(doc.win.getTitle(), /^• hours\.ev\.html$/);

  step('saving writes the row into the data block only');
  assert.equal(await doc.save(), true);
  const saved = await fs.readFile(filePath, 'utf8');
  assert.equal(checkDocument(saved).ok, true);
  const before = parseDocument(original).parts;
  const after = parseDocument(saved).parts;
  assert.deepEqual({ ...after, data: '' }, { ...before, data: '' }, 'everything but the data is unchanged');
  assert.equal(JSON.parse(after.data).rows.length, 1);
  assert.equal(doc.isDirty, false);
  assert.equal(doc.win.getTitle(), 'hours.ev.html');

  step('the previous version is in the version store');
  const [entry] = await fs.readdir(storeDir);
  const versions = (await fs.readdir(path.join(storeDir, entry))).filter((n) => n.endsWith('.html'));
  assert.equal(versions.length, 1);
  assert.equal(await fs.readFile(path.join(storeDir, entry, versions[0]), 'utf8'), original);

  step('all checks passed');
}

app.whenReady()
  .then(run)
  .then(() => app.exit(0))
  .catch((err) => {
    console.error('[smoke] FAIL', err);
    app.exit(1);
  });
```

Run: `npm run smoke`
Expected: FAIL with `Timed out waiting for: dirty` (stage 1 ignores `doc:dirty`).

- [ ] **Step 2: Replace the document window with stage 2**

Replace the whole content of `doc-host/src/document-window.js` with:

```js
'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { BaseWindow, WebContentsView, session, dialog, clipboard } = require('electron');
const { checkDocument, formatReport } = require('./conformance');
const { validateSnapshot } = require('./validate');
const { writeDocument } = require('./write');
const { serveDocument } = require('./protocol');
const { hardenSession, hardenContents, WEB_PREFERENCES } = require('./security');
const { originFor } = require('./urls');

const SAVE_TIMEOUT_MS = 5000;

// One open document: its window, its sandboxed view, its file on disk.
// The main process owns the path; the document only ever sends data.
class DocumentWindow {
  constructor({ filePath, html, storeDir, registry }) {
    this.filePath = filePath;
    this.name = path.basename(filePath);
    this.storeDir = storeDir;
    this.registry = registry;

    this.html = html;                       // what the protocol handler serves

    this.latestChange = 0;                  // highest markDirty() counter seen
    this.savedChange = 0;                   // counter covered by the last write
    this.saving = null;
    this.prompting = false;
    this.closeConfirmed = false;
    this.pending = new Map();
    this.requestSeq = 0;

    const id = crypto.randomBytes(16).toString('hex');
    this.origin = originFor(id);
    this.session = session.fromPartition(`ev-doc-${id}`); // no "persist:" = in memory
    hardenSession(this.session, this.origin);
    serveDocument(this.session, this.origin, () => this.html);

    this.win = new BaseWindow({ width: 1100, height: 800, title: this.name });
    this.view = new WebContentsView({
      webPreferences: { ...WEB_PREFERENCES, session: this.session, preload: path.join(__dirname, 'preload.js') },
    });
    this.webContentsId = this.view.webContents.id;
    this.win.contentView.addChildView(this.view);
    this.layout();
    this.win.on('resize', () => this.layout());
    hardenContents(this.view.webContents);

    this.win.on('close', (event) => this.onClose(event));
    this.win.on('closed', () => this.dispose());
    if (process.platform === 'darwin') this.win.setRepresentedFilename(filePath);

    registry.add(this);
    this.updateTitle();
    this.view.webContents.loadURL(`${this.origin}/`);
  }

  get isDirty() {
    return this.latestChange > this.savedChange;
  }

  layout() {
    const { width, height } = this.win.getContentBounds();
    this.view.setBounds({ x: 0, y: 0, width, height });
  }

  focus() {
    if (this.win.isMinimized()) this.win.restore();
    this.win.focus();
  }

  updateTitle() {
    if (this.win.isDestroyed()) return;
    this.win.setTitle(`${this.isDirty ? '• ' : ''}${this.name}`);
    if (process.platform === 'darwin') this.win.setDocumentEdited(this.isDirty);
  }

  // ---------- IPC from the preload ----------

  onDirty(counter) {
    if (!Number.isSafeInteger(counter) || counter <= this.latestChange) return;
    this.latestChange = counter;
    this.updateTitle();
  }

  onSaveData(payload) {
    if (!payload || typeof payload !== 'object') return;
    const request = this.pending.get(payload.requestId);
    if (!request) return;
    this.pending.delete(payload.requestId);
    clearTimeout(request.timer);
    if (payload.error) request.reject(new Error(String(payload.error)));
    else request.resolve({ json: payload.json, changes: Number(payload.changes) || 0 });
  }

  requestSnapshot() {
    const requestId = ++this.requestSeq;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(requestId);
        reject(new Error('The document did not answer the save request.'));
      }, SAVE_TIMEOUT_MS);
      this.pending.set(requestId, { resolve, reject, timer });
      this.view.webContents.send('doc:request-save', requestId);
    });
  }

  rejectPending(reason) {
    for (const { reject, timer } of this.pending.values()) {
      clearTimeout(timer);
      reject(reason);
    }
    this.pending.clear();
  }

  // ---------- Saving ----------

  save() {
    if (!this.saving) this.saving = this.doSave().finally(() => { this.saving = null; });
    return this.saving;
  }

  async doSave() {
    try {
      const snapshot = await this.requestSnapshot();
      const problem = validateSnapshot(snapshot.json);
      if (problem) throw new Error(problem);
      await writeDocument(this.filePath, snapshot.json, { storeDir: this.storeDir });
      this.savedChange = Math.max(this.savedChange, snapshot.changes);
      this.updateTitle();
      return true;
    } catch (err) {
      await this.ask({
        type: 'error',
        message: `${this.name} could not be saved. The file on disk was not changed.`,
        detail: err.message,
        buttons: ['OK'],
      });
      return false;
    }
  }

  async reloadFromDisk() {
    let html;
    try {
      html = await fs.readFile(this.filePath, 'utf8');
    } catch (err) {
      await this.ask({ type: 'error', message: `${this.name} could not be read.`, detail: err.message, buttons: ['OK'] });
      return false;
    }
    const check = checkDocument(html);
    if (!check.ok) {
      await this.showReport(check.errors, 'The file on disk no longer follows the document specification. The open version keeps running; saving is refused until the file is fixed.');
      return false;
    }
    this.html = html;
    this.latestChange = 0;
    this.savedChange = 0;
    this.rejectPending(new Error('The document was reloaded.'));
    await this.view.webContents.loadURL(`${this.origin}/`);
    this.updateTitle();
    return true;
  }

  // View → Reload
  async reloadInteractive() {
    if (this.isDirty) {
      const choice = await this.ask({
        type: 'question',
        message: `Reload ${this.name} and discard your unsaved changes?`,
        buttons: ['Reload', 'Cancel'],
        defaultId: 1,
        cancelId: 1,
      });
      if (choice !== 0) return;
    }
    await this.reloadFromDisk();
  }

  // ---------- Closing ----------

  onClose(event) {
    if (this.closeConfirmed || !this.isDirty) return;
    event.preventDefault();
    this.confirmClose();
  }

  async confirmClose() {
    const choice = await this.ask({
      type: 'question',
      message: `Do you want to save the changes you made to ${this.name}?`,
      detail: "Your changes will be lost if you don't save them.",
      buttons: ['Save', "Don't save", 'Cancel'],
      defaultId: 0,
      cancelId: 2,
    });
    if (choice === 2 || choice === null) return;
    if (choice === 0 && !(await this.save())) return;
    this.closeConfirmed = true;
    this.win.close();
  }

  dispose() {
    this.rejectPending(new Error('The document was closed.'));
    this.registry.remove(this);
    if (!this.view.webContents.isDestroyed()) this.view.webContents.close();
    this.session.protocol.unhandle('ev-doc');
    this.session.clearStorageData().catch(() => {});
  }

  // ---------- Dialogs ----------

  // One dialog at a time per document. Returns the button index, or null if
  // another dialog was already open.
  async ask(options) {
    if (this.prompting || this.win.isDestroyed()) return null;
    this.prompting = true;
    try {
      const { response } = await dialog.showMessageBox(this.win, options);
      return response;
    } finally {
      this.prompting = false;
    }
  }

  async showReport(errors, intro) {
    const report = formatReport(this.filePath, errors);
    const choice = await this.ask({ type: 'warning', message: intro, detail: report, buttons: ['Copy report', 'OK'], defaultId: 1 });
    if (choice === 0) clipboard.writeText(report);
  }
}

module.exports = { DocumentWindow };
```

- [ ] **Step 3: Add Save and Reload to the menu**

Replace the whole content of `doc-host/src/menu.js` with:

```js
'use strict';

const { Menu, shell } = require('electron');

// current() returns the focused DocumentWindow or null.
function buildMenu({ current, showOpenDialog, isDev }) {
  const isMac = process.platform === 'darwin';
  const withDoc = (fn) => () => {
    const doc = current();
    if (doc) fn(doc);
  };

  const template = [
    ...(isMac ? [{ role: 'appMenu' }] : []),
    {
      label: 'File',
      submenu: [
        { label: 'Open…', accelerator: 'CmdOrCtrl+O', click: () => showOpenDialog() },
        { type: 'separator' },
        { label: 'Save', accelerator: 'CmdOrCtrl+S', click: withDoc((doc) => doc.save()) },
        { label: 'Close', accelerator: 'CmdOrCtrl+W', click: withDoc((doc) => doc.win.close()) },
        { type: 'separator' },
        { label: isMac ? 'Reveal in Finder' : 'Show in folder', click: withDoc((doc) => shell.showItemInFolder(doc.filePath)) },
        ...(isMac ? [] : [{ type: 'separator' }, { role: 'quit' }]),
      ],
    },
    { role: 'editMenu' },
    {
      label: 'View',
      submenu: [
        { label: 'Reload', accelerator: 'CmdOrCtrl+R', click: withDoc((doc) => doc.reloadInteractive()) },
        ...(isDev ? [{
          label: 'Developer Tools',
          accelerator: isMac ? 'Alt+Cmd+I' : 'Ctrl+Shift+I',
          click: withDoc((doc) => doc.view.webContents.toggleDevTools()),
        }] : []),
      ],
    },
    { role: 'windowMenu' },
  ];
  return Menu.buildFromTemplate(template);
}

module.exports = { buildMenu };
```

- [ ] **Step 4: Run the end-to-end test to verify it passes**

Run: `npm run smoke`
Expected:

```
[smoke] the document runs hosted, without its own Save button
[smoke] adding a row marks the document dirty
[smoke] saving writes the row into the data block only
[smoke] the previous version is in the version store
[smoke] all checks passed
```

Also run `npm test` (expected `ℹ pass 69`) and `npm run probe` (12 PASS).

- [ ] **Step 5: Check the save loop by hand**

Work on a copy: `cp fixtures/hours-sheet.ev.html /tmp/hours.ev.html && npm start -- /tmp/hours.ev.html`.

1. Add a row. Expected: the title becomes `• hours.ev.html` (on macOS also the dot in the close button).
2. Press Cmd/Ctrl+S. Expected: no dialog; the title loses the `•`. `git diff --no-index fixtures/hours-sheet.ev.html /tmp/hours.ev.html` shows exactly one changed line: the `ev-data` line.
3. Close and reopen the file. Expected: the row is there.
4. Add a row and close the window. Expected: "Do you want to save the changes you made to hours.ev.html?" with Save / Don't save / Cancel. Cancel keeps the window; Don't save closes without writing; Save writes, then closes.
5. Make the write fail: `mkdir -p /tmp/ro && cp fixtures/hours-sheet.ev.html /tmp/ro/hours.ev.html && npm start -- /tmp/ro/hours.ev.html`. Add a row, then run `chmod a-w /tmp/ro` in another terminal and press Cmd/Ctrl+S in the host. Expected: "hours.ev.html could not be saved. The file on disk was not changed." The file is unchanged and the title keeps its `•`. Afterwards run `chmod u+w /tmp/ro`.
6. View → Reload while dirty asks "Reload hours.ev.html and discard your unsaved changes?".
7. The version store: macOS `ls ~/Library/Application\ Support/EverythingApp/versions/*/`, Windows `dir %APPDATA%\EverythingApp\versions`. Expected: one `.html` per save plus `meta.json`.

- [ ] **Step 6: Commit**

```bash
git add src/document-window.js src/menu.js tools/smoke.js
git commit -m "feat(host): save loop, dirty marker and close prompt

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 10: External changes

When the file changes on disk while it is open (an agent improves the behaviour, a sync tool replaces it), the host reacts per section:
- **clean document** → reload automatically;
- **dirty, behaviour changed** → "Save my data and reload / Reload and discard my changes / Later";
- **dirty, data changed** → never overwrite silently: the next save asks "Keep mine / Take the version on disk / Cancel".

After a save that spliced the data into newer behaviour from disk, the clean document reloads to show it. A file that stops conforming keeps running; saving is refused (by `writeDocument`) until it is fixed, and the user sees the report once.

**Files:**
- Modify: `doc-host/src/document-window.js` (replace with the final version)
- Modify: `doc-host/src/open.js:56` (pass the parsed parts)
- Modify: `doc-host/tools/smoke.js` (add the external-change steps)

**Interfaces:**
- Consumes: `sectionHashes`, `classifyChange`, `watchFile` (Task 6); `sha256` (Task 5).
- Produces: `DocumentWindow({ filePath, html, parts, storeDir, registry })` (new `parts` argument) with `known` (section hashes believed on disk), `running` (behaviour hash in the view), `knownFileHash`, `diskDataChanged: boolean`, `onDiskChange()`, `acceptOnDisk(html)`.

- [ ] **Step 1: Extend the end-to-end test**

Replace the whole content of `doc-host/tools/smoke.js` with:

```js
'use strict';

// End-to-end smoke test of the save loop, run as Electron's main script:
//   npm run smoke
// Opens a copy of the hours sheet, adds a row through the UI, saves,
// checks the file on disk, then simulates an agent editing the behaviour.
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const { app } = require('electron');
const { registerSchemePrivileges } = require('../src/protocol');
const { Registry } = require('../src/registry');
const { registerIpc } = require('../src/ipc');
const { openPath } = require('../src/open');
const { checkDocument } = require('../src/conformance');
const { parseDocument, buildDocument } = require('../src/frame');

registerSchemePrivileges();

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function until(label, condition, timeoutMs = 5000) {
  const start = Date.now();
  while (!(await condition())) {
    if (Date.now() - start > timeoutMs) throw new Error(`Timed out waiting for: ${label}`);
    await wait(50);
  }
}

function step(text) {
  console.log(`[smoke] ${text}`);
}

async function run() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ev-smoke-'));
  const filePath = await fs.realpath(dir).then((d) => path.join(d, 'hours.ev.html'));
  const storeDir = path.join(dir, 'store');
  await fs.copyFile(path.join(__dirname, '..', 'fixtures', 'hours-sheet.ev.html'), filePath);
  const original = await fs.readFile(filePath, 'utf8');

  const registry = new Registry();
  registerIpc({ registry, open: (p) => openPath(p, { registry, storeDir }) });
  const doc = await openPath(filePath, { registry, storeDir });
  assert.ok(doc, 'the fixture opens');
  const wc = doc.view.webContents;
  await until('page loaded', () => !wc.isLoading());
  const js = (code) => wc.executeJavaScript(code);

  step('the document runs hosted, without its own Save button');
  assert.equal(await js('!!document.getElementById("add") && !document.getElementById("save")'), true);

  step('adding a row marks the document dirty');
  await js('document.getElementById("add").click()');
  await until('dirty', () => doc.isDirty);
  assert.match(doc.win.getTitle(), /^• hours\.ev\.html$/);

  step('saving writes the row into the data block only');
  assert.equal(await doc.save(), true);
  const saved = await fs.readFile(filePath, 'utf8');
  assert.equal(checkDocument(saved).ok, true);
  const before = parseDocument(original).parts;
  const after = parseDocument(saved).parts;
  assert.deepEqual({ ...after, data: '' }, { ...before, data: '' }, 'everything but the data is unchanged');
  assert.equal(JSON.parse(after.data).rows.length, 1);
  assert.equal(doc.isDirty, false);
  assert.equal(doc.win.getTitle(), 'hours.ev.html');

  step('the previous version is in the version store');
  const [entry] = await fs.readdir(storeDir);
  const versions = (await fs.readdir(path.join(storeDir, entry))).filter((n) => n.endsWith('.html'));
  assert.equal(versions.length, 1);
  assert.equal(await fs.readFile(path.join(storeDir, entry, versions[0]), 'utf8'), original);

  step('an agent changes the behaviour on disk: a clean document reloads');
  const edited = buildDocument({ ...after, style: after.style + 'h1 { color: rgb(200, 0, 0); }\n' });
  await fs.writeFile(filePath, edited, 'utf8');
  await until('reloaded with the new style', async () =>
    !wc.isLoading() && (await js('getComputedStyle(document.querySelector("h1")).color')) === 'rgb(200, 0, 0)');
  assert.equal(await js('document.querySelectorAll("#rows tr").length'), 1, 'the saved row is still there');

  step('a data change on disk while dirty is never overwritten silently');
  await js('document.getElementById("add").click()');
  await until('dirty again', () => doc.isDirty);
  const external = buildDocument({ ...parseDocument(edited).parts, data: '{"rows":[]}' });
  await fs.writeFile(filePath, external, 'utf8');
  await until('conflict detected', () => doc.diskDataChanged);

  step('all checks passed');
}

app.whenReady()
  .then(run)
  .then(() => app.exit(0))
  .catch((err) => {
    console.error('[smoke] FAIL', err);
    app.exit(1);
  });
```

Run: `npm run smoke`
Expected: FAIL with `Timed out waiting for: reloaded with the new style`.

- [ ] **Step 2: Replace the document window with the final version**

Replace the whole content of `doc-host/src/document-window.js` with:

```js
'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { BaseWindow, WebContentsView, session, dialog, clipboard } = require('electron');
const { checkDocument, formatReport } = require('./conformance');
const { validateSnapshot } = require('./validate');
const { writeDocument, sha256 } = require('./write');
const { sectionHashes, classifyChange, watchFile } = require('./watch');
const { serveDocument } = require('./protocol');
const { hardenSession, hardenContents, WEB_PREFERENCES } = require('./security');
const { originFor } = require('./urls');

const SAVE_TIMEOUT_MS = 5000;

// One open document: its window, its sandboxed view, its file on disk.
// The main process owns the path; the document only ever sends data.
class DocumentWindow {
  constructor({ filePath, html, parts, storeDir, registry }) {
    this.filePath = filePath;
    this.name = path.basename(filePath);
    this.storeDir = storeDir;
    this.registry = registry;

    this.html = html;                       // what the protocol handler serves
    this.known = sectionHashes(parts);      // what we believe is on disk
    this.running = this.known.behaviour;    // behaviour running in the view
    this.knownFileHash = sha256(html);

    this.latestChange = 0;                  // highest markDirty() counter seen
    this.savedChange = 0;                   // counter covered by the last write
    this.diskDataChanged = false;
    this.saving = null;
    this.prompting = false;
    this.closeConfirmed = false;
    this.pending = new Map();
    this.requestSeq = 0;

    const id = crypto.randomBytes(16).toString('hex');
    this.origin = originFor(id);
    this.session = session.fromPartition(`ev-doc-${id}`); // no "persist:" = in memory
    hardenSession(this.session, this.origin);
    serveDocument(this.session, this.origin, () => this.html);

    this.win = new BaseWindow({ width: 1100, height: 800, title: this.name });
    this.view = new WebContentsView({
      webPreferences: { ...WEB_PREFERENCES, session: this.session, preload: path.join(__dirname, 'preload.js') },
    });
    this.webContentsId = this.view.webContents.id;
    this.win.contentView.addChildView(this.view);
    this.layout();
    this.win.on('resize', () => this.layout());
    hardenContents(this.view.webContents);

    this.win.on('close', (event) => this.onClose(event));
    this.win.on('closed', () => this.dispose());
    this.watcher = watchFile(filePath, () => this.onDiskChange());
    if (process.platform === 'darwin') this.win.setRepresentedFilename(filePath);

    registry.add(this);
    this.updateTitle();
    this.view.webContents.loadURL(`${this.origin}/`);
  }

  get isDirty() {
    return this.latestChange > this.savedChange;
  }

  layout() {
    const { width, height } = this.win.getContentBounds();
    this.view.setBounds({ x: 0, y: 0, width, height });
  }

  focus() {
    if (this.win.isMinimized()) this.win.restore();
    this.win.focus();
  }

  updateTitle() {
    if (this.win.isDestroyed()) return;
    this.win.setTitle(`${this.isDirty ? '• ' : ''}${this.name}`);
    if (process.platform === 'darwin') this.win.setDocumentEdited(this.isDirty);
  }

  // ---------- IPC from the preload ----------

  onDirty(counter) {
    if (!Number.isSafeInteger(counter) || counter <= this.latestChange) return;
    this.latestChange = counter;
    this.updateTitle();
  }

  onSaveData(payload) {
    if (!payload || typeof payload !== 'object') return;
    const request = this.pending.get(payload.requestId);
    if (!request) return;
    this.pending.delete(payload.requestId);
    clearTimeout(request.timer);
    if (payload.error) request.reject(new Error(String(payload.error)));
    else request.resolve({ json: payload.json, changes: Number(payload.changes) || 0 });
  }

  requestSnapshot() {
    const requestId = ++this.requestSeq;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(requestId);
        reject(new Error('The document did not answer the save request.'));
      }, SAVE_TIMEOUT_MS);
      this.pending.set(requestId, { resolve, reject, timer });
      this.view.webContents.send('doc:request-save', requestId);
    });
  }

  rejectPending(reason) {
    for (const { reject, timer } of this.pending.values()) {
      clearTimeout(timer);
      reject(reason);
    }
    this.pending.clear();
  }

  // ---------- Saving ----------

  save() {
    if (!this.saving) this.saving = this.doSave().finally(() => { this.saving = null; });
    return this.saving;
  }

  async doSave() {
    if (this.diskDataChanged) {
      const choice = await this.ask({
        type: 'warning',
        message: `The data in ${this.name} was changed on disk since you opened it.`,
        detail: 'Keep mine overwrites the data on disk with yours. Take the version on disk discards your changes.',
        buttons: ['Keep mine', 'Take the version on disk', 'Cancel'],
        defaultId: 2,
        cancelId: 2,
      });
      if (choice === null || choice === 2) return false;
      if (choice === 1) return this.reloadFromDisk();
    }
    try {
      const snapshot = await this.requestSnapshot();
      const problem = validateSnapshot(snapshot.json);
      if (problem) throw new Error(problem);
      const written = await writeDocument(this.filePath, snapshot.json, { storeDir: this.storeDir });
      this.acceptOnDisk(written);
      this.diskDataChanged = false;
      this.savedChange = Math.max(this.savedChange, snapshot.changes);
      this.updateTitle();
      // Saving spliced our data into newer behaviour from disk: show it.
      if (this.known.behaviour !== this.running && !this.isDirty) await this.reloadFromDisk();
      return true;
    } catch (err) {
      await this.ask({
        type: 'error',
        message: `${this.name} could not be saved. The file on disk was not changed.`,
        detail: err.message,
        buttons: ['OK'],
      });
      return false;
    }
  }

  acceptOnDisk(html) {
    const check = checkDocument(html);
    this.known = sectionHashes(check.parts);
    this.knownFileHash = sha256(html);
  }

  async reloadFromDisk() {
    let html;
    try {
      html = await fs.readFile(this.filePath, 'utf8');
    } catch (err) {
      await this.ask({ type: 'error', message: `${this.name} could not be read.`, detail: err.message, buttons: ['OK'] });
      return false;
    }
    const check = checkDocument(html);
    if (!check.ok) {
      await this.showReport(check.errors, 'The file on disk no longer follows the document specification. The open version keeps running; saving is refused until the file is fixed.');
      return false;
    }
    this.html = html;
    this.acceptOnDisk(html);
    this.running = this.known.behaviour;
    this.latestChange = 0;
    this.savedChange = 0;
    this.diskDataChanged = false;
    this.rejectPending(new Error('The document was reloaded.'));
    await this.view.webContents.loadURL(`${this.origin}/`);
    this.updateTitle();
    return true;
  }

  // View → Reload
  async reloadInteractive() {
    if (this.isDirty) {
      const choice = await this.ask({
        type: 'question',
        message: `Reload ${this.name} and discard your unsaved changes?`,
        buttons: ['Reload', 'Cancel'],
        defaultId: 1,
        cancelId: 1,
      });
      if (choice !== 0) return;
    }
    await this.reloadFromDisk();
  }

  // ---------- External changes ----------

  async onDiskChange() {
    if (this.saving) await this.saving;
    if (this.win.isDestroyed()) return;
    let html;
    try {
      html = await fs.readFile(this.filePath, 'utf8');
    } catch {
      return; // gone for now (moved, or mid-replace); nothing to compare
    }
    if (sha256(html) === this.knownFileHash) return;
    this.knownFileHash = sha256(html);

    const check = checkDocument(html);
    if (!check.ok) {
      await this.showReport(check.errors, 'The file was changed on disk and no longer follows the document specification. The open version keeps running; saving is refused until the file is fixed.');
      return;
    }
    const onDisk = sectionHashes(check.parts);
    const change = classifyChange(this.known, onDisk);
    if (!change.behaviour && !change.data) return;
    this.known = onDisk;

    if (!this.isDirty) {
      await this.reloadFromDisk();
      return;
    }
    if (change.data) {
      this.diskDataChanged = true; // resolved by the conflict prompt on the next save
      return;
    }
    const choice = await this.ask({
      type: 'info',
      message: `${this.name} was updated on disk.`,
      detail: 'Its behaviour changed (for example, an agent edited it). Your data is unsaved.',
      buttons: ['Save my data and reload', 'Reload and discard my changes', 'Later'],
      defaultId: 0,
      cancelId: 2,
    });
    if (choice === 0) await this.save();
    else if (choice === 1) await this.reloadFromDisk();
  }

  // ---------- Closing ----------

  onClose(event) {
    if (this.closeConfirmed || !this.isDirty) return;
    event.preventDefault();
    this.confirmClose();
  }

  async confirmClose() {
    const choice = await this.ask({
      type: 'question',
      message: `Do you want to save the changes you made to ${this.name}?`,
      detail: "Your changes will be lost if you don't save them.",
      buttons: ['Save', "Don't save", 'Cancel'],
      defaultId: 0,
      cancelId: 2,
    });
    if (choice === 2 || choice === null) return;
    if (choice === 0 && !(await this.save())) return;
    this.closeConfirmed = true;
    this.win.close();
  }

  dispose() {
    this.watcher.close();
    this.rejectPending(new Error('The document was closed.'));
    this.registry.remove(this);
    if (!this.view.webContents.isDestroyed()) this.view.webContents.close();
    this.session.protocol.unhandle('ev-doc');
    this.session.clearStorageData().catch(() => {});
  }

  // ---------- Dialogs ----------

  // One dialog at a time per document. Returns the button index, or null if
  // another dialog was already open.
  async ask(options) {
    if (this.prompting || this.win.isDestroyed()) return null;
    this.prompting = true;
    try {
      const { response } = await dialog.showMessageBox(this.win, options);
      return response;
    } finally {
      this.prompting = false;
    }
  }

  async showReport(errors, intro) {
    const report = formatReport(this.filePath, errors);
    const choice = await this.ask({ type: 'warning', message: intro, detail: report, buttons: ['Copy report', 'OK'], defaultId: 1 });
    if (choice === 0) clipboard.writeText(report);
  }
}

module.exports = { DocumentWindow };
```

- [ ] **Step 3: Pass the parsed parts when opening**

In `doc-host/src/open.js`, replace

```js
  return new DocumentWindow({ filePath, html, storeDir, registry });
```

with

```js
  return new DocumentWindow({ filePath, html, parts: check.parts, storeDir, registry });
```

- [ ] **Step 4: Run all checks**

Run: `npm run smoke`
Expected: the five lines from Task 9, then

```
[smoke] an agent changes the behaviour on disk: a clean document reloads
[smoke] a data change on disk while dirty is never overwritten silently
[smoke] all checks passed
```

Run: `npm test` (expected `ℹ pass 69`) and `npm run probe` (12 PASS).

- [ ] **Step 5: Check external changes by hand**

`cp fixtures/hours-sheet.ev.html /tmp/hours.ev.html && npm start -- /tmp/hours.ev.html`, then edit `/tmp/hours.ev.html` in a text editor while the host shows it:

1. Clean document: change `<h1>Hours sheet</h1>` in the script section to `<h1>Hours</h1>` and save the file. Expected: the window reloads by itself and shows "Hours".
2. Dirty document, behaviour edit: add a row in the host (title shows `•`), then change the heading again in the editor. Expected: "hours.ev.html was updated on disk." with three buttons. "Save my data and reload" keeps your row and shows the new heading.
3. Dirty document, data edit: add a row in the host, then in the editor replace the `ev-data` content with `{"rows":[]}` and save. Nothing happens yet. Press Cmd/Ctrl+S in the host. Expected: "The data in hours.ev.html was changed on disk since you opened it." Keep mine writes your rows; Take the version on disk reloads with no rows; Cancel does nothing.
4. Breaking edit: save in the host first (clean title). In the editor, add a line `<!-- x -->` before the **last** `</body>` (the one near the end of the file) and save. Expected: one warning with the report ("…no longer follows the document specification…"). Cmd/Ctrl+S in the host shows "could not be saved", and the file keeps the edit. Remove the line again and save the file: Cmd/Ctrl+S in the host works again.
5. Save in the host several times in a row. Expected: no external-change dialog appears (the host recognises its own writes by content hash).

- [ ] **Step 6: Commit**

```bash
git add src/document-window.js src/open.js tools/smoke.js
git commit -m "feat(host): react to external changes per section

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 11: Acceptance walk-through

Walk through the user story's acceptance criteria in `firstSpec.md` and record the evidence. Two criteria depend on later milestones; record them as such instead of faking them.

**Files:**
- Modify: `firstSpec.md` (section "User story", acceptance criteria)

- [ ] **Step 1: Run every automated check**

From `doc-host/`:

```bash
npm test && npm run probe && npm run smoke
```

Expected: `ℹ pass 69`, 12 probe PASS lines, `[smoke] all checks passed`; exit code 0.

- [ ] **Step 2: Check each criterion**

| Criterion | Evidence in M1 |
| --- | --- |
| Double-clicking a document (or dropping it on the host) opens it and selects it in the document list | Partly: drag and drop and command line work (Task 8). Double-click needs the file association (M3); the document list comes with M2. |
| Renders exactly as in Chrome | Open `fixtures/hours-sheet.ev.html` in the host and in Chrome side by side; identical apart from the Save button and status line, which the host replaces. |
| Ctrl/Cmd+S and File → Save write without a dialog; no Save button in the host | Task 9, step 5.1–5.2; smoke test. |
| After saving, reopening shows the new rows | Task 9, step 5.3. |
| Saving changes only the data block | Smoke test ("everything but the data is unchanged"); `test/write.test.js`. |
| Closing with unsaved changes asks Save / Don't save / Cancel | Task 9, step 5.4. |
| A failed write leaves the original intact and shows an error | Task 9, step 5.5; `test/write.test.js`. |
| Any conforming document works without host changes | The escape probe and the hours sheet share no code with the host; a third document assembled from new sources (try one) opens and saves. |

- [ ] **Step 3: Record the result in the spec**

In `firstSpec.md`, tick (`- [x]`) every criterion with full evidence in M1. Leave the first criterion unticked and append ` *(M1: drag and drop and command line; double-click with M3, document list with M2)*` to it.

- [ ] **Step 4: Commit**

From the repository root:

```bash
git add firstSpec.md
git commit -m "docs: record M1 acceptance results

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

## Known limits of M1 (by design)

- One document per window; the document list and thumbnails come with M2.
- Dialogs instead of banners for external changes (the host has no UI of its own until M2).
- On macOS, Cmd+Q with a dirty document shows the close prompt but does not resume quitting after you answer; quit again.
- Sessions of closed documents are cleared but stay registered in Electron until the app quits.
- No file association, installers, auto-update or version-store clean-up (M3).
