# EverythingApp document specification v1

Status: normative · Host API v1 · Kit 2.0.0 · from EverythingApp 0.2.0

This specification defines what an EverythingApp document is and how it talks to the host. It is the contract for everyone who writes documents: people, Claude, and the future skill. A document works with EverythingApp exactly when it follows this specification. Terms are defined in the [glossary](reference/glossary.md).

EverythingApp 0.2.0 amended this version in place: it added the document id, the manifest and modules, and changed the data design rules. Documents written for 0.1.0 (kits 1.0.0 and 1.1.0) are no longer accepted. From 0.2.0 on, the host never breaks a document that conforms to this specification.

## 1. What a document is

A document is a single HTML file that carries its own data and renders its own editor. It consists of a fixed **frame** and four **sections**:

| Section | Element | Written by | Contains |
| --- | --- | --- | --- |
| Style | `<style id="ev-style">` | Generator or agent | All CSS |
| Manifest | `<script type="application/json" id="ev-manifest">` | Generator or agent | What the host must know without running the document (section 5) |
| Data | `<script type="application/json" id="ev-data">` | Host (and the browser fallback) | The data block: one JSON object |
| Script | `<script id="ev-script">` | Generator or agent | All JavaScript; renders the UI into `#ev-app` |

The frame also contains the **kit** (`<script id="ev-kit">`), a script published with this specification, and the **modules** the document uses (section 6). The kit loads the data, connects to the host and implements the browser fallback. Documents use the kit and the modules and never change them.

**Behaviour** is the style, manifest and script sections together. Behaviour is cheap to replace; the data block is what the user cares about.

## 2. The frame

Every document is exactly this text, with the `{placeholders}` filled in. Nothing may be added, removed or reformatted: no extra elements, attributes, comments, whitespace or line breaks outside the placeholders.

```text
<!DOCTYPE html>
<html lang="{lang}">
<head>
  <meta charset="utf-8">
  <meta name="ev-host-api" content="{api}">
  <meta name="ev-doc-type" content="{docType}" data-version="{docTypeVersion}">
  <meta name="ev-doc-id" content="{docId}">
  <title>{title}</title>
  <style id="ev-style">{style}</style>
  <script type="application/json" id="ev-manifest">{manifest}</script>
</head>
<body>
  <div id="ev-app"></div>
  <script type="application/json" id="ev-data">{data}</script>
  <script id="ev-kit" data-kit-version="{kitVersion}">{kit}</script>
{modules}  <script id="ev-script">{script}</script>
</body>
</html>
```

The file ends with a single line break after `</html>`. `{modules}` is empty or one line per module, sorted by module name:

```text
  <script id="ev-module-{moduleName}" data-module-version="{moduleVersion}">{moduleText}</script>
```

| Placeholder | Rule | Example |
| --- | --- | --- |
| `lang` | Language tag | `en`, `de-CH` |
| `api` | Host API version the document needs; `1` for this specification | `1` |
| `docType` | Kind of document: lowercase words joined by `-` | `hours-sheet` |
| `docTypeVersion` | Version of this document type's behaviour | `1.0` |
| `docId` | Empty, or exactly 32 lowercase hex characters (section 3, rule 10) | `3f2a09c1d4e5b6789a0b1c2d3e4f5a6b` |
| `title` | Plain text without `<`, `&` or line breaks | `Hours sheet` |
| `style` | CSS; must not contain `</style` | |
| `manifest` | The manifest (section 5) | `{}` |
| `data` | The data block (section 4) | `{"rows":{}}` |
| `kitVersion` | Version of the published kit in `kit` | `2.0.0` |
| `kit` | The exact text of that published kit | |
| `moduleName` | Name of a published module: lowercase words joined by `-`; each name at most once | `codemirror` |
| `moduleVersion` | Version of that published module | `1.0.0` |
| `moduleText` | The exact text of that published module version | |
| `script` | JavaScript; must not contain `</script` or `<!--` | |

## 3. Rules

1. **Namespace.** Every name defined by this specification starts with `ev`: `ev-` for meta names and element ids, `ev` for JavaScript globals (`window.evHost`, `EvKit`). The script section must not define names with this prefix.
2. **Self-contained.** No external scripts, stylesheets, fonts or images. Inline everything; embed assets as `data:` URIs. Third-party code comes only as published modules (section 6). Inside the host, every network request is blocked: no name lookups, no WebRTC, and every connection is refused.
3. **Runtime UI.** The script section renders all UI into `#ev-app` at load time. `#ev-app` is empty in the saved file.
4. **The host owns saving.** When `window.evHost` exists, the document registers neither a Ctrl/Cmd+S handler nor `beforeunload`, and shows no working Save button. Mark the Save button `data-ev-fallback="save"` and the save status `data-ev-fallback="status"`: the kit hides both inside the host, and in a browser saves on the button and keeps the status text (`Saved` / `Unsaved changes`) and `data-ev-state` (`saved` / `unsaved`) current. Render them once and keep them in the page; style them with `[data-ev-state]`. *Why:* inside the host a Save button would do nothing (`save()` returns `false`), and the host ignores `beforeunload` (it cannot block closing).
5. **UTF-8, LF only, no BOM.** The file must be valid UTF-8; the host refuses files in any other encoding (such as Latin-1 or Windows-1252). *Why:* the HTML parser turns CRLF into LF inside `<style>` and `<script>`. The kit's fallback rebuilds the file from that parsed text, so a CRLF file would change bytes outside the data block on its first browser save.
6. **No storage between sessions.** Inside the host, `localStorage`, IndexedDB and cookies start empty on every open. View state (filters, scroll position, sort order) lasts one session. Anything that should survive belongs in the data block.
7. **No navigation, no new windows.** Links that navigate away, `window.open` and form submissions are blocked. Iframes and frames cannot load anything (the content security policy refuses it) and, inside the host, receive no pointer input.
8. **Files come in only through the user.** Inside the host, a document can receive files only through routes the user controls: a file picker (`<input type="file">`), paste and, in one case, a drop (below). It never sees file paths. Dropping files onto a document opens them in the host; the document does not receive the dropped files. Known limit: a document that calls `document.open()` once its own parsing is done removes the host's drop guard and then receives files the user drops onto it (their contents, not their paths). Do not drop files onto a document you do not trust. Whatever a document imports lives in the data block (images as `data:` URIs). The data block is limited to 50 MB, and every save copies the whole file into the version store, so keep imports small.
9. **No native dialogs.** Inside the host `alert()` does nothing, `confirm()` returns `false`, and `prompt()` throws (`prompt() is not supported.`). Ask for confirmation inside your own UI. *Why:* Electron shows these dialogs as native message boxes that look like the host's own, name no document and can be raised from a hidden tab; it offers no way to show them anywhere else, so the host turns them off (ADR 0001).
10. **Document id.** Files with the same document id are copies of the same document. A new document has an empty id: never invent one, and when you make a new document from an existing file, empty its id. Inside the host, the host assigns an id when it opens a document without one and writes it with the first save; in a browser, the kit does so on the first save. An agent that changes a document's behaviour keeps its id.

## 4. The data block

- Contains exactly one JSON **object** (not an array, not `null`).
- Every `<` is written as `<`, so data can never close its script element. `JSON.stringify` output followed by `.replace(/</g, '\\u003c')` satisfies this; the kit and the host do it for you.
- The shape of the object is up to the document type. Document it in a comment at the top of the script section, for example:

  ```js
  // Data shape: {"rows":{"<id>":{"date":"YYYY-MM-DD","person":"","task":"","hours":0,"note":""}}}
  ```

- An empty document starts with an empty object or empty collections (e.g. `{"rows":{}}`) and must render usefully.

### Designing data for merging

Copies of a document will merge, change by change, when teams share them. The host compares saved data, so the shape of the data decides how well concurrent changes merge. Follow these rules in every document; the host does not check them, and a document that breaks them still works, but merges worse. The reasons are in [ADR 0006](adr/0006-lists-are-maps-keyed-by-id.md).

1. **Items live under stable ids.** Every item in a list lives under an id key, created once with `EvKit.newId()` and never reused. The id is the key only; do not repeat it inside the item.
2. **A list of items is an object keyed by id, never an array.** Arrays are only for small lists of plain values that change as a whole (tags, a coordinate pair).
3. **Order lives in a sort key.** Where the user orders items by hand, each item has a string sort key (by convention `order`), made with `EvKit.orderBetween(before, after)`. A move changes only the moved item's key. List items with `EvKit.ordered(map)`.
4. **Store nothing derived.** Totals, counts and sums are computed by the script. Sorting by date or name is a view: sort for display, never store the sorted order.
5. **No counters as plain numbers.** Record entries and let the script count them.
6. **One fact in one place.**
7. **Split long text into items** (paragraphs, a note per row), so edits to different items merge. Declare free text that people edit as a text field (section 5); edit longer text with the `codemirror` module.
8. **Keep what you do not know.** Keep every field the script does not know, and write it back unchanged.
9. **Name fields as identifiers**: letters, digits and `_`, not starting with a digit, so text-field paths can name them.
10. **Deleting removes.** Delete an item by removing its key; do not mark it deleted. The history keeps what was deleted.

```json
{"rows":{
  "a3f09c21d4e5b678":{"date":"2026-10-10","person":"Anna","task":"Spec","hours":2,"note":"Call with the client"},
  "0b7e4d2c9a1f3e56":{"date":"2026-10-09","person":"Ben","task":"Kit","hours":3.5,"note":""}
}}
```

Strings merge as whole values: if two people change the same field, one value wins. Only the text fields declared in the manifest merge per character.

## 5. The manifest

The manifest declares what the host must know about the behaviour without running the document. It is part of the behaviour, written by the generator, and always present.

- Contains exactly one JSON object with only the keys below; `{}` when there is nothing to declare.
- Every `<` is written as `<`, as in the data block.

| Key | Type | Meaning |
| --- | --- | --- |
| `textFields` | Array of unique path patterns (optional) | The string fields of the data block that merge per character. |

A **path pattern** is a list of segments joined by `.`. Each segment is either `*`, which matches any array item or any object key, or a field name made of letters, digits and `_` that does not start with a digit. A pattern that reaches no string has no effect.

```json
{"textFields":["rows.*.note","intro"]}
```

The host refuses a document whose manifest has an unknown key, a value of the wrong type or an invalid pattern (section 9). New keys come with a new host API version.

## 6. Modules

A module is third-party code (such as the CodeMirror editor) published with the kit, so that a document can use it without loading anything from the network. A document carries every module it uses, each as the exact published text, checked by hash like the kit ([ADR 0003](adr/0003-modules-published-with-the-kit.md)). Modules run after the kit and before the script section.

| Module | Version | Contains | Size |
| --- | --- | --- | --- |
| `codemirror` | `1.0.0` | `EditorState`, `EditorView`, `keymap`, `history`, `defaultKeymap`, `historyKeymap` from CodeMirror 6 (`@codemirror/state`, `view`, `commands`) | about 270 KB |

The script section reaches a module through the kit, naming the major version it was written for:

```js
const { EditorState, EditorView, keymap, history, defaultKeymap, historyKeymap } = EvKit.module('codemirror', 1);
const editor = new EditorView({
  parent: noteElement,
  state: EditorState.create({
    doc: row.note,
    extensions: [history(), keymap.of([...defaultKeymap, ...historyKeymap]), EditorView.lineWrapping,
      EditorView.updateListener.of((u) => { if (u.docChanged) { row.note = u.state.doc.toString(); doc.changed(); } })],
  }),
});
```

Module versions follow semantic versioning. A newer minor or patch version keeps the interface: the host will offer it like a kit update, after the user confirms. A new major version changes the interface, so a document gets it only with a behaviour change.

The first line of every module text names the module, its upstream packages and their versions, and the build script that reproduces it (`doc-host/modules/build.js`).

## 7. The kit interface (kit 2.0.0)

The kit runs before the modules and the script section and defines `window.EvKit`.

```js
const doc = EvKit.init();
const data = doc.data;        // the parsed data block; change it in place
// … render into document.getElementById('ev-app') …
doc.changed();                // call after every change to data
```

```html
<!-- The kit hides both inside the host and wires them in a browser. -->
<button data-ev-fallback="save">Save</button>
<span data-ev-fallback="status"></span>
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
| `hosted` | `true` inside EverythingApp, `false` in a plain browser. |
| `changed()` | Reports a change to the data. Inside the host it marks the document dirty; in a browser it updates the fallback's dirty state. |
| `save()` | Browser only: saves through the fallback and returns a promise of `true` (saved) or `false` (cancelled or failed). Inside the host it does nothing and returns `false`. |
| `toHtml()` | The complete document text with the current data, exactly as a save would write it. |

Functions of `EvKit` itself:

| Function | Meaning |
| --- | --- |
| `EvKit.version` | `'2.0.0'` (a property). |
| `EvKit.newId()` | A new item id: 16 random lowercase hex characters. |
| `EvKit.orderBetween(before, after)` | A sort key that sorts strictly between `before` and `after`; either may be `null` for "first" or "last". Sort keys are non-empty strings of `0`–`9`, `A`–`Z` and `a`–`z`, compared as plain strings. Throws if `before` does not sort before `after`. |
| `EvKit.ordered(map, key = 'order')` | The entries of `map` as an array of `[id, item]` pairs, sorted by the string in `item[key]`; equal keys by id, items without a key last, by id. |
| `EvKit.module(name, major)` | The exports of the module `name`. Throws an error naming the module if the document does not carry it, or carries a different major version. |
| `EvKit.defineModule(name, version, exports)` | Used only by module texts to register themselves. |

In a browser, the kit also saves on Ctrl/Cmd+S and warns before leaving the page with unsaved changes. Inside the host it registers neither.

## 8. Host API v1 (`window.evHost`)

Documents normally use the kit and never touch `evHost` directly. For reference:

| Member | Signature | Meaning |
| --- | --- | --- |
| `version` | `number` | `1` |
| `onSaveRequest` | `(handler: () => string) => void` | Registers the function the host calls when the user saves (menu, Ctrl/Cmd+S, close prompt). It returns the data as a JSON string. |
| `markDirty` | `() => void` | Signals that the data changed since the last save. |

The host decides when to save. The document never starts a write, never sees its file path and can never write its own behaviour. The API is data-only in every version.

## 9. Browser fallback

Outside the host, the kit saves a new copy of the whole file. It rebuilds the file from the frame, the original section and module texts and the current data, so a browser save produces exactly the bytes a host save would. On the first save of a document with an empty id, it fills in a new id and keeps it for the rest of the session.

| Browser | Mechanism | Experience |
| --- | --- | --- |
| Chrome, Edge | File System Access API; the file handle is remembered per page address | Pick the file once; afterwards at most an "Allow editing" prompt per session |
| Firefox, Safari | Download | A new copy lands in Downloads; replace the original with it |

## 10. Conformance

The host checks every file before opening it and refuses any file that breaks this specification. The refusal lists every problem, offers a "Copy report" button (paste the report to an agent to fix the file) and points to opening the file in Chrome, where the fallback still works.

| Code | Problem |
| --- | --- |
| `encoding` | The file is not valid UTF-8. Nothing else is checked. |
| `bom` | The file starts with a byte order mark. |
| `line-endings` | The file contains CR characters. |
| `api-missing` | `<meta name="ev-host-api">` is missing. |
| `api-invalid` | `ev-host-api` is not a positive whole number. |
| `api-newer` | The document needs a newer host. Nothing else is checked. |
| `frame` | The text differs from the frame (section 2). The report shows the line, the expected text and the text found. |
| `field` | A placeholder value breaks its rule (section 2), such as a document id that is not 32 lowercase hex characters. |
| `kit-unknown` | `data-kit-version` names no published kit. |
| `kit-modified` | The kit text differs from the published kit. |
| `kit-api` | The kit belongs to a different API version. |
| `manifest-escape` | The manifest contains a raw `<`. |
| `manifest-json` | The manifest is not valid JSON, or not a JSON object. |
| `manifest-key` | The manifest has a key this specification does not define. |
| `manifest-invalid` | A manifest value is of the wrong type, or a path pattern is invalid or repeated. |
| `module-unknown` | A module line names no published module or module version. |
| `module-modified` | A module text differs from the published module. |
| `module-order` | The module lines are not sorted by name, or name a module twice. |
| `data-escape` | The data block contains a raw `<`. |
| `data-json` | The data block is not valid JSON. |
| `data-shape` | The data block is not a JSON object. |
| `script-comment` | The script section contains `<!--`. |

The host also refuses files larger than 60 MB, and data blocks larger than 50 MB are not saved.

A file is treated as a document if and only if it contains `<meta name="ev-host-api"`, whatever its file name. Naming documents `<name>.ev.html` is recommended.

## 11. Writing a document

The reliable way is to write the sections separately and assemble them, which inserts the current kit and the modules verbatim:

```text
doc-host/fixtures/src/<name>/
  meta.json      {"lang":"en","title":"…","docType":"…","docTypeVersion":"1.0"}
                 (optional "modules": ["codemirror"]; optional "kitVersion" pins
                 an older kit, for tests only: the test kit 1.9.0 needs
                 EV_TEST_KITS=1)
  style.css
  manifest.json  {} or {"textFields":[…]}
  script.js
  data.json
```

```text
cd doc-host
npm run assemble -- fixtures/src/<name> <output>.ev.html
```

`doc-host/fixtures/src/hours-sheet/` is the reference example.

Recommendations for generators:

- Keep behaviour readable, not minified, so a person can see what a generated document does.
- Keep the data shape flat, follow "Designing data for merging" (section 4) and document the shape at the top of the script section.
- Render an empty data block gracefully.
- Leave the document id empty in a new document.
- Never write `</script`, `</style` or `<!--` inside a section; write `<\/script` in JavaScript strings.
