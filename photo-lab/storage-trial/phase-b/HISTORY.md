# Historical preparation and cleanup notes

Superseded by README.md. Do not execute the old run/cleanup instructions below.

# qList private photo storage trial — Phase B review

**Canonical cleanup-only overlay independently reviewed and integrated locally; not deployed or invoked by this task.** Only the dedicated Supabase Free project `qmpdinzendwpkqhtqskz` (`qlist-photos`). Keep production photos off and Netlify/Firebase unchanged. No new keys, paid features, public/signed photo URLs, user photos or account/security changes.

Parent reports Phase A's exact SQL was applied and verified privately, with RLS and no Data API schema exposure. Final state: three released operations, one empty item, six simulated-absent objects; zero used/reserved bytes and no pending/current photos. Concurrent hosted requests produced one winner and one conflict, but actual server overlap was not measured. No Edge harness or bucket was created. Evidence supplied by parent: Library `libfile_9934c0254b28819192105a06f8d5e722`, version 1, `phase-a-hosted-evidence.json`, 10,897 bytes, SHA-256 `d26c72b0acc6a9b4509560394465d40f27ab871b19abf57013c2832217e39170`. This is parent-provided evidence, not a new independent hosted check by this task.

## Current blocked batch: reviewed cleanup only

The parent reports that the authenticated run after the WHERE correction successfully uploaded, verified and replaced gradient/portrait objects, then stopped during cleanup: Storage returned exact `NoSuchKey` with HTTP **400** and semantic `statusCode:404`. The initial adapter accepted only transport 404. Current reported state: private bucket with two portrait objects; 37,660 conservatively charged bytes; zero pending reservations/unknown writers; four verification reads charged 1,572,864 bytes; batch **blocked**. **Do not rerun or reset the original batch.**

The exact reviewed overlay was materialized and verified from Library `libfile_d6fc9500a758819188de1eba3a985596`, version 0, 14,209 bytes, ZIP SHA-256 `942c4b3e3a80a0ef3686ac7f9e98a402d20ae2ff2d18b8de69e2509e3bcd7225`. All seven entry hashes and its diff against canonical version 1 matched. The three runtime files are integrated byte-for-byte without changes. `reviewed-cleanup.patch`, `reviewed-cleanup-manifest.json` and `reviewed-cleanup-evidence.json` preserve the supplied review; `independent-cleanup-review.json` records this task's checks.

The SDK now accepts **only exact `NoSuchKey`** with transport 404, or transport 400 **plus semantic statusCode 404**. Generic missing messages, 400/404 failures, authorization, tenant, bucket and server errors remain failures. [Supabase's error renderer](https://github.com/supabase/storage/blob/master/src/internal/errors/storage-error.ts) explains the legacy 400 transport while retaining semantic statusCode.

One proposed `POST {"command":"cleanup"}` uses the existing auth/input gate and applies only to the blocked two-operation batch: `phaseb-batch-base` / gradient / committed version 1 and `phaseb-batch-replacement` / portrait / committed version 2, both on `trial-physical-replace`, with exactly two settled/absent objects each. It first uses the SQL expected-version check to remove current version 2, then the existing immutable-key cleanup and verified-absence refund for each pair. No admission, upload, bucket setup, object-byte download/read charge, batch-state change, quota reset, auth change, SQL change or deadline extension is introduced.

Independent results: **21 PostgreSQL/local-file integration tests**, **14 HTTP/official-SDK tests**, **4 WHERE/source-hash regressions**, **9 targeted JPEG tests**, and Deno 2.9.7 frozen-lock checks passed on Node 24.21.0. Five new real-SQL scenarios reproduce the exact blocked shape, concurrent cleanup, second-pair deletion failure/re-entry, version drift after preflight and a lost cleanup acknowledgement. No blocking concern was found. A concurrent caller can receive a safe version conflict; retrying later is idempotent. Temporary clusters were stopped.

Cleanup success means `cleanup_complete:true` and **`trial_complete:false`**. Partial-upload, deletion-during-upload and noise-rejection cases remain unexecuted in hosted Storage. Expected cleanup end state is zero used/reserved bytes/current/pending photos and remaining bucket objects, with batch still blocked, read counters/history unchanged and no new operations. The parent must review/deploy the overlay and obtain actual cleanup evidence separately; this task performed no remote action or Test Send.

This bundle's `deploy-payload.json` includes the exact reviewed runtime overlay and unchanged auth/config/dependencies. No SQL needs reapplication. Everything below is retained historical preparation context and must not be treated as instructions to restart the original batch.

## Safe-update correction — October 3, 2026

The parent reports that the first authenticated PostgREST run hit `UPDATE requires a WHERE clause`. Its initial claim rolled back before any bucket, physical object or new charge. The four runtime budget updates (inherited reconciliation plus batch claim, batch close and read charging) now explicitly use `WHERE scope IN ('global','PhotoDemo')`; the parent already applied that exact guarded replacement remotely. **Do not reapply hosted SQL, redeploy, or reset the trial for this source synchronization.** That retry subsequently reached verified gradient/portrait uploads and replacement, as described above; it did not complete the original trial.

The reviewed input archive was materialized through Library and verified: `libfile_d89f53e390e48191be29ff570b2d0b79`, version 0, 5,066 bytes, ZIP SHA-256 `f6a012b89d359ee6338be35c84208f309a8f5cfd16d7b013eaa0fa344ff8f376`. The exact patch and parent evidence are retained as `reviewed-safeupdate-fix.sql` and `safeupdate-fix-evidence.json`. That patch's old-source drift guard intentionally prevents blindly reapplying it. Runtime bodies match parent-reported `pg_proc.prosrc` MD5s: reconciliation `d2ae306d98126389774c8cdc7e7ac128`; Phase B RPC `a062f7fd5e8b1535c282e5bad0068683`.

Local canonical migration sources contain those same four runtime predicates. Both stop/rollback scripts and dormant Phase A read accounting also receive the identical scope predicate, for seven guarded canonical updates total. No handler, deployment configuration, schema design, limits, grants, RLS, history, expiry or object logic changed in this correction.

After this correction, all 15 Phase A and 16 Phase B local PostgreSQL integration tests passed again, and both temporary clusters stopped. `safeupdate.test.ts` adds four passing source-regression checks: all seven budget updates are scoped; removing any predicate fails; comments/literals/broadened conditions cannot satisfy the check; and function bodies exactly match the reviewed patch and hashes. **This is a source check, not execution of the safe-update module.** Connector SQL sessions and the original plain PostgreSQL tests lacked the authenticator's safe-update preload. The parent's attempt to LOAD the installed module was denied; no bypass was attempted here or there. Parent-reported rollback branch tests passed after the fix, the parent subsequently supplied the partial PostgREST run evidence summarized above.

The remaining preparation and acceptance plan below describes the original Phase B bundle. The parent has since applied/deployed that work; it must not be restarted merely to consume this corrected bundle.

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
node --test photo-lab/storage-trial/phase-b/boundaries.test.ts photo-lab/storage-trial/phase-b/cleanup.test.ts
node --test photo-lab/storage-trial/phase-b/safeupdate.test.ts
deno check --config photo-lab/storage-trial/deno.json --frozen-lockfile photo-lab/storage-trial/phase-b/index.ts
```

The SQL runner creates a new local cluster and fresh databases; it cannot accept a remote DSN. The bundle already includes the verified codec/fixtures. Optional standalone JPEG tests require the separately pinned photo-lab dependencies. Do not install through the root application's node_modules symlink.

## Original parent acceptance sequence — do not restart for this correction

1. Verify dedicated project, Free plan, existing Phase A evidence/deadline, schema not exposed, current zero pending/current/charged bytes, and no unexpected buckets/policies/objects. Stop on drift. Keep evidence; never reset counters to make the trial fit.
2. Review/apply only the **Phase B** migration in one transaction; Phase A SQL is included solely for reproducible fresh local tests. Verify RLS/grants, old API disabled, and provider advisors. The files include explicit transaction boundaries; account for the chosen runner's transaction handling.
3. Review/deploy the exact new function payload with JWT verification enabled. Verify anonymous/nonmatching calls are denied before privileged work. Use the established supported Dashboard/session route; never extract a key or weaken auth to make invocation work.
4. Invoke the batch once. Inspect response, function logs, `verification.sql`, private-bucket settings and object state. Expected uploaded objects/read attempts are listed above; any discrepancy stops further testing. A denied second batch is expected.
5. On a known settled failure, the bounded reconcile command may clean safe noncurrent leftovers. Unknown writes/current photos remain charged and listed. On uncertainty, use the non-destructive stop and report the retained evidence. Do not enable production or create a public adapter. No further testing or deadline extension is automatic.

References checked: [Storage schema must remain read-only](https://supabase.com/docs/guides/storage/schema/design), [bucket limits](https://supabase.com/docs/guides/storage/buckets/creating-buckets), [private buckets](https://supabase.com/docs/guides/storage/buckets/fundamentals), [Storage errors](https://supabase.com/docs/guides/storage/debugging/error-codes), [official Storage deletion implementation](https://github.com/supabase/storage/blob/master/src/storage/object.ts), [current auth modes](https://supabase.com/docs/guides/functions/auth). The Supabase changelog was refreshed; this migration introduces none of the extensions/custom operators implicated by the PostgreSQL 17.11 notice.
