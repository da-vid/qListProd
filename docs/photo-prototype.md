# qList photo prototype — local review

**Current status — October 3, 2026:** the isolated hosted synthetic continuation passed all four remaining cases, with zero residual charges/objects. The browser UI is still a local mock; production photos are disabled. See [the current selected-list beta plan](photo-selected-list-beta-plan.md) and its linked acceptance evidence. Material below describes earlier stages and must not be treated as pending setup, permission to rerun a trial, or permission to enable public photos. Existing expiry is unchanged.


This records the first local stage. See [the current storage-trial plan](photo-storage-trial-plan.md) for verified hosted v4 evidence and subsequent local safeguards.

Worktree: `qList-photo-prototype`; branch: `codex/photo-prototype`; base: `c7b163aacbf71422ac5774703072c6141b8101d4`.

This is a local experiment, with a working mock UI and a separate image-processing benchmark. It does not provision Supabase, publish to Netlify, modify Firebase, or contain account credentials. All included images are programmatically generated gradients/noise. The ordinary qList build does not import the photo feature.

## Try it

With the existing Node 24 toolchain, run `npm run dev:photos` and open <http://127.0.0.1:4174/photos.html>. The server binds only to loopback. Both `/` and `/PhotoDemo` reopen the photo entry in this mode. Add a synthetic text item, select **Add photo**, then **Try synthetic image**. Test preview/cancel/save, thumbnail expansion, replacement and removal. The service selector can simulate offline, paused, quota, rate-limit and timeout failures; **Retry photos** retries pending cleanup and reloads photo associations.

Only the synthetic `PhotoDemo` list is enabled. Text uses the existing browser-local store; photo bytes and associations exist only in this tab's memory and disappear on reload. No user image is included in the repository. Camera/library inputs are present for future manual verification, but automated checks use synthetic fixtures only. JPEG is the only supported format; HEIC/PNG are intentionally rejected at this stage.

## Implemented and verified

- Browser preparation checks JPEG dimensions before decode (10 MiB source, 24 million pixels, maximum edge 8192), applies browser orientation, resizes to an edge of at most 1280, and canvas-encodes JPEG plus a thumbnail of at most 192 pixels. Full output is capped at 384 KiB; thumbnail at 32 KiB. These are prototype limits.
- The independent server-processing lab accepts baseline JPEGs up to 512 KiB and 1280 pixels, strips all APP/comment segments before decoding, rejects decoder warnings, reencodes, strips metadata again and produces a thumbnail. Oversized, malformed, corrupted and excessive-dimension inputs fail closed. A noisy fixture is rejected when its output exceeds the size cap.
- The mock adapter stores photo associations separately by item key. Its quota reservation occurs before asynchronous validation; old objects remain accounted during replacement. Version checks reject stale writes/removals. Failed physical cleanup continues to count against quota. No automatic expiry removes a retained photo.
- The UI handles preview cancellation, late preparation, object-URL cleanup, separate photo errors, bounded request timeouts and orphan cleanup retries. Photo state is never added to a text item or its persistence operations. A failed photo cleanup cannot restore a deleted text item.
- Tests exercise real built text add/edit/check/delete across all five injected photo failures, plus races for the last available quota, stale versions, cancellation and cleanup failure. DOM tests also cover photo save/replace/remove/expand and cancelling a late preview.

Latest verification: 34 existing tests and 17 photo tests passed; TypeScript, both preview builds and the normal release build passed. Read-only HTTP checks returned 200 for `/`, `/PhotoDemo` and `/photos.html`; each served the photo entry. Static inspection confirmed photo code and assets are absent from the normal preview/release bundles.

Commands: `npm run check`, `npm run build:photos`, `npm run test:photos`. `node scripts/build-release.mjs modern` validates a normal release build without publishing. The prototype's root dependencies reuse the previously installed sibling checkout through a local ignored symlink; do not install through that symlink. The separately pinned processing dependency is installed in `photo-lab` with lifecycle scripts disabled.

## Benchmark result and limits

`photo-lab/results/benchmark.json` records twelve calls for each of three synthetic JPEGs, in separate Node processes, using `@imagemagick/magick-wasm` 0.0.44. On this ARM64 Mac with Node 24.21.0: peak process RSS **171.34 MiB**, slowest cold call **225.68 ms CPU**, warm p95 **67.81 ms CPU**. Smooth gradient/portrait fixtures produce full images and thumbnails; the noisy fixture is an intentional size-limit rejection. The WASM file is **15,447,097 bytes**.

These are local measurements, not hosted Supabase measurements. They do not establish deployed Deno memory accounting, cold-start overhead, production concurrency, or worst-case hostile input behavior. Real camera selection, iPhone EXIF orientation, browser canvas quality, keyboard/screen-reader behavior and visual mobile layout still need browser/device checks. No supported browser-observation tool was available in this session.

Supabase currently documents 256 MB memory, 2 seconds of CPU per request, a 20 MB locally bundled function limit and a 5 MB server-side bundling limit. Static WASM packaging needs the CLI/Docker path rather than the API path. The measured WASM is larger than the latter limit; deployability must be verified, not assumed. Docker and Deno were not installed or used here. [Official function limits](https://supabase.com/docs/guides/functions/limits)

## Proposed hosted boundary — not implemented

Use a dedicated **Free** Supabase organization/project for all photo metadata, counters, processing, storage and cleanup. Keep qList text on its existing infrastructure. No photo data or counters go to Firebase Blaze; no image proxy, functions or transformation service is added to Netlify. The browser sends JPEG bytes directly to the photo gateway and fetches short-lived signed image URLs directly from Supabase. There is no paid fallback or automatic upgrade.

Supabase's Free plan is the billing boundary: its documentation says Free-plan usage is not charged. A Pro spend cap is a different mechanism and does not cover every charge category. If free capacity or availability is exhausted, photos stop working while text remains usable. [Official cost controls](https://supabase.com/docs/guides/platform/cost-control)

Free projects can be paused after seven days of low activity, and downloadable database backups are unavailable on Free. We do not promise photo availability or automatic recovery. Before real images are retained, agree on a manual export/restore path and test it. Database exports alone would not back up image objects. [Official availability guidance](https://supabase.com/docs/guides/deployment/going-into-prod)

The private bucket and photo tables should deny direct anonymous read/write/list operations. Only a reviewed gateway can write objects/metadata and mint short-lived read URLs. Store its privileged credential server-side only. Storage RLS controls direct access; privileged service credentials must never reach the browser. [Official storage access control](https://supabase.com/docs/guides/storage/security/access-control)

The gateway must have **no Firebase credentials, SDK, reads or calls**. The browser joins photo associations to existing item keys locally; list text is never sent to the photo service. For a hosted trial, use an explicitly allowlisted synthetic list and a separate high-entropy shared photo capability, stored as a hash server-side. This is bearer access, not proof of individual ownership or of ownership of an anonymous qList. Never treat an anonymous Supabase identity, a browser-supplied item ID or CORS as ownership. Do not silently issue capabilities for arbitrary list IDs. Capability delivery, loss and collaboration behavior require review before enabling real lists.

### Transaction and cleanup design to implement before a hosted trial

1. Deny unapproved lists; validate capability, request shape, advertised and streamed body size, and rate limits before decoding. Bound counters/log retention as well as bytes. Allow only one decode at a time per worker because the WASM heap and resource limits are shared; reject excess work rather than accumulating an unbounded queue. Bound project-wide concurrency through database reservations.
2. In one PostgreSQL transaction, lock the global budget row followed by the allowlisted-list budget row (`SELECT ... FOR UPDATE`, fixed lock order). Check `used + reserved + 416 KiB <= configured cap`, active-photo count and request rate; atomically create a unique reservation and increment reserved capacity. Set conservative caps below the dashboard's verified Free allowances. Start the synthetic hosted trial with a 10 MiB application storage cap, two concurrent reservations and at most 100 accepted uploads per day, not the full free allocation.
3. Persist an idempotency key scoped to the capability/list, a content digest, expected version and operation status. Exact retries return the same operation/result and allocate no additional capacity; key reuse with a different request fails. Quota checking, reservation and idempotency acquisition must occur in the same transaction. A timeout response is not proof of a failed commit: query operation status before retrying or claiming cancellation succeeded.
4. Decode and reencode without keeping the original. Write full/thumbnail objects under fresh random immutable keys with upsert disabled. Do not expose them before commit. Persist object keys and sizes against the reservation so a crash leaves discoverable cleanup work.
5. In a second transaction, verify reservation state and compare-and-swap the current item-photo version. Commit new metadata, convert reserved to actual bytes, and enqueue superseded objects for deletion. Old objects remain counted until deletion is verified. Stale-version losers enqueue their staged objects instead of overwriting newer photos.
6. Cleanup uses leased jobs and an idempotent delete/finalize transaction. Release bytes only after deletion is confirmed. An expired reservation is fenced so its worker cannot later commit; fence staged uploads and verify their state before reclaiming capacity. Reconcile object inventory and metadata after interrupted writes. The gateway must not rely on a background task finishing after its HTTP response.
7. User removal marks the association deleted and queues only the corresponding object versions. Text deletion succeeds independently and the browser retries photo cleanup. Since the gateway cannot read Firebase, it cannot independently discover every deleted text item; failed/lost client cleanup can leave charged-against-quota orphans. Provide an explicit review/cleanup route without inventing a retained-photo TTL. Never delete current photos to make room silently.
8. Rate limits, bytes and signed-URL issuance controls reduce abuse but cannot guarantee an exact egress ceiling: a signed URL can be replayed until expiry. Keep URLs short-lived; Free-plan service restriction is the final billing boundary. No fallback, paid transformations or paid protection service should be introduced to preserve availability.

Only the single-process reservation/version/accounting model is executable here. PostgreSQL transactions, durable idempotency, capabilities, private storage, signed URLs, egress controls, cross-worker limits and durable cleanup are **designs, not implemented or verified integrations**. The mock accepts preprepared JPEGs; it does not pretend to run the server sanitizer in the browser.

## Exact next setup scope for approval

Before a hosted benchmark, the user must approve creating or selecting a **dedicated Supabase Free organization and one isolated photo trial project**, choosing its account and region, and accepting any required service terms through their account. Do not attach it to a paid organization, enter a payment method, start a paid trial, upgrade, or enable billable add-ons. If Free is unavailable, stop.

Then authorize login through the official Supabase CLI and secure local credential storage, plus installation/use of the official CLI and a suitable local Docker runtime after their versions and terms are reviewed. Do not ask the user to paste tokens into chat; use the supported login flow. Account/terms acceptance may require the user's own UI interaction.

Once that access and tooling exist, prepare and review the actual Deno gateway, transactional schema, restrictive RLS/private bucket, operation-status endpoint and cleanup implementation before creating those resources. Approval for the isolated hosted trial should cover deployment of those reviewed resources and **synthetic-only** benchmark uploads, with the small caps above. Verify no-charge plan settings and test cold/warm runtime, concurrent admission, malformed input, timeout-after-commit, failed upload/cleanup recovery and policy denial. Report measured deployed bundle size and memory/CPU, not just this Mac result.

Enabling real lists, changing production CSP/About copy, retaining real photos and releasing the feature remain a later explicit scope. Nothing from this prototype has been deployed or pushed to GitHub.
