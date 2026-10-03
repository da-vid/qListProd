# Next photo stage: local safeguards and minimal hosted trial

Phase A is now implemented and locally tested for review in [the trial bundle](../photo-lab/storage-trial/README.md). Its exact migration, harness, rollback and new test evidence supersede the proposed Phase A details below. The parent has since applied and verified Phase A SQL. [Phase B](../photo-lab/storage-trial/phase-b/README.md) is prepared locally for review; no Phase B changes have been applied remotely.

Target only: Supabase Free project `qmpdinzendwpkqhtqskz` (`qlist-photos`). This plan does not apply schema changes, create a bucket or deploy a function. Live qList photos remain off. No new credentials, paid services, Firebase/Netlify photo work or relaxed authentication are proposed.

## Verified starting point

The parent's 824,639-byte v4 handover was downloaded to this Mac using the Library transfer helper. ZIP SHA-256: `b9055fce3a9a040483103d107416d8545c54059547160aec2f9b4aa3d614d495`. All eleven entries in its checksum manifest matched. Library identity: `libfile_583954eff05881918bc21d01436c81ea`, version 0. The approved entry, with only trailing whitespace normalized, is retained in `photo-lab/hosted-v4/index.ts`; the local generator now reuses its pinned `@supabase/server@1.9.0/core`, `verifyAuth`, `secret:default` authentication. Gateway `verify_jwt` remains true. The raw-key comparison was removed.

Parent-provided hosted v4 evidence, copied into `photo-lab/hosted-v4/results.json`:

| Synthetic fixture | Outcome                       | Wall time | Reported CPU |     Full / thumbnail |
| ----------------- | ----------------------------- | --------: | -----------: | -------------------: |
| Gradient          | Success                       | 196.83 ms |       194 ms | 19,896 / 1,316 bytes |
| Portrait          | Success                       | 168.57 ms |       217 ms | 15,445 / 1,003 bytes |
| Noise             | Clean HTTP 422 size rejection | 392.52 ms |       440 ms |                 None |

All three were cold calls. The supplied lifecycle evidence reports normal `EarlyDrop`, not a resource-limit crash. These observations prove neither peak memory nor a warm p95, and the benchmark did not test storage or global quotas. Its twelve-call counter is per worker only. Keep these distinctions in any rollout decision.

## Local audit and fixes

- **Deleted-item upload race:** cleanup previously read the current photo and removed it. If a first upload had not committed yet, cleanup could find nothing and finish too early. `PhotoAdapter.deleteItem` now records a permanent deletion marker for that text-item key; `MockPhotos.put` checks it again at commit. Tests cover a late upload whose caller never aborts, repeated cleanup and attempted resurrection.
- **Stale UI read:** each row now versions photo reads. An old response cannot erase a freshly saved thumbnail or overwrite newer feedback. Text persistence is still independent.
- **Output/accounting boundaries:** invalid capacities and oversized full/thumbnail objects reject before reading bytes. Returned photo metadata is immutable so caller mutation cannot corrupt cleanup accounting. Failed physical cleanup still counts against the mock's byte capacity.
- **Streaming input:** the future gateway boundary validates JPEG MIME, rejects compressed bodies, counts actual bytes up to 512 KiB, checks declared length against actual length, cancels after five seconds, and caps chunk count at 2,048. Empty/excessive chunks cannot starve the deadline. Header dimensions remain limited to 1280 pixels; unsupported progressive JPEG and other formats fail closed at the server boundary.
- **Transactional specification:** `photo-lab/quota-ledger.ts` models reservation, staging, commit, cleanup, item deletion and expiry. It tests exact-byte capacity, count/admission limits, duplicate reserve/commit retries, conflicting idempotency reuse, two competing replacements, remove/re-add races, deletion during upload, duplicate cleanup callbacks and failed cleanup. The state model is not a database implementation and does not execute storage writes.

Expiry only fences a reservation. It does **not** refund bytes. Refund requires evidence that its writer has stopped and its objects are absent. Old photo bytes remain counted until deletion is confirmed; the current photo cannot be cleaned by an old job. Unknown-item deletion markers and operation history are bounded for the trial. Retained photos have no automatic expiry.

Validation: **75 tests passed** (34 existing + 41 photo/codec/handler/boundary tests), including 18 added in this stage. TypeScript, normal preview, photo preview, normal release build and packaged codec smoke test passed. The final full run used checksum-verified Node 24.21.0 with its bundled npm 11.19.0 against the existing installed dependencies; no dependency install or lockfile update was performed for that rerun.

## Proposed exact trial limits

These are conservative test settings, not product limits or a claim about Supabase's full free allowance:

- One allowlisted synthetic list, `PhotoDemo`, with no real qList IDs or text sent to the service.
- **10 MiB** global and list storage budgets; pending reservations and undeleted old/staged objects remain counted.
- **20** current-or-reserved photos, **2** outstanding processing reservations and **100 total admitted operations** for this trial. This is stricter than the earlier 100/day ceiling; no daily reset is needed for the first run. At most 100 item/tombstone records. Retries of the same idempotency key consume no new slot or operation.
- **512 KiB** input, **1280 px** maximum edge, **384 KiB** full output and **32 KiB** thumbnail. Reserve the full **416 KiB** output allowance before reading/processing a body; reconcile down to actual bytes only at commit.
- At most **5 MiB** of application-accounted object-read bytes for verification, with a maximum of 100 read operations. No public objects or signed delivery URLs in this stage. Reads go through the authenticated Supabase harness so replay cannot bypass its counters. Provider billing/egress accounting may include overhead beyond image bytes; remaining Free-plan restrictions are the final no-charge boundary.
- The trial stops if plan status is no longer Free, policy checks fail, reconciliation disagrees, or capacity cannot be reclaimed safely. No upgrade, quota expansion, fallback proxy or silent removal of retained photos.

## Minimal persistent changes to review before applying

**Phase A — transactions, no image storage yet.** Add a non-exposed schema `qlist_photo_trial` with four tables:

1. `budgets`: fixed global/list limits, used/reserved bytes, photo counts, active reservations, operation count, read allowances and a stop flag. CHECK constraints prevent negative values and overspending.
2. `operations`: unique idempotency key, canonical request digest, synthetic list/item, expected version and captured item epoch, phase, exact byte reservation, lease/fence state and durable result. Expired/failed work stays accounted until cleanup is proven.
3. `items`: unique synthetic list/item key, monotonically increasing epoch/version, current operation reference and permanent deleted-item marker. Epochs detect a remove/re-add change even when both ends have no current photo.
4. `objects`: immutable server-generated object keys, owning operation, full/thumbnail kind, verified byte sizes/hash, physical state and cleanup lease/result. Only old or uncommitted object versions can enter cleanup.

Use reviewed transactional RPCs for reserve, stage, commit, operation status, photo removal, text-item deletion, expiry fencing and cleanup finalization. Lock budget rows in fixed global-then-list order and item/operation rows consistently. Idempotency acquisition and reservation must be one transaction. Never let client-supplied booleans assert that physical cleanup succeeded.

RPCs should be `SECURITY INVOKER`, with execute revoked from PUBLIC/anon/authenticated and granted only to the existing service role. Give that role only the schema/table rights needed by the harness; deny client access and keep RLS enabled without anonymous policies. If PostgREST requires public-schema RPC wrappers, expose only these invoker functions, not the private tables; do not use `SECURITY DEFINER` as an access workaround. Review the exact migration and grants before execution.

Add an independent admin-only `qlist-photo-storage-trial` Edge Function using the **same approved v4 authentication** and pinned codec. It may select bundled synthetic inputs and approved fault cases; it must not accept arbitrary storage paths or real list identifiers. Phase A runs counter/version races with simulated object states, clearly labeled as such. SQL/HTTP failures must leave transactions atomic. No bucket is needed for this phase.

**Phase B — real synthetic objects after Phase A passes.** Create one private bucket, `qlist-photo-trial-v1`, with JPEG-only MIME and a 384 KiB per-object ceiling. No anonymous listing, upload, read, update or delete policy. Store only reencoded full/thumbnail pairs under immutable operation-specific paths, never originals. Stage object identities before starting their writes so a crash leaves a discoverable operation. The same authenticated harness writes/reads/removes them and enforces thumbnail and aggregate limits.

Cleanup must prove that no writer can later complete into those object paths. An HTTP timeout or one empty inventory response is insufficient. Fence the writer, retain its reserved allowance while completion is uncertain, then verify object deletion before a transactional, exactly-once refund. Fail closed if writer termination cannot be established. No cleanup cron, new key or public signed URL is required for this small trial.

## Bounded hosted acceptance run

1. Re-read Free-plan status and inventory. Apply only the reviewed Phase A migration/function. Confirm anonymous/nonmatching authorization and cross-list requests are denied without data disclosure.
2. Run at most 100 admitted operations across isolated synthetic scenarios: exact capacity/count limits, two concurrent reservations for the last available capacity, same-key retries, changed-payload idempotency rejection, stale replacement/removal and deletion during an unfinished upload. Compare durable counters/status with the local ledger's expected results after each scenario.
3. After Phase A passes, apply the reviewed bucket change. Run gradient/portrait processing, noise rejection, 512 KiB minus-one/exact/plus-one input, dishonest Content-Length, stalled/empty/excessive chunks and output-limit failures. Verify no originals, dangling current references or premature refunds.
4. Force one partial object-write failure, one cleanup failure, a lost commit response and a conflicting replacement. Retry by operation ID. An old cleanup job must not touch the new current pair; duplicate callbacks refund once. Read back only synthetic object bytes needed for dimensions, digest and metadata checks, within the read budget.
5. In the local text UI, simulate hosted pause/offline/timeout/quota/4xx/5xx during those photo operations and verify text add/edit/check/delete still persists. Do not introduce admin credentials into the browser app. Keep the admin harness separate; a later public adapter needs its own reviewed capability/authorization design.
6. Stop and report results, residual objects and accounting. Remove only synthetic objects explicitly created by this trial when testing their cleanup. Do not erase operation evidence, drop the schema or change the bucket merely to conceal failures. No production rollout is part of acceptance.

Before any remote mutation, review the actual migration/function diff and chosen limits. This deliverable is the plan and tested local specification; PostgreSQL/RLS behavior, storage cleanup and hosted global enforcement remain unproven until the above run.

Current provider references: [database function privileges and invoker semantics](https://supabase.com/docs/guides/database/functions) and [Free-plan cost control](https://supabase.com/docs/guides/platform/cost-control). The latter is the no-charge boundary; application counters alone do not establish provider billing behavior.
