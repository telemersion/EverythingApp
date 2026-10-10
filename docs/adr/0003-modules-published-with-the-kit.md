# Third-party code comes as modules published with the kit, inserted in every file on disk

Status: accepted (2026-10-10, collaboration design)

Documents are self-contained and have no network access, so a behaviour that wants CodeMirror cannot load it from a CDN, and an LLM cannot reliably write hundreds of kilobytes of minified code into the script section. We decided that third-party code comes as **modules**: curated by the host project, published with the kit and pinned by hash exactly like the kit. A document names the modules it uses; the assemble tool inserts their published text, and the conformance check verifies the hashes. The team server stores and syncs copies without the module text, and the host inserts the modules whenever it writes a file to disk; the team server's Download copy delivers the full file too. So every file on any disk works in a browser on its own, however it got there.

## Considered options

- **The LLM writes the library into the script section.** Self-contained, but unreliable to generate, unverifiable, and indistinguishable from altered code.
- **The host serves modules at runtime.** Small files, but a document no longer works in a plain browser, which breaks the fallback.
- **Synced copies on disk without modules, inserted only on Export or Download.** Smallest files, but a copy that leaves through Finder or email is not exported, and the recipient gets a page that does not render. Unlike a file without its history (ADR 0002), a file without its modules does not degrade gracefully.

## Consequences

- The frame gains module slots: a new kit version and document specification release (the format groundwork after M3).
- Module updates are offered like kit updates; the host keeps every published module version, as it keeps every published kit.
- Modules become part of what the conformance check, signatures and a hash-pinned CSP cover; the behaviour uses them but never changes them.
- Files on disk are a few hundred kilobytes larger per module; sync traffic and server storage are not.
