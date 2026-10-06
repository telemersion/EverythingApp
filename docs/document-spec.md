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
2. **Self-contained.** No external scripts, stylesheets, fonts or images. Inline everything; embed assets as `data:` URIs. Inside the host, every network request is blocked: no name lookups, no WebRTC, and every connection is refused.
3. **Runtime UI.** The script section renders all UI into `#ev-app` at load time. `#ev-app` is empty in the saved file.
4. **The host owns saving.** When `window.evHost` exists, the document shows no Save button and registers neither a Ctrl/Cmd+S handler nor `beforeunload`. The kit follows this on its side: it registers its own Ctrl/Cmd+S and `beforeunload` handlers only when `evHost` is absent. The document's own UI must follow it too: show a Save button and status line only when `doc.hosted` is `false` (section 5). *Why:* inside the host a Save button would do nothing (`save()` returns `false`), and the host ignores `beforeunload` (it cannot block closing). So this rule is about a consistent UI, not about safety.
5. **UTF-8, LF only, no BOM.** The file must be valid UTF-8; the host refuses files in any other encoding (such as Latin-1 or Windows-1252). *Why:* the HTML parser turns CRLF into LF inside `<style>` and `<script>`. The kit's fallback rebuilds the file from that parsed text, so a CRLF file would change bytes outside the data block on its first browser save.
6. **No storage between sessions.** Inside the host, `localStorage`, IndexedDB and cookies start empty on every open. View state (filters, scroll position) lasts one session. Anything that should survive belongs in the data block.
7. **No navigation, no new windows.** Links that navigate away, `window.open` and form submissions are blocked. Iframes and frames cannot load anything (the content security policy refuses it) and, inside the host, receive no pointer input.
8. **Files come in only through the user.** Inside the host, a document can receive files only through routes the user controls: a file picker (`<input type="file">`), paste and, in one case, a drop (below). It never sees file paths. Dropping files onto a document opens them in the host; the document does not receive the dropped files. Known limit of M1: a document that calls `document.open()` once its own parsing is done removes the host's drop guard and can then receive files the user drops onto it (their contents, not their paths). Do not drop files onto a document you do not trust. Whatever a document imports lives in the data block (images as `data:` URIs). The data block is limited to 50 MB, and every save copies the whole file into the version store, so keep imports small.

## 4. The data block

- Contains exactly one JSON **object** (not an array, not `null`).
- Every `<` is written as `\u003c`, so data can never close its script element. `JSON.stringify` output followed by `.replace(/</g, '\\u003c')` satisfies this; the kit and the host do it for you.
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

In a browser, the kit also saves on Ctrl/Cmd+S and warns before leaving the page with unsaved changes. Inside the host it registers neither.

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
| `encoding` | The file is not valid UTF-8. Nothing else is checked. |
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

The host also refuses files larger than 60 MB, and data blocks larger than 50 MB are not saved.

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
