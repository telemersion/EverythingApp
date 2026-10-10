# Lists of items are maps keyed by id, ordered by string sort keys

Status: accepted (2026-10-10, format groundwork)

The host turns each save into changes by comparing JSON snapshots, and Automerge lists have no move. The spike before the format groundwork showed what that does to an array of rows with ids: when one member moves a row while another edits it, the edit is lost; when two members move the same row, it appears twice under one id. A map keyed by id, with the order in a sort key on the item, merged every case correctly. We decided that the data design rules require this shape: a list of items is a JSON object keyed by item id (`EvKit.newId()`), the id lives only in the key, and where order matters each item carries a string sort key made with `EvKit.orderBetween(a, b)`. Arrays are for small lists of plain values that change as a whole. Sorting for display (by date, by name) is a view and is not stored.

## Considered options

- **Arrays of items with an `id` field, allowed where the user never reorders.** Insert, delete and edit merge fine, but the generator has to judge whether reordering will ever come, and a later behaviour with drag and drop needs a data migration.
- **The rules as recommendations only.** Generators would follow them as far as they think sensible, and the merge quality of every document would depend on that judgement.
- **An `id` field inside each item as well as the key.** Convenient for `Object.values`, but a duplicated fact; a script that copies an item and forgets the inner id creates an inconsistency nothing checks.
- **Number sort keys.** Simpler, but a float runs out of precision after about 50 inserts at the same place; string keys between neighbours never do.

## Consequences

- Scripts iterate `EvKit.ordered(map)` (pairs of id and item, sorted by sort key with the id as a tie-breaker) instead of an array.
- Moving an item changes only that item's sort key, so a move and a concurrent edit of the same item both survive.
- The host does not enforce the rules: a document whose data breaks them still opens and saves; it merges worse once collaboration exists.
