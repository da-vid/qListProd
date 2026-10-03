# qList private photo trial — hosted continuation accepted

**Hosted acceptance passed on October 3, 2026. Do not apply/deploy/rerun the completed continuation.** Parent supplied the actual user-Send response, ledger, logs and empty Storage API inventory. This follow-up only verifies that evidence and updates local documentation; no hosted changes or Library replacement.

All four scenarios passed. Final state: **9 historical operations, 6 items, 6 reads / 2,359,296 accounted read bytes; zero used/reserved bytes and zero current/pending photos**. Original batch remains blocked, separate continuation complete; prior physical history/receipts are unchanged. The existing `2026-10-04T00:00:00Z` expiry remains.

Observed runtime: **754 ms CPU, 10,386 ms wall, 54 ms boot**, shutdown `EarlyDrop`; **17,923,228 bytes reported memory is a snapshot, not a proven peak**. No measured physical-server overlap or new unauthenticated negative POST is claimed. Production photos remain disabled.

See [hosted-acceptance.json](hosted-acceptance.json) for checked evidence and [the selected-list beta plan](../../../docs/photo-selected-list-beta-plan.md) for actual remaining work and approval decisions. Evidence: Library `libfile_9fb125212c708191a16146fd3425793c` v1, 35,978 bytes, SHA-256 `d55ca3b06fd186603cece7464a7e3d4b712899f22266bc32db5c366afdd1439d`. Exact bytes, runtime source hashes, counters, scenario receipts and prior physical evidence were verified locally. No independent live-host recheck was made by this follow-up.

The existing Library review bundle remains version 3, representing the source that was accepted. The preparation and one-send instructions below are retained historical review context, **not outstanding actions**.

---

Prepared locally for parent review. No hosted SQL, deploy, invocation, Storage, Netlify, Firebase, key, account or billing changes were made by this task. Production photos remain off. Target remains the existing Supabase Free project `qmpdinzendwpkqhtqskz`, function `qlist-photo-storage-trial`, private bucket `qlist-photo-trial-v1`. Preserve the separate benchmark function.

## Starting evidence

The parent's cleanup-only v2 succeeded. Credential-free evidence was materialized from Library `libfile_aed7b29742788191b62cf3d03fc75c10` v0, 9,245 bytes, SHA-256 `5bffce57288a64cb3eb2715082a2d0fddc570f322178e9db93d8fa57b933e35d`; exact bytes were verified. It records two released physical operations/four absent keys with deletion receipts, empty private bucket metadata and successful Storage API deletion/absence logs. This task did not independently recheck the hosted project or provider physical inventory.

Both budgets retain five historical admissions, two items, four reads and 1,572,864 charged read bytes; used/reserved bytes and pending/current photos are zero. Original `batch_state=blocked` and owner are retained. Never reset or rerun the original batch. Cleanup is complete; the remaining hosted tests are not.

## Exact proposed delta

1. Apply **only** `supabase/migrations/20261003022856_qlist_photo_trial_continuation.sql` after review. One transaction locks global then list budget, checks the reviewed reconcile/B-RPC body hashes, cleaned counters and exact deadline, and rejects existing Storage policies. It adds `continuation_state` and `continuation_owner` to the existing budget rows, then replaces the service-only invoker RPC. No new table, Storage policy or client grant. No counter/history/cap/expiry reset; reconcile is unchanged.
2. The one-ever claim requires the exact cleaned two-operation/four-object state and receipts. Only four fixed IDs/items/fixtures can be admitted. A separate owner cannot reuse the original owner. Original `batch_claim`/`batch_close` calls are rejected; historical commit replay cannot restore an image. Continuation closes complete or blocked, with no restart. Every budget UPDATE has the explicit two-scope WHERE clause.
3. `engine.ts` adds the fixed continuation and an internal deletion hook while a PUT is unacknowledged. PUT rejection handlers attach immediately. `sdk.ts` adds an existing-bucket/empty-list check; continuation never creates a bucket. Reviewed HTTP400/semantic404 `NoSuchKey` handling is unchanged.
4. `handler.ts` adds only `{"command":"continuation"}`. No paths, fixtures, owners, object proofs, credentials or arbitrary image bytes are accepted. Existing authorization, JWT setting, body bounds, dependencies, codec and fixtures are unchanged.

`continuation-runtime.patch` is the runtime/SQL diff from canonical source `363f61de2aa565e06339cd8ad2e8949c476a62c4`. `continuation-review.json` records hashes, boundaries and test evidence. `deploy-payload.json` is inert and contains complete function source/config; it does not apply SQL or invoke anything. Historical notes in `HISTORY.md` are not an execution plan.

## Fixed cases and normal cost

| Operation | Synthetic case | Expected evidence |
|---|---|---|
| `phaseb-cont-partial` | Gradient full upload/verified GET, intentional stop before thumbnail claim | Full 416 KiB reservation remains until fenced Storage deletion and verified absence |
| `phaseb-cont-deleted` | Start full PUT, delete item before acknowledgment, attempt cleanup; then settle/verify full and attempt thumbnail | Unsettled cleanup denied, reservation retained, later thumbnail fenced; only settled object cleaned |
| `phaseb-cont-noise` | Bundled noise exceeds bounded encoded output | Codec rejects before plan/write; DB verifies no write was granted before reservation release |
| `phaseb-cont-oversize` | Fixed 512 KiB + 1 body seeded with bundled gradient, no Content-Length | Actual streamed byte cap rejects before decoding/plan/write; DB-only never-written release |

Items have matching suffixes under `trial-physical-cont-*`, expected version zero. Noise/oversize cannot plan or write via SQL. Their receipt hashes encode `never-written:<operation>:<reason>`; `physical_deleted_at` stays null. They are not presented as physical deletions. Planned, inflight or uncertain objects fail this proof and stay charged.

Normal continuation uses **4 admissions, 2 PUTs, 2 verification GETs and 2 pair-deletion calls**; no thumbnail upload or new photo commit. Expected final totals: **9 historical operations, 6 items, 6 reads, 2,359,296 charged read bytes**, zero used/reserved bytes/current/pending photos and no bucket objects. Prior operation/object evidence is unchanged; only cumulative admission/item/read counters increase. Original batch stays `blocked`; continuation becomes `complete`.

Existing limits remain: 10 MiB global/list storage; 20 current-or-reserved photos; 2 pending reservations; 100 lifetime admissions/items; 5 MiB accounted reads and 100 reads. Expiry remains **2026-10-04T00:00:00Z**. Batch deadline 90 seconds; operations 7 seconds; SDK fetches 6.5 seconds; reservation leases 60 seconds or remaining expiry. No quota/deadline extension.

## Security and failure review

- Gateway `verify_jwt:true`; `verifyAuth(...,{auth:'secret:default'})`; admin client only after authorization. No raw credentials, user-metadata authorization or new keys. Four private RLS tables and service-only invoker/revokes remain. No SECURITY DEFINER, Storage SQL writes or client policies.
- Immutable keys, `upsert:false`, one ever-granted write, read charging and epoch fences remain. Ambiguous PUT/lost acknowledgement stays `inflight` or `uncertain` and retains its full reservation even if bytes arrive later. Empty paths and timeouts do not prove writer completion.
- Duplicate/lost claims cannot start another continuation. Failure blocks it without automatic replay/reset. Reconciliation cleans only settled, fenced noncurrent operations; unknown writers require separate review and remain charged.
- Deletion precedes acknowledgment, proving the unsettled-writer ledger fence. The physical PUT may finish before the hook reaches SQL; **physical-server overlap is not measured**. A local delayed PUT test additionally proves late physical completion stays charged and uncleanable.
- API deletion/absence is not direct provider inventory or billing proof. Accounted reads omit protocol overhead. Edge CPU/memory and actual hosted service behavior remain acceptance checks.

## Local verification

**31 PostgreSQL/local-file integration tests**, **18 HTTP/official-SDK tests**, **5 source/WHERE regressions**, **9 JPEG/input tests**, and frozen-lock Deno checks pass: Node 24.21.0, PostgreSQL 17.11, Deno 2.9.7. Real temporary JPEG files exercise delayed completion, readback and deletion failures; no remote DSN/credentials.

The inspected upstream [pg-safeupdate](https://github.com/eradman/pg-safeupdate/tree/37dbc9c4acf5e2504adf2b218e9c6b41751022f3) was built under `/tmp` and preloaded in every local service-role session. All 31 tests passed; a control rejected unqualified UPDATE with `UPDATE requires a WHERE clause`. This is actual extension execution, beyond source checks. It is not asserted byte-identical to the hosted module. No hosted LOAD, security bypass or extension configuration occurred. Temporary clusters stopped.

Coverage includes starting-state/history preservation, concurrent/duplicate claims, wrong ownership/arbitrary cases, expiry/drift, missing bucket, partial deletion failure/recovery, late unknown writers, forged never-written proofs, historical replay, cumulative quotas and RLS/privileges. Official SDK tests use actual Response envelopes for legacy400/semantic404, modern404, authorization/tenant/server failures and PostgREST SQL errors.

Reproduce from storage-trial: `python3 phase-b/test-local.py PG_BIN NODE_BIN /tmp/qlist-continuation-safeupdate/safeupdate.dylib`. Omit the last argument for 30 non-extension tests. Upstream commit/module digest are in `local-results.json`; the optional path is restricted to the isolated directory. Dependencies remain locked and unchanged.

## Parent review and one-send acceptance

1. Review the delta and starting evidence. Read current hosted budgets, source hashes, privileges/RLS and private bucket settings/contents. Stop on drift/expiry; do not repeat completed cleanup. Migration and claim independently reject incompatible state.
2. Apply only the continuation migration, then deploy this bundle's payload to the existing trial function with JWT verification retained. Never rerun A/B migrations or archived fixes. Preserve benchmark and production app.
3. Request **one manual Test Send**, POST JSON `{"command":"continuation"}`, through the existing supported authenticated Dashboard flow. No new/copied credentials. Duplicate Send rejects before new writes.
4. Retain response, readonly `continuation-verification.sql`, Storage API empty inventory and logs. Require four scenario receipts, separate complete marker, original blocked marker/history, six reads, nine operations and zero residuals. Response intentionally says `continuation_complete:true`, `trial_complete:false`, `requires_hosted_review:true`; it does not declare production readiness.
5. On failure, inspect ledger/logs first. Do not repeat continuation or clear counters. Existing `reconcile` may clean settled/fenced writers within existing expiry. Existing rollback/stop payload revokes access without deleting records/objects or refunding unknown bytes. Deadline expiry means stop, not extension.

Supabase changelog checked October 3. Storage semantics checked against [official error documentation](https://supabase.com/docs/guides/storage/debugging/error-codes) and the previously reviewed renderer. Existing SDK/server pins and codec were not changed.
