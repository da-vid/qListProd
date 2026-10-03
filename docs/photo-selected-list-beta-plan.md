# Selected-list photo beta — next integration plan

Status: updated October 3, 2026 after hosted synthetic acceptance and local beta integration. See the current [disabled integration review](../photo-lab/beta/README.md); the remaining historical planning text below is not deployment authorization. No real-photo enablement, new credentials, public access, auth relaxation, production deployment or test-expiry extension is included. Keep Netlify and Firebase text infrastructure. The existing admin trial remains closed to further batches and expires October 4; it is not a browser upload API.

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

## Accepted same-link access model and disabled integration

The user accepted “anyone with a list link can view and edit photos,” matching text, then authorized continued isolated work. This is the current beta model; invite-only membership/capabilities are no longer the pending default. Short/custom links are guessable and are not private ownership. Actual selected list IDs, final finite limits, retention and external enablement still need review.

The tested local backend/client, conservative proposed envelope, kill switch, required list/item checks and exact disabled deployment artifacts are in [the beta integration review](../photo-lab/beta/README.md). The new endpoint remains disabled and is not deployed. Public/anonymous ingress would require separate approval on that new function only; existing trial authentication, expiry and usage stay unchanged. No production client import was added.

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
