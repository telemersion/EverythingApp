# A manifest section declares what the host must know without running the document

Status: accepted (2026-10-10, format groundwork)

The host must know which string fields merge per character (text fields), and it syncs closed copies too, so it must read that declaration without running the document. The declaration describes how the behaviour's data merges, so a maintainer's approval must cover it. We decided that every document has a fourth section, the **manifest**: `<script type="application/json" id="ev-manifest">` in `<head>` after the style, always present (`{}` when empty), written by the generator and part of the behaviour. The host checks it strictly: only the keys the document specification defines for the document's API version, with valid values. New keys come with a new API version, so an older host says "needs a newer EverythingApp" instead of silently ignoring them.

## Considered options

- **A frame meta line** (`<meta name="ev-text-fields" content="rows.*.note">`). Minimal, but frame fields are not behaviour, so an approval would not cover a change that alters how data merges.
- **A runtime call** (`EvKit.init({ textFields })`). The host would learn the declaration only while the document runs, not for the closed copies it syncs.
- **A structured comment in the script section.** No format change, but the host would parse JavaScript comments, which is fragile for the host and for generators.

## Consequences

- A document has four sections (style, manifest, data, script), and behaviour is style + manifest + script.
- The manifest is the place for later static declarations, such as the privileges M4 may let a document request, without deciding M4 now.
- A typo in a key (`textfields`) refuses the document on open with a report an agent can act on, instead of a field that quietly merges as a whole value.
