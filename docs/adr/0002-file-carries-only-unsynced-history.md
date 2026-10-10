# A copy's file carries only the history the team server does not have yet

Status: accepted (2026-10-10, collaboration design)

Copies of a document merge through their common history: without it the host cannot tell "Ben added row 7" from "Anna deleted row 7". We decided that a copy's file carries exactly the part of the history the team server does not have yet. Before a document is first shared, that is the whole history, so two copies that travelled on a USB stick still merge correctly without any server. Right after a confirmed sync it is nothing, and the file is pristine again: the JSON snapshot in the data block plus a marker for its point in history. A member editing offline carries only the tail since the last sync. The host trims the file only after the team server confirms it stored the changes, and keeps the synced history in a cache of its own, keyed by document id.

## Considered options

- **The whole history always in the file.** Every copy merges with every other copy however it travelled, but the file grows with its past, and emailing it sends everything ever deleted.
- **History only in the host and on the team server.** Small files, but two copies handed over offline cannot merge until both have synced, so "copies merge whenever they meet" would depend on how the file travelled.
- **Server-side history with an "Export with history" command.** Flexible, but the merge breaks whenever someone picks the wrong export.

## Consequences

- The team server is the archive. Losing it loses the history before the last sync, never the data: the data block stays readable in any browser.
- Two copies that both start from a synced point merge only where the shared history is available, on the team server or in a host's cache.
- Opening a pristine file on a machine with no cache and no connection is the hard case for the CRDT library. It is on the list of technical tests before the format is fixed; the fallback is to record such edits as data changes and convert them once the history is available.
- The host writes a third part of the file besides the data block and the kit: the unsynced history.
