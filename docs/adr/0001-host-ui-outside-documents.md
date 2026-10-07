# Host UI lives outside every document

Status: accepted (2026-10-07, M2 design round)

Documents are untrusted code, and from M2 on the host has UI of its own: the document list, tab strips, banners, the kit update offer, and in M4 the prompts that grant privileges. We decided that everything the host tells or asks the user appears only in host areas that no document can draw into, and that documents cannot show native dialogs at all. The host UI is one view beneath the document views; each document view covers exactly its own pane rectangle; banners sit in a row between a pane's tab strip and its document and push the document down instead of overlapping it. The host-UI view and the document views talk to the main process on separate channels (`ui:*`, `doc:*`), and the main process tells them apart by the sending view, never by anything in the message.

Native dialogs are turned off with `webPreferences.disableDialogs`, so `alert()` does nothing and `confirm()` returns `false`. Electron shows them as native message boxes titled with the app's name: they look exactly like host dialogs, name no document, block the whole workspace and can be raised from a hidden tab. Electron offers no hook to catch them and show them in a host area instead; the only alternatives are leaving them on or rate-limiting them (`safeDialogs`), and neither makes them attributable.

## Considered options

- **Keep `alert` / `confirm`, rate-limited (`safeDialogs`).** Existing habits keep working, but a document can still imitate a host prompt, which M4's privilege prompts cannot tolerate.
- **Host UI drawn as overlays on top of documents.** Simpler layout, but then a document's own pixels and the host's sit in the same place, and the user cannot tell which is which.

## Consequences

- A generated document that writes `if (confirm('Delete row?'))` silently never deletes. The document specification forbids native dialogs, and the skill must generate confirmations inside the document's own UI. A host-drawn `evHost.confirm(message)`, shown in the banner row and labelled with the file name, is a later item.
- Dragging a tab onto a pane's edge crosses a document view; during a tab drag the host-UI view is raised above the documents with a transparent background, and lowered again afterwards.
- Fullscreen stays denied (the permission handler refuses every permission), so a document can never cover the host UI.
