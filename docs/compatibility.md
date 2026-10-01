# Compatibility and concurrency boundary

## Existing data and links

The new client reads `lists/<listId>/<itemKey>` and `listAttrs/<listId>/listName`. Existing numeric item keys, numeric `ID`, boolean `checked`, string `name`, Firebase `.priority`, and epoch-second `lastMod` are supported without rewriting stored lists. Legacy links keep their case. New links have 144 random bits; existing six-character links remain weaker bearer capabilities and are not silently rotated.

New items use 128-bit random keys and string `ID`. These do not collide through the old `max(ID)+1` pattern. Add retries reuse the same key and preserve an already-present item. Item edits/checks/reorders transact only that item; deletion is idempotent and stale edits cannot recreate it. Title edits are last-writer-wins. Changes to distinct item fields survive concurrent transactions. Simultaneous changes to the same field are last-committed-writer-wins, not collaborative text merging.

Ordering preserves numeric Firebase priorities. A move computes a midpoint and changes only the moved item's priority. Equal priorities have a stable key tiebreak. If a midpoint cannot be represented, the UI reports it instead of rewriting the entire list. A full fractional-ranking migration is deferred. The UI supplies keyboard/touch up/down controls rather than drag-only controls.

## Old open clients are not safe concurrent writers

The 2014 client still saves whole lists and calculates numeric IDs. It can overwrite new edits or omit modern string IDs. Reading old data is supported; mixed old/new writers are **not safe**. This branch must not go live until a release plan addresses existing open clients: a compatible bridge or a coordinated cutover with an explicit refresh/version boundary, plus a tested backup/restore path. Merely replacing static assets does not terminate old tabs. Rules that reject old writes need separate approval and a clear user recovery path; do not tighten production rules blindly.

## Offline, errors, and preview limits

Firebase transactions are acknowledged by the emulator before the UI says saved. While disconnected, pending changes remain in memory and retry on reconnect. Closing/reloading/crashing may lose those writes; the UI warns and installs an unload prompt for unsaved work. Failed writes are retained for explicit retry or dismissal. Permission-denied tests exercise rules; no production permissions are inferred from emulator success.

Browser-local previews use append-only operations and deletion tombstones; storage errors are surfaced. This is a demo store, not a cloud database or backup. Different browser origins/device profiles are separate. Operation logs grow until the preview origin's storage is cleared. Preview data from the first development baseline is intentionally isolated from the new schema.

## Before shared cloud previews

Approve a dedicated non-production Firebase project/database, its owner and region, synthetic-only data, an appropriate billing/spend limit, and explicit unauthenticated shared-link rules with validation. Approve adding only its public client configuration to the preview build and updating CSP for that exact test endpoint. No admin key belongs in a browser or repository. Review abuse protection and enumeration risk before enabling a public writable service. None of these resources, rules, credentials, or access changes were created in this phase.
