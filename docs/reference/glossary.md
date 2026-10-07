# Ubiquitous Language

## System

| Term | Definition | Aliases to avoid |
| --- | --- | --- |
| **EverythingApp** | The whole system: the Host, the Document specification and the Skill together. | The app, the host (when meaning the whole) |

## Documents

| Term | Definition | Aliases to avoid |
| --- | --- | --- |
| **Document** | A single self-contained HTML file that carries its own data and renders its own editor. | App, page, template, file (when meaning the document) |
| **Frame** | The fixed HTML skeleton defined by the Document specification, identical in every document apart from a few frame fields. | Template, boilerplate, wrapper |
| **Kit** | The spec-defined script inside the frame that loads the data, connects to the host and provides the fallback save. | Library, runtime, helper, SDK |
| **Outdated kit** | A published kit that is not the newest published kit for the document's host-API version. | Old kit, stale kit |
| **Kit update** | Replacing a document's outdated kit with the newest published kit for its host-API version, after the User confirms; the data block and the behaviour stay as they are. | Upgrade (reserved for template upgrade), migration |
| **Section** | One of the three named parts of a document inside the frame: style, data or script. | Block (except in "data block"), part, region |
| **Data block** | The data section: the one embedded JSON content that holds the user's data. | Payload, state, model |
| **Behaviour** | The style and script sections of a document together. | Code, template, UI |
| **Document type** | The named kind of document (e.g. hours sheet) together with the version of its behaviour. | Template, kind |
| **Claimed document** | A file that contains the host-API declaration (`<meta name="ev-host-api">`), whatever its name, and therefore must pass the conformance check. | Candidate, document-like file |
| **Fixture** | A hand-checked sample document used to test the host. | Example, sample |

## Host and contract

| Term | Definition | Aliases to avoid |
| --- | --- | --- |
| **Host** | The desktop application that opens documents, runs them sandboxed and saves them in place. | App, viewer, runtime, shell |
| **Document specification** | The normative contract describing what a valid document contains and how it talks to the host. | Spec (ambiguous with the product spec), schema, format |
| **Host API** | The small, versioned interface the host exposes to a running document. | Bridge, SDK |
| **Fallback** | The way a document saves itself when no host is present. | Browser mode, offline mode |
| **Conformance check** | The host's validation of a file against the document specification when it is opened. | Validation, lint |
| **Privilege** | A capability beyond the sandbox (e.g. import by drop, network to one origin) that a document may request and only the User can grant; designed in a later milestone. | Permission (when meaning the document-level concept), capability, right |

## Workspace

| Term | Definition | Aliases to avoid |
| --- | --- | --- |
| **Workspace** | The host's single window: the document list and the panes that show the open documents. | Window (when meaning the whole), session, project |
| **Pane** | One area of the workspace's split document area, with its own tab strip; it shows one of its documents at a time. | Viewport (that is a page's visible area), split, tab group, editor group |
| **Tab** | The entry of one open document in its pane's tab strip. | — |
| **Document list** | The collapsible side list of all open documents, grouped by pane, shown as a compact list or as thumbnails. | Sidebar, file list, explorer |
| **Active document** | The document shown in the focused pane; the menu commands (Save, Close, Reload) act on it. | Current document, selected document |
| **Banner** | A host message about one document, shown in its pane between the tab strip and the document, never over the document. | Notification, toast, infobar, alert |
| **Badge** | A small host marker on a document's tab and list entry for a state that needs attention, such as a conflict, a missing file or an outdated kit. | Flag, indicator, icon |
| **Close summary** | The one prompt shown when the workspace closes while several documents have unsaved changes: Save all, Review each, Cancel. | Quit dialog |

## People and tooling

| Term | Definition | Aliases to avoid |
| --- | --- | --- |
| **User** | The single person who opens and edits documents in the host (v0.1). | Team member, author |
| **Skill** | The Claude skill that generates documents conforming to the document specification. | Generator, prompt |

## Relationships

- A **Document** consists of one **Frame** and exactly three **Sections**: style, data (the **Data block**) and script.
- **Behaviour** = style section + script section; the **Frame** is not behaviour.
- The **Kit** belongs to the **Frame**, not to any **Section**; it is identical in every **Document** with the same **Host API** version.
- The **Host** writes the **Data block**, and the **Kit** only when the **User** confirms a kit update; generators and agents write only the **Behaviour**.
- A **Document** declares exactly one **Document type** and one **Host API** version.
- The **Host** opens a **Document** only after it passes the **Conformance check**.
- A **Document** uses the **Fallback** only when no **Host** is present.
- A **Document** has no **Privileges** unless the **User** grants them; the **Host** never grants one on its own.
- The **Skill** produces **Documents** that conform to the **Document specification**.
- **EverythingApp** consists of exactly one **Host**, one **Document specification** and one **Skill**.
- A **Document** "works with **EverythingApp**" exactly when it conforms to the **Document specification**.
- The **Host** has exactly one **Workspace** (v0.1); it holds one **Document list** and one or more **Panes**.
- An open **Document** is open exactly once: it has exactly one **Tab**, in exactly one **Pane**, and one entry in the **Document list**.
- A **Pane** shows one of its **Documents** at a time; the **Active document** is the one shown in the focused **Pane**.

## Example dialogue

> **Dev:** "When the **User** presses Save, does the **Host** write the whole **Document** back?"
> **Domain expert:** "No. The **Host** only replaces the **Data block**; the **Behaviour** stays byte-identical."
> **Dev:** "And if the **Document type** gets a new **Behaviour** version later?"
> **Domain expert:** "Then the old **Data block** is carried over into the new **Behaviour**. Data outlives behaviour."
> **Dev:** "What if the file is opened in a plain browser?"
> **Domain expert:** "Then there is no **Host**, and the **Document** saves through its **Fallback**."

## Flagged ambiguities

- "team member" (user story) vs. single-user scope: resolved. v0.1 targets one **User**; team use is an explicit later goal.
- "EverythingApp" was used without definition: resolved as the umbrella name for the whole system, not a synonym for **Host**.
- "Claimed document" was once defined by the `.ev.html` name as well: resolved. Only the content (the host-API declaration) makes a file a claimed document; the file name never does.
- "spec" was used both for the product spec (`firstSpec.md`) and for the **Document specification**: use "Document specification" for the contract; call the product document the "product spec".
