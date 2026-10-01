# Compatibility and concurrency boundary

## Existing data and links

The new client reads `lists/<listId>/<itemKey>` and `listAttrs/<listId>/listName`. Existing numeric item keys, numeric `ID`, boolean `checked`, string `name`, Firebase `.priority`, and epoch-second `lastMod` are supported without rewriting stored lists. Legacy links keep their case. Generated links now have six cryptographically random characters, per the user’s digital Post-it preference. Atomic claims detect collisions and retry; custom and longer legacy links remain usable. Knowing or guessing a link grants edit access, as accepted for non-sensitive notes.

New items use UUID-derived random keys and string `ID`. These do not collide through the old `max(ID)+1` pattern. Add retries reuse the same key and preserve an already-present item. Item edits/checks/reorders transact only that item; deletion requires the current checked state (already absent is an idempotent success) and stale edits cannot recreate it. Title edits are last-writer-wins. Changes to distinct item fields survive concurrent transactions. Simultaneous changes to the same field are last-committed-writer-wins, not collaborative text merging.

Ordering now preserves null, numeric and string Firebase priorities, sorted in that order. Equal priorities use Firebase's signed 32-bit integer-key ordering (leading-zero ties by length), then raw UTF-16 string ordering. The store retains each snapshot's original priority type/value. Representative emulator fixtures compare the new order directly with Firebase snapshot iteration and prove that reads, edits and checks preserve priorities, IDs and untouched values.

A move changes only the moved item's priority. It selects a numeric or string value that actually sorts into the requested slot, including mixed-priority boundaries; append stays below existing string priorities. Some slots (for example, before a null-priority item whose key sorts earlier) cannot be represented without changing other items. Those moves fail clearly without silently renumbering neighbors. A full ranking migration remains deferred. The UI supplies mouse/touch drag handles plus keyboard Up/Down/Home/End controls. These synthetic fixtures do not replace the full private production-data preservation rehearsal in [the readiness checkpoint](deployment.md#go-live-readiness-checkpoint--2026-10-01).

## Old open clients are not safe concurrent writers

The 2014 client still saves whole lists and calculates numeric IDs. It can overwrite new edits or omit modern string IDs. Reading old data is supported; mixed old/new writers are **not safe**. This branch must not go live until a release plan addresses existing open clients: a compatible bridge or a coordinated cutover with an explicit refresh/version boundary, plus a tested backup/restore path. Merely replacing static assets does not terminate old tabs. Rules that reject old writes need separate approval and a clear user recovery path; do not tighten production rules blindly.

## Offline, errors, and preview limits

Firebase transactions are acknowledged by the selected isolated backend before the UI says saved. While disconnected, pending changes remain in memory and retry on reconnect. Closing/reloading/crashing may lose those writes; the UI warns and installs an unload prompt for unsaved work. Failed writes are retained for explicit retry or dismissal. Permission-denied tests exercise rules; no production permissions are inferred from emulator success.

Browser-local previews use append-only operations and deletion tombstones; storage errors are surfaced. This is a demo store, not a cloud database or backup. Different browser origins/device profiles are separate. Operation logs grow until the preview origin's storage is cleared. Preview data from the first development baseline is intentionally isolated from the new schema.

## Before shared cloud previews

Approve a dedicated non-production Firebase project/database, its owner and region, synthetic-only data, an appropriate billing/spend limit, and explicit unauthenticated shared-link rules with validation. Approve adding only its public client configuration to the preview build and updating CSP for that exact test endpoint. No admin key belongs in a browser or repository. Review abuse protection and enumeration risk before enabling a public writable service. None of these resources, rules, credentials, or access changes were created in this phase.

The approved `qlist-staging` project is now wired only into the review build. This adds no production migration or data compatibility claim. Production list titles, text, IDs, checked states, order/priority metadata and URLs remain explicit preservation requirements for a separately approved cutover.
