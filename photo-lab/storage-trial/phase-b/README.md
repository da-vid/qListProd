# qList private photo storage trial — Phase B review

**Ready for review, not applied or deployed.** Only the dedicated Supabase Free project `qmpdinzendwpkqhtqskz` (`qlist-photos`). Keep production photos off and Netlify/Firebase unchanged. No new keys, paid features, public/signed photo URLs, user photos or account/security changes.

Parent reports Phase A's exact SQL was applied and verified privately, with RLS and no Data API schema exposure. Final state: three released operations, one empty item, six simulated-absent objects; zero used/reserved bytes and no pending/current photos. Concurrent hosted requests produced one winner and one conflict, but actual server overlap was not measured. No Edge harness or bucket was created. Evidence supplied by parent: Library `libfile_9934c0254b28819192105a06f8d5e722`, version 1, `phase-a-hosted-evidence.json`, 10,897 bytes, SHA-256 `d26c72b0acc6a9b4509560394465d40f27ab871b19abf57013c2832217e39170`. This is parent-provided evidence, not a new independent hosted check by this task.

## Review these exact changes

1. `photo-lab/storage-trial/supabase/migrations/20261003002735_qlist_photo_trial_phase_b.sql`: extends the existing **four** private tables; preserves all history, counters, limits, deadline and stop state. Requires quiescent Phase A and no existing Storage bucket/object policies. Adds single-batch ownership, physical write/verification/deletion states, immutable physical keys and nonces. Disables the simulated Phase A RPC before enabling service-only invoker `qlist_photo_trial_b_rpc`. No `storage` table writes or policy changes.
2. `photo-lab/storage-trial/phase-b/{index,handler,engine,sdk}.ts`: admin-only batch using the official SDK. Auth remains `verifyAuth(...,{auth:'secret:default'})` and gateway `verify_jwt:true`. `createAdminClient({auth:{keyName:'default'}})` runs only after authorization. No credential extraction, manual header forwarding or new keys.
3. `deploy-payload.json`: inert, complete deployment arguments for **qlist-photo-storage-trial**. Preserves the separate benchmark v4. The approved v4 codec/fixtures are checksum-identical, bundled with licenses; no binary/CDN fetch at runtime. SDK dependencies and integrity lockfiles are unchanged from the reviewed Phase A bundle.
4. `rollback.sql` and `stop-deploy-payload.json`: non-destructive stop. Fence work and revoke the new/old trial APIs; optionally replace only this trial function with the same auth gate returning 410. Preserve rows, bucket, physical objects and all charges. Never re-enable the simulated cleanup API for physical work.
5. `verification.sql`: read-only post-application/run evidence. Never delete Storage SQL metadata to simulate object deletion.

No direct object-storage connector actions were exposed. The alternative is **one supported Dashboard/session invocation** of the bounded server batch. It uses existing runtime credentials internally; the user should not have to retransmit keys between operations. Deployment and invocation remain for parent review/execution. No invocation action is exposed by this task's connector.

## Caps and exact batch

Existing limits are unchanged: 10 MiB global/list accounted storage; 20 current-or-reserved photos; two outstanding reservations; 100 lifetime admitted operations including retained Phase A history; 100 items/tombstones; 5 MiB application-accounted verification reads and 100 read attempts. No resets or quota extensions.

The function expires at **2026-10-04 00:00:00 UTC**, preserving the parent's database deadline. Batch wall deadline is 90 seconds, individual storage requests 6.5 seconds, operations/reads bounded by 7 seconds, and reservation leases 60 seconds or the remaining database deadline. An expired deadline is a stop, not permission to extend it.

After review, one `POST {"command":"run"}`:

- Atomically claims the only batch. A second caller or retry cannot start another batch.
- Creates `qlist-photo-trial-v1` through the Storage API only if the explicit `NoSuchBucket` result confirms absence. Verifies private access, JPEG-only MIME, a 384 KiB object limit, and an empty bucket. Unexpected settings/content or ambiguous lookup errors stop the run; existing settings are never changed.
- Admits five synthetic operations: gradient base, portrait replacement, full-only partial write, deletion during an unfinished pair, and noise rejection. Only fixed bundled synthetic fixtures and fixed `trial-physical-*` item IDs are accepted. No arbitrary input images, identifiers, paths, proof flags or SQL are accepted by HTTP.
- Processes gradient/portrait/noise once each, caching the two validated output pairs within that batch. Every admission precedes the streaming JPEG boundary. Inputs: 512 KiB, baseline JPEG, 1280 px maximum edge; original bytes are never stored. Fresh metadata-stripped outputs: full <=384 KiB, thumbnail <=32 KiB and <=192 px.
- Writes six physical objects and performs five byte-verification GETs. SHA-256, exact length, JPEG structure/dimensions and metadata stripping must match the recorded plan before commit. Every GET is charged the full 384 KiB bucket maximum, including failed/retried reads, with no read refund. Normal batch cost is 1,966,080 accounted read bytes plus prior Phase A charges. Metadata/API overhead is not provider bandwidth accounting.
- Exercises duplicate commit/cleanup, retains old bytes until deletion, denies a late thumbnail after item deletion, rejects noise before any physical write, and removes the remaining synthetic current photo at the end.

Expected normal end state: **zero used/reserved bytes, pending/current photos and remaining bucket objects**; five new released physical operations and ten physical-absent object records remain as evidence. With the parent's reported starting state, total operation count becomes eight. The private empty bucket remains. No text-list data is sent to Supabase.

## Physical write and cleanup guarantees — and limits

Reservation of 416 KiB is atomic with admission. Plans record exact output size/hash before uploads. Each immutable object key receives **one ever-granted write attempt**, with `upsert:false`. Claim acquisition and fencing serialize under the same global/list database locks. A lost claim response does not permit another upload.

A fulfilled Storage upload response is recorded as settled. If the upload times out, fails ambiguously, or the worker disappears before recording completion, its state remains `inflight` or `uncertain` and its **entire reservation stays charged**. A late success cannot automatically erase uncertainty. Neither expiration nor observing an empty path proves that the writer stopped. There is no unsafe timeout-based refund or automatic retry of a write.

Commit requires both settled objects, successful byte verification and the captured item epoch/version. Old committed bytes remain charged until cleanup. The current pair cannot be cleaned by an old operation. Historical commit replay never restores an old photo.

Cleanup first fences the operation and rejects **any** unsettled writer. It then awaits the official Storage removal API and requires explicit `NoSuchKey`/404 results from object-info lookups for the exact immutable keys. Only that trusted server path records the cleanup receipt and atomically refunds once. Generic 400/403/404/service errors do not count as absence. HTTP callers cannot supply proof booleans or receipts. The database itself cannot independently attest S3 state: this relies on the Storage API's successful-delete contract, not a direct provider inventory/billing measurement. The reviewed upstream implementation awaits backend deletion inside its metadata transaction; the hosted implementation/version still needs acceptance testing.

`{"command":"status"}` reads bounded ledger state. `{"command":"reconcile"}` performs cleanup only for settled noncurrent operations; it creates no bucket, admission or write. It reports current or uncertain operations as retained. It does not reset batch ownership or resume uploads. Interrupted work can therefore require review rather than automatic recovery. If the platform loses an upload acknowledgement, retaining at most the existing bounded reservations is intentional.

## Local evidence

- **16 PostgreSQL 17.11 integration tests passed** with independent database clients and actual temporary JPEG files. Coverage includes the full batch, late completion after timeout, lost write acknowledgement, deletion while a writer is active, lost commit response, corrupt/oversized readback, failed deletion/false absence, competing write claims/admissions, inherited 100-operation cap, quota/read constraints, privileged access, atomic plan rollback, expiry, non-destructive stop and policy preflight. Representative retained Phase A history is seeded and preserved. Filesystem adapters inject failures; they are **not** the hosted Storage service.
- **7 HTTP/official-SDK contract tests passed**, including auth/input denial, bounded stalls, exact bucket/upload restrictions, and refusing ambiguous missing-object errors. The real SDK calls a local fake fetch in these tests; no credentials or external service are used.
- **9 targeted JPEG/streaming tests passed again** for the reused codec/boundary, including limit-minus-one/exact/plus-one bytes, dishonest length, stalls, invalid formats, metadata and output bounds.
- Node 24.21.0; PostgreSQL 17.11 official source previously checksum-verified; Deno 2.9.7 frozen-lock checks passed for both active and stop entrypoints. Codec and fixture hashes match the reviewed v4 package. Temporary PostgreSQL listened on a private Unix socket with TCP disabled and was stopped afterward.

Files: `local-results.json`, `boundary-results.tap`, `jpeg-results.tap`, and `validation.json`. Hosted storage, bucket/privacy behavior, function CPU/memory/wall limits and provider usage remain **unverified**. No deployment or physical Supabase Storage claim is made by these local tests.

Reproduce from the extracted repository-shaped bundle (or the local checkout), without any hosted credentials:

```sh
python3 photo-lab/storage-trial/phase-b/test-local.py /absolute/postgresql/bin /absolute/node
npm ci --prefix photo-lab/storage-trial --ignore-scripts --no-audit --no-fund
node --test photo-lab/storage-trial/phase-b/boundaries.test.ts
deno check --config photo-lab/storage-trial/deno.json --frozen-lockfile photo-lab/storage-trial/phase-b/index.ts
```

The SQL runner creates a new local cluster and fresh databases; it cannot accept a remote DSN. The bundle already includes the verified codec/fixtures. Optional standalone JPEG tests require the separately pinned photo-lab dependencies. Do not install through the root application's node_modules symlink.

## Parent execution after exact review

1. Verify dedicated project, Free plan, existing Phase A evidence/deadline, schema not exposed, current zero pending/current/charged bytes, and no unexpected buckets/policies/objects. Stop on drift. Keep evidence; never reset counters to make the trial fit.
2. Review/apply only the **Phase B** migration in one transaction; Phase A SQL is included solely for reproducible fresh local tests. Verify RLS/grants, old API disabled, and provider advisors. The files include explicit transaction boundaries; account for the chosen runner's transaction handling.
3. Review/deploy the exact new function payload with JWT verification enabled. Verify anonymous/nonmatching calls are denied before privileged work. Use the established supported Dashboard/session route; never extract a key or weaken auth to make invocation work.
4. Invoke the batch once. Inspect response, function logs, `verification.sql`, private-bucket settings and object state. Expected uploaded objects/read attempts are listed above; any discrepancy stops further testing. A denied second batch is expected.
5. On a known settled failure, the bounded reconcile command may clean safe noncurrent leftovers. Unknown writes/current photos remain charged and listed. On uncertainty, use the non-destructive stop and report the retained evidence. Do not enable production or create a public adapter. No further testing or deadline extension is automatic.

References checked: [Storage schema must remain read-only](https://supabase.com/docs/guides/storage/schema/design), [bucket limits](https://supabase.com/docs/guides/storage/buckets/creating-buckets), [private buckets](https://supabase.com/docs/guides/storage/buckets/fundamentals), [Storage errors](https://supabase.com/docs/guides/storage/debugging/error-codes), [official Storage deletion implementation](https://github.com/supabase/storage/blob/master/src/storage/object.ts), [current auth modes](https://supabase.com/docs/guides/functions/auth). The Supabase changelog was refreshed; this migration introduces none of the extensions/custom operators implicated by the PostgreSQL 17.11 notice.
