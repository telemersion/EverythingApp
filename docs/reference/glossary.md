# Ubiquitous Language

## System

| Term | Definition | Aliases to avoid |
| --- | --- | --- |
| **EverythingApp** | The whole system: the Host, the Document specification and the Skill together, plus the Team server for teams. | The app, the host (when meaning the whole) |

## Documents

| Term | Definition | Aliases to avoid |
| --- | --- | --- |
| **Document** | A self-contained HTML document that carries its own data and renders its own editor, identified by its document id wherever its copies are. | App, page, template, file (when meaning the document) |
| **Document id** | The stable identity of a document; files with the same document id are the same document. | Path (a copy's location, not its identity), URL, link |
| **Copy** | One file that holds a document; copies of one document may be at different points of its history. | Replica, clone, instance, duplicate (when meaning a new document) |
| **History** | The record of every change to a document: data saves, behaviour versions with their approvals, and kit and module updates; who changed what, and when. Copies merge through their common history. | Undo stack, log, versions (the version store keeps files, not history) |
| **Unsynced history** | The part of a document's history the team server does not have yet; a copy's file carries exactly this part. | Pending changes, local changes, outbox |
| **Save note** | A short message a member attaches to a save; it labels that save in the history. | Commit message, comment (that is about content), annotation |
| **Draft** | A branch of a document whose saves stay out of the shared history until a member merges it back. Planned after the first collaborative version. | Fork (a new document), copy, version |
| **Frame** | The fixed HTML skeleton defined by the Document specification, identical in every document apart from a few frame fields. | Template, boilerplate, wrapper |
| **Kit** | The spec-defined script inside the frame that loads the data, connects to the host and provides the fallback save. | Library, runtime, helper, SDK |
| **Module** | A third-party script (e.g. CodeMirror) curated and published with the kit, pinned by hash like the kit, that a document's behaviour may use. | Plugin, library (that is the host's list of copies), dependency, package |
| **Outdated kit** | A published kit that is not the newest published kit for the document's host-API version. | Old kit, stale kit |
| **Kit update** | Replacing a document's outdated kit with the newest published kit for its host-API version, after the User confirms; the data block and the behaviour stay as they are. | Upgrade (reserved for template upgrade), migration |
| **Section** | One of the three named parts of a document inside the frame: style, data or script. | Block (except in "data block"), part, region |
| **Data block** | The data section: the one embedded JSON content that holds the user's data. | Payload, state, model |
| **Behaviour** | The style and script sections of a document together. | Code, template, UI |
| **View** | One way a document's behaviour presents its data (e.g. "Edit", "Monthly report"); a document may offer several. | Tool, editor (that is the whole behaviour), lens, page |
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
| **Library** | The host's list of every copy it knows about, open or not, in two tabs: This computer (the member's copies, arranged in groups) and Team (the team folders on the team server). | Repository list, catalogue, recent files |
| **Group** | A folder-like container in the Library's This computer tab that arranges copies for this member only; independent of team folders and of where the files are on disk. | Folder (on disk or on the team server), tag, collection |
| **Close summary** | The one prompt shown when the workspace closes while several documents have unsaved changes: Save all, Review each, Cancel. | Quit dialog |
| **Notice** | A host message about the whole workspace rather than one document (such as documents that could not be restored, or a host update that is ready), shown at the top of the document list until dismissed. | Banner (that is about one document), toast, notification |

## Distribution

| Term | Definition | Aliases to avoid |
| --- | --- | --- |
| **Release** | One published, signed version of the Host that people install or update to, numbered by milestone (0.1.0 at the end of M3). | Build, version (alone: documents and kits have versions too) |
| **Host update** | Replacing the installed Host with a newer release: downloaded in the background, installed when the Host quits. | Upgrade (reserved for template upgrade), kit update (that changes a document) |
| **Version store** | The Host's private folder of earlier versions of each document file, kept before every write. | Backups, history (that is the collaboration record), versions folder |
| **Orphaned store entry** | The version store's entries for a file that is gone from its path on a volume that is reachable; deleted after 90 days. | Orphan (alone), revoked copy (that is a member's file) |

## Collaboration

| Term | Definition | Aliases to avoid |
| --- | --- | --- |
| **Team** | A small group of people who know and trust each other and share documents through one team server. | Organisation, workspace (that is the host window), group |
| **Member** | A User who belongs to a team. | Team member (fine in prose), collaborator, participant |
| **Team server** | The server a team controls that keeps its documents' history in sync and gives each document a document URL. | Cloud, backend, relay, sync server |
| **Document URL** | The team server's web address for a document, derived from its document id; opens the document in the host, or read-only in a browser. | Link (the document id is the identity; the URL is only an address), share link |
| **Access type** | A team-defined class of documents (e.g. Invoice, Contract) that team roles are assigned to; set on the team server when a document is shared, suggested from its document type. Root covers all documents; None covers documents given no access type. | Doctype, document type (that is the frame's behaviour label), category |
| **Role** | What a member may do with a document: Reader, Editor or Maintainer. | Permission, access right, privilege (that is a document's capability) |
| **Reader** | A role: opens the document, gets copies and sees its history; the member's changes do not sync. | Viewer, guest |
| **Editor** | A role: a reader who also changes data and may make behaviour proposals. | Writer, contributor |
| **Maintainer** | A role: an editor who also approves behaviour changes. | Admin, owner, reviewer |
| **Behaviour proposal** | A behaviour change made by a member who is not a maintainer; it runs only in that member's own copy until a maintainer approves it. | Pull request, suggestion, patch |
| **Approval** | A maintainer's signature over one version of a document's behaviour; hosts run shared behaviour only when it carries a valid approval. | Accept, merge, sign-off |
| **Revoked copy** | A copy whose member has lost access to the document; it stays on disk, the team server no longer syncs it, and the member decides whether to move it to the Trash. | Orphan, deleted copy, locked copy |
| **Device key** | The key pair a host creates for one member on one device and registers with the team server; it signs that member's approvals from that device. | Account key, member key, password |
| **Invitation** | A Root maintainer's offer to join a team; accepting it creates the member's account on the team server and the first device key. | Share link, access request |
| **Team folder** | A folder on the team server for ordering and finding the team's documents; administrative only, independent of where a member keeps their copy. | Directory, project, path |

## People and tooling

| Term | Definition | Aliases to avoid |
| --- | --- | --- |
| **User** | The person who opens and edits documents in their own host. | Author, account |
| **Workbench** | A separate tab where a document's behaviour is developed: the draft behaviour runs on a private copy of the data that never syncs and never reaches the member's copy. Ends with Propose, Approve and publish, or Apply. | Sandbox (that is the renderer isolation), draft (that merges data back), test mode |
| **Agent connector** | The host's interface for AI agents on the member's computer, used to develop behaviour in a workbench. | Bridge, host API (that is for documents), plugin |
| **Skill** | The Claude skill that generates documents conforming to the document specification. | Generator, prompt |

## Relationships

- A **Document** consists of one **Frame** and exactly three **Sections**: style, data (the **Data block**) and script.
- A **Document** has exactly one **Document id** and one or more **Copies**; copying a file never creates a new **Document**.
- **Behaviour** = style section + script section; the **Frame** is not behaviour.
- The **Kit** belongs to the **Frame**, not to any **Section**; it is identical in every **Document** with the same **Host API** version.
- A **View** is part of the **Behaviour** and shows only its own **Document**'s data; adding one is a behaviour change. Reading another document's data would be a **Privilege**.
- **Modules** come with the **Kit** and follow its rules: only published, hash-pinned **Modules**; the **Behaviour** uses them but never changes them.
- The **Host** writes the **Data block** and the **Unsynced history**. It writes the **Kit**, **Modules** or **Behaviour** only to install a version the **User** confirmed or that carries an **Approval**; it never creates or changes behaviour itself. Generators and agents write only the **Behaviour**, and in a shared document only in a **Workbench**.
- In the **History**, data changes merge; **Behaviour**, **Kit** and **Module** changes are whole versions that replace each other and never merge.
- Looking back in the **History** shows a past moment through the **Behaviour** of that time while its **Approval** is still valid, otherwise through today's **Behaviour**, always read-only.
- Every save becomes part of the **History** and reaches the **Team** as soon as the **Host** is online; a **Save note** is optional. Only a **Draft** holds saves back.
- Data merges, behaviour is approved: **Data block** changes merge on their own; a **Behaviour** change reaches other **Members** only with an **Approval**. A **Maintainer**'s own change counts as approved.
- The **Team server** checks every change against the **Member**'s role; each **Host** checks the **Approval** before it runs shared **Behaviour**, so the team server alone cannot make anyone run code.
- A **Member** holds **Roles** on a **Document** directly, through its **Access type** and through Root; the roles only add up, the highest one counts, and there are no exclusions. The **Document type** never decides access; changing a document's **Access type** needs **Maintainer** on both the old and the new one.
- A **Member** has one account on the **Team server** and one **Device key** per device. How a member signs in is the team server's concern; the **Device keys** are the host's.
- An **Approval** counts only while its signer is a **Maintainer**. When a **Maintainer** leaves or their key is removed, their **Approvals** end; copies keep running the **Behaviour** they already have, and the remaining **Maintainers** re-approve.
- An agent works through the **Agent connector** only inside a **Workbench**; it never reads or changes a **Copy**, and only a person clicks Propose, Approve and publish or Apply.
- Root **Maintainers** manage the **Team**: **Members**, **Access types** and team **Roles**. Every role change is kept in the team's history, visible to every **Member**.
- The **Host** never deletes or removes a **Copy** without the **Member**'s consent, whatever the **Team server** says. This is a hard rule.
- When access is revoked, the **Copy** becomes a **Revoked copy**: the **Member** either moves it to the Trash or keeps it, cut off from the **Document**'s future **History**. The **Team** is not notified; people sort out mistakes themselves.
- The **Document list** shows the open **Documents**; the **Library** shows every **Copy** the **Host** knows about, open or not.
- A **Copy** is in at most one **Group**; **Groups** nest, and arranging them never moves a file or changes a **Team folder**.
- A **Document** is shared with at most one **Team**; another team gets a new document made from it, with its own **Document id**.
- The **Team server** can read the documents it keeps (it builds their read-only browser views); there is no end-to-end encryption in the first collaborative version.
- Where a **Member** keeps a **Copy** is independent of the **Document**'s **Team folder**; the **Document id** connects them.
- A **Copy** carries all of its **Document**'s **History** until the document is first synced, and afterwards only its **Unsynced history**; losing the team server loses past **History**, never the **Data block**.
- A **Document** declares exactly one **Document type** and one **Host API** version.
- The **Host** opens a **Document** only after it passes the **Conformance check**.
- A **Document** uses the **Fallback** only when no **Host** is present.
- A **Document** has no **Privileges** unless the **User** grants them; the **Host** never grants one on its own.
- The **Skill** produces **Documents** that conform to the **Document specification**.
- **EverythingApp** consists of exactly one **Host**, one **Document specification** and one **Skill**; a **Team** adds one **Team server**.
- A **Document** "works with **EverythingApp**" exactly when it conforms to the **Document specification**.
- The **Host** has exactly one **Workspace**; it holds one **Document list** and one or more **Panes**.
- An open **Document** is open exactly once: it has exactly one **Tab**, in exactly one **Pane**, and one entry in the **Document list**.
- A **Pane** shows one of its **Documents** at a time; the **Active document** is the one shown in the focused **Pane**.
- A **Host update** never changes a **Document**; a **Kit update** never changes the **Host**.
- The **Version store** never deletes a document's newest version; entries on a volume that is not mounted are left alone and never become **Orphaned store entries**.

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
- "doctype" was used for the team's access classes, colliding with the frame's **Document type** (2026-10-10): resolved. Team roles attach to an **Access type**; the **Document type** only suggests it.
- "link" was used for the document's identity, not a web address (2026-10-10): resolved. The **Document id** is the identity across all copies; a **Document URL** is the team server's address for it.
- "team member" was out of scope for v0.1 (single **User**); with collaboration a **Member** is a **User** who belongs to a **Team**.
- "Document" meant the file itself until collaboration was designed (2026-10-10): resolved. A **Document** is identified by its **Document id**; each file is one **Copy** of it.
- "update" has three meanings (2026-10-10): **Host update** (a new release of the host), **Kit update** (a document's kit) and, with collaboration, module updates. Always qualify it; "update" alone is ambiguous.
- "orphaned" was used for version-store entries while "orphan" is an alias to avoid for **Revoked copy** (2026-10-10): resolved. Say **Orphaned store entry** for the version store; a member's file cut off from a team is a **Revoked copy**.
- "spec" was used both for the product spec (`firstSpec.md`) and for the **Document specification**: use "Document specification" for the contract; call the product document the "product spec".
