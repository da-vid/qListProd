# Selected-list photo beta — next integration plan

Status: design only, after hosted synthetic acceptance on October 3, 2026. No real-photo enablement, new credentials, public access, auth relaxation, production deployment or test-expiry extension is included. Keep Netlify and Firebase text infrastructure. The existing admin trial remains closed to further batches and expires October 4; it is not a browser upload API.

## What is now proved

The reviewed continuation at `977a803010ae8426aecc33b9ca0f2e36544d158b` passed all four hosted cases: partial upload cleanup, deletion before writer acknowledgment, noise rejection and actual streamed oversize rejection. Final counters are nine historical operations, six items, six reads/2,359,296 accounted bytes, zero used/reserved/current/pending, original batch blocked, continuation complete. Old physical history/receipts match the prior evidence; Storage API inventory is empty. See [acceptance summary](../photo-lab/storage-trial/phase-b/hosted-acceptance.json).

Measured one-run CPU 754 ms, wall 10,386 ms, boot 54 ms, shutdown `EarlyDrop`; reported memory 17,923,228 bytes is a snapshot, not proven peak. This is synthetic acceptance, not worst-case real-image, concurrency, public-auth or production acceptance. No new unauthenticated negative request was made in this hosted run.

## Local batch progress

The browser normalization and mock gateway subset is now complete; see [local acceptance and limitations](photo-local-normalization.md). The original scope below remains a plan for remaining real-device and authorization/durability work. No access model, fake-grant authorization system or hosted beta was implemented.

## Original first-batch scope: local only

1. Define the real upload contract separately from `PreparedPhoto`/the in-memory mock. Browser sends one normalized JPEG (maximum 512 KiB, baseline 8-bit, maximum edge 1280); server independently validates/reencodes and creates authoritative full/thumbnail outputs (384 KiB/32 KiB, thumbnail edge 192). Do not accept browser-supplied output hashes/thumbnail proofs as server validation. Keep an offline adapter so UI work requires no credentials or hosted access.
2. Adapt `src/photo/prepare.ts` to return a validated normalized input plus local preview. Existing code accepts JPEG source up to 10 MiB/24 MP/8192 edge, orients with `createImageBitmap`, resizes, and produces two canvas blobs for the mock. It currently rejects HEIC/PNG before decoding. Verify encoded MIME, JPEG markers/baseline, dimensions and actual byte count; canvas quality is not a byte-size guarantee. Use bounded quality/downscale attempts and a clear rejection when the budget cannot be met. Preview the normalized image; server output may differ slightly after sanitization.
3. Add real-browser/device fixtures for JPEG baseline/progressive, EXIF rotations/mirroring, portrait and large phone photos, metadata stripping, empty/spoofed MIME, malformed input, cancellation and repeated selection. Confirm iPhone camera/library and Android camera/library behavior instead of assuming the file input converts formats. Keep production builds free of photo code until separately enabled.
4. Prepare a local gateway/auth contract and database tests with fake grants for exactly one selected list; no remote endpoint, actual grant/token or new key. Exercise read/write/delete/status, wrong-list/key rejection, revoked grant, replay, concurrent quota races and direct bucket access denial. Draft the exact permissions/migration/release delta for review.

Completion of this batch produces a reviewable local UI/API contract and phone compatibility report, not a beta deployment.

## Access decision before a client-facing service

Current production source (`qListProd` at `c7b163aacbf71422ac5774703072c6141b8101d4`) uses anonymous link-addressed Firebase v2 lists. `production/database.rules.json` validates paths/items and the writes switch but does not require `auth`; list claims reserve names, not owners. Therefore a list URL, arbitrary item ID, CORS or anonymous identity cannot establish private-photo ownership.

Recommended initial beta: one explicitly allowlisted list and invited testers, with independently revocable photo access. A shared high-entropy list-scoped photo capability is a possible low-friction design; it means shared bearer access, not individual ownership. An authenticated-membership design is the alternative if individual revocation/audit is required. Decide before implementing the hosted gateway; never silently grant photo access to everyone who can guess a list name.

The browser must never receive the admin secret. Keep the current `secret:default`/JWT-verified trial function unchanged. A separate client-facing gateway needs an explicit reviewed authentication/authorization contract and negative tests, not relaxation of the existing function to make the prototype connect. Keep the bucket private and deny direct client writes/listing; authorize every photo read, operation status and mutation against the selected list and item scope. Store any future capabilities only as hashes server-side; specify delivery, browser storage, expiration, revocation and sharing risks before issuing them.

Approval decisions for a later hosted release: selected list/testers; invite-only versus link-holder visibility; read/write/delete privileges; capability versus account membership and any new credentials; real-photo retention/export/removal policy; exact new gateway/grants/policies; finite beta duration/caps and production UI enablement. These are not requested or changed in this preparation task.

## Phone images and HEIC

Most originals will not satisfy the server's small baseline-JPEG boundary directly. Normalize on-device; never enlarge the server input cap simply to accept camera originals. Apply EXIF orientation before dropping metadata, then inspect and strip the final JPEG. Keep decoded pixel and file limits before allocation where the format parser permits; cancellation and large-image memory need device tests.

WebKit documents native HEIC support starting in Safari 17, but that does not prove this prototype's `createImageBitmap` path or support in every target browser. Feature-test actual selected files and the chosen decode path on supported devices. A bounded native HEIC-to-JPEG path can be added after dimension/size parsing and orientation tests. Unsupported browsers should explicitly offer JPEG export/compatible camera capture; do not promise universal HEIC, silently upload originals, or add a paid conversion API. A bundled HEIC decoder would be a separate dependency/license/memory/security review, not the first beta default. [WebKit HEIC support](https://webkit.org/blog/14445/webkit-features-in-safari-17-0/)

The current 24 MP source ceiling excludes some high-resolution phone modes; explicitly reject those with actionable guidance until a bounded decode/downsample path is measured. Likewise decide whether PNG screenshots matter before adding a bounded parser/decoder path; SVG/animated formats stay outside the initial contract. Canvas can return a fallback type or null, so inspect the actual output rather than its requested MIME. [Canvas encoding contract](https://developer.mozilla.org/en-US/docs/Web/API/HTMLCanvasElement/toBlob)

## Server quotas and no-charge isolation

Keep all photo bytes, metadata, processing, delivery and cleanup in the dedicated Supabase Free organization/project. No photo writes/counters/SDK/credentials in Firebase, no Netlify image proxy/functions/transforms, no paid fallback/add-on/automatic upgrade. Supabase states Free usage is not charged; organization billing is shared, so remaining Free and separate from paid projects is the billing boundary. Application caps limit work, not all provider overhead or unauthorized invocation traffic. [Cost controls](https://supabase.com/docs/guides/platform/cost-control), [organization billing](https://supabase.com/docs/guides/platform/billing-on-supabase)

Proposed initial beta envelope stays conservative: 10 MiB aggregate accounted objects including obsolete/pending bytes, 20 current-or-reserved photos, two reservations, 416 KiB reservation before decode, bounded admission/item/tombstone/operation-status/rate counters, and 5 MiB/100 delivery attempts with charge-before-read. Exact beta duration and counter lifecycle require review. Carry existing trial history/usage into the project-wide budget accounting; do not obtain a fresh allowance by resetting counters, changing a phase marker or creating another independent list budget. The October 4 trial deadline remains untouched; any later beta lifecycle is a separately reviewed service/migration.

Reuse immutable keys, one-grant writes, expected versions, deletion epochs, counted old objects and verified cleanup. Lost PUT acknowledgment/worker termination keeps the full charge; expiry or observed absence never refunds an unknown writer. Bound requests, input streams, decoder work and cross-worker reservations. Fail closed when budgets/configuration/auth are unavailable. No silent deletion of current photos to free space.

For a small beta with a hard application delivery cap, prefer authenticated bounded image delivery from the photo gateway; charge each fetch before Storage read, bound response size and include thumbnail/full/retry attempts. Do not introduce public bucket URLs. Short-lived signed URLs are a different decision: replay during validity bypasses per-view gateway accounting, so they cannot prove an exact read cap. Never route image traffic through Netlify or Firebase to work around Supabase availability.

## UI, persistence and acceptance

Keep text editing available during photo outage, quota exhaustion or cleanup failure. Show Add/Change/Remove photo, local preview with Save/Cancel, thumbnail and accessible full view; show retryable errors separately from text state. Load only visible thumbnails, fetch full bytes on expansion, cancel stale work and revoke object URLs. Preserve old image until replacement commit; on timeout, query operation status before retrying. Replace tab-only copy only when durable storage actually exists.

The current cleanup queue is in memory. Persist a small bounded deletion outbox and retry on reopen/online state after successful text deletion; do not serialize privileged secrets or image originals into it. The photo backend has no Firebase access and cannot independently discover every deleted text item, so lost clients can leave charged orphan photos. Design an authorized list-photo management/cleanup view and export/delete process; do not invent a TTL for retained user photos. Map by stable Firebase item key, never item text, and send no list text to the photo service.

Before one selected-list beta: verify real-device formats/orientation/memory; keyboard/screen-reader focus, touch targets and dialog scrolling; cross-device persistence and simultaneous replacements; offline/cancel/reload during save/delete; durable cleanup/outbox; quota/rate abuse and revoked/wrong-list access; all photo-disabled text flows; metadata privacy; backup and physical-object restore; and stop/rollback without unknown-writer refunds. The first release should remain invite-only with explicit limits and an immediate stop control. Public photo access is a later decision.
