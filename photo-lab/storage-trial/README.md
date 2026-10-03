# qList photo trial — Phase A review bundle

**Current status — October 3, 2026:** the isolated hosted synthetic continuation passed all four remaining cases, with zero residual charges/objects. The browser UI is still a local mock; production photos are disabled. See [the current selected-list beta plan](../../docs/photo-selected-list-beta-plan.md) and its linked acceptance evidence. Material below describes earlier stages and must not be treated as pending setup, permission to rerun a trial, or permission to enable public photos. Existing expiry is unchanged.


Update: the parent subsequently applied and verified Phase A SQL, without deploying its Edge harness or creating storage. See [Phase B](phase-b/README.md) for that evidence and the next review-only work. The original preparation report follows.

**Prepared for parent review; nothing in this bundle has been applied remotely.** Target only the dedicated Supabase Free project `qmpdinzendwpkqhtqskz` (`qlist-photos`, us-west-2). Keep live qList photos off. No Netlify/Firebase changes, production lists/photos, new keys, paid services, public URLs, bucket, cron or real object writes.

The direct user request in this task was “remove the associated spaces in the UI too.” Accessible Spaces and qList Pages were checked; none were returned and nothing was deleted. That request did not cancel qList work. The parent subsequently requested this trial preparation explicitly.

## Exact review surface

- `supabase/migrations/20261002235210_qlist_photo_trial_phase_a.sql`: created with official Supabase CLI 2.119.0 `migration new`, then implemented and tested on local PostgreSQL 17.11. Creates exactly four tables in private schema `qlist_photo_trial`: budgets, operations, items, objects. Public RPC `qlist_photo_trial_rpc(text,jsonb)` and private reconciliation helper use `SECURITY INVOKER`, empty search paths, explicit service-only execution and RLS on every table. Existing application tables/settings are untouched.
- `index.ts`, `handler.ts`, `deno.json`, `deno.lock`, `package.json`, `package-lock.json`: separate admin-only `qlist-photo-storage-trial` function. The exact reviewed SDK gate remains `verifyAuth(req,{auth:'secret:default'})` with `data.authMode==='secret'`; `verify_jwt=true`. Privileged RPC client is created **after** this gate using official `createAdminClient({auth:{keyName:'default'}})`. No raw-key comparison, credential retrieval, logging or manual forwarding.
- `rollback.sql`: stop flag, fence pending operations, revoke only this trial's RPC/schema/table access. No DROP, TRUNCATE, DELETE, refund, evidence removal, production change or auth/key/billing change.
- `deploy-payload.json`: complete supported deployment action arguments for parent inspection/execution, including source/config/locks. It is inert JSON, not an auto-deployer.
- `postgres-results.json`, `handler-results.tap`, `validation.json`: local verification evidence. `test-postgres.py`, `test-harness-postgres.mjs`, `handler.test.ts`: reproducible tests.

The SQL files use explicit BEGIN/COMMIT. Execute the reviewed SQL in one transaction using a supported SQL action; if a migration runner owns the transaction, review its handling of these explicit boundaries first. Do not run SQL statements individually. A pre-existing schema/RPC is an error, not a reason to overwrite or reset data. This bundle does not include a bucket migration: Phase B requires separate review after hosted Phase A passes.

## Limits and accounting

- One fixed synthetic list `PhotoDemo`; item IDs `trial-*`, operation IDs `phasea-*`. HTTP harness accepts **only one named case**, never user IDs, paths, payload digests, cleanup-proof booleans or SQL.
- Global and list limits: 10 MiB, 20 current-or-reserved photos, two outstanding uncommitted reservations, 100 admitted operations for the entire trial, 100 items/tombstones. Metadata and deleted-item markers are retained. No daily reset.
- Reserve 416 KiB before staging. Full/thumbnail size ceilings are 384 KiB / 32 KiB. Phase A stores **no image bytes**. Its fixture sizes come from the v4 gradient/portrait results; hashes explicitly represent synthetic strings and are not image digests.
- Byte and admission counters are reconciled from at most 100 operations while holding global-then-list locks. Constraint failure rolls back the complete admission, including newly created item/object metadata. Committed old versions stay charged until cleanup; pending or expired operations keep their full reservation. One global lock deliberately serializes this small trial, not a proposed production throughput design.
- Database admission closes 24 hours after the migration transaction starts. Leases last at most 60 seconds. The function additionally expires at **2026-10-04 00:00:00 UTC**. After expiry, stop and review a new deadline; do not silently extend it.
- Status/verification reads have 100-call and 5 MiB logical-response budgets, charged before return with conservative accounting overhead. Other RPC receipts are not counted as object delivery. There are no real object reads in Phase A. These are application limits, not provider bandwidth/billing measurements. Keep the project Free.
- A retry with the same canonical request returns its durable operation without a new admission. Different request data with the same operation ID is rejected. Replay of an old committed operation returns its historical commit result and never restores it as current.
- Cleanup is valid **only for Phase A**: all simulated writers execute under database locks; cleanup itself records simulated absence and releases charges atomically. No caller can claim physical deletion with a boolean. This proves nothing about eventual remote Storage writer termination. Do not reuse this cleanup function for real objects.

## Verified locally

`postgres-results.json`: **15 integration tests passed on PostgreSQL 17.11**, built from the checksum-verified official source. Tests use separate `psql` processes, independent transactions and overlapping lock holds for capacity, idempotency and replacement races. They also cover role grants/RLS, partial staging, deletion fences, stale/ABA changes, SQL failure rollback, old-byte retention, duplicate cleanup, 20-photo/2-reservation/100-operation/100-item limits, read caps, expiry and non-destructive rollback. One integration test runs all five harness scenarios against actual SQL clients.

`handler-results.tap`: **8 HTTP-boundary tests passed on Node 24.21.0**: authorization denial, expiry/method, fixed-case scope, body/MIME/encoding/length limits, stalled-body cancellation, no-store synthetic output, sanitized SDK errors, and a client that ignores cancellation. Timeout never automatically refunds or cleans an uncertain operation.

Deno 2.9.7 type-checks the entry with a frozen dependency lock. Node imports the same entry successfully. These are local runtime checks, not proof of the hosted platform's resolver or gateway behavior. Dependencies: `@supabase/server` 1.9.0, `@supabase/supabase-js` 2.117.2, `@supabase/middleware` 1.0.0, `jose` 6.2.12; full transitive integrity pins in both lockfiles. JOSE's resolved patch is newer than the old v4 handover's 6.2.0 and is included explicitly for review.

The local PostgreSQL cluster listens only on a private Unix socket in a temporary mode-0700 directory, with TCP disabled; it is stopped after tests. No hosted DSN or credentials are accepted by the test runner. No production tests/data were touched.

Reproduce with PostgreSQL 17.11 binaries and Node 24.21.0 available:

```sh
QLIST_TRIAL_NODE=/absolute/path/to/node python3 test-postgres.py /absolute/path/to/postgresql/bin
node --test handler.test.ts
deno check --config deno.json --frozen-lockfile index.ts
```

Run `npm ci --ignore-scripts --no-audit --no-fund` inside this standalone trial directory only if Node SDK dependency checks are needed. The root application's node_modules is a symlink; do not install through it. The SQL runner creates fresh **local** databases per test; it never resets the hosted project.

## Parent execution sequence, only after exact review

1. Re-read the project's organization/Free-plan status, schema, functions, buckets and policies. Earlier read-only project metadata reported ACTIVE_HEALTHY and PostgreSQL 17.11.0.002. Stop on unexpected existing trial objects, schema exposure, paid plan, permission mismatch or unknown pending writes.
2. Review and apply only the Phase A SQL. Check there are exactly four new private tables with RLS, no public/anon/authenticated privileges, no definer functions and only the two intended service-role functions. Confirm the schema is not on the exposed-schema list. Run provider advisors after application; local tests do not replace that hosted check.
3. Inspect `deploy-payload.json`, confirm `verify_jwt:true`, the pinned auth gate, fixed synthetic cases and deadline. Deploy **only** `qlist-photo-storage-trial`; preserve `qlist-photo-benchmark` v4. If the platform rejects lock/runtime configuration, stop and report; never weaken authorization to make it deploy.
4. Verify unauthenticated and nonmatching-key calls are denied using supported Dashboard/session tooling. No raw key extraction or new keys. An authorized supported invocation route is still required; the connector exposes deployment but no invocation action.
5. Run these POST JSON bodies sequentially, once each: `{"case":"status"}`, `{"case":"smoke"}`, `{"case":"replacement-race"}`, `{"case":"delete-during-stage"}`, `{"case":"partial-cleanup"}`, `{"case":"status"}`. Together they admit six operations. Inspect returned evidence/assertions and database state; normal end state is two current simulated photos, 42,424 used bytes, zero reserved bytes and zero pending operations. Do not call an interrupted race “passed” if it returns `already_run`; inspect durable state rather than reset it. Concurrent commit branches are internal to the race case.
6. Stop and return gateway, function logs, SQL state, remaining objects and budget evidence. On a problem, use the non-destructive stop rollback and preserve evidence. No Phase B bucket, real images or production rollout is authorized by this bundle.

Remaining verification: hosted gateway secret-default plus JWT behavior; PostgREST resolution and existing service role grants; hosted race/results; provider advisors; real-object writer termination/deletion proof; image processing/storage/egress measurements. Real browser/mobile UX and any future public photo authorization design remain later work.

## Source/provenance

- Supabase current auth/SDK guidance: https://supabase.com/docs/guides/functions/auth and official package `@supabase/server@1.9.0` source. Generic documentation suggests disabling gateway JWT for some service calls; this trial deliberately preserves the already-approved `verify_jwt=true` gate.
- Function revocation: https://supabase.com/docs/guides/troubleshooting/how-can-i-revoke-execution-of-a-postgresql-function-2GYb0A
- Supabase changelog checked before implementation: https://supabase.com/changelog.md and https://supabase.com/changelog/postgres-15-19-17-11-breaking-changes . This trial uses none of the affected extensions/custom operators.
- PostgreSQL official source: https://ftp.postgresql.org/pub/source/v17.11/postgresql-17.11.tar.bz2 ; SHA-256 `dd27f2b3c59e73ed14aa3324901242bf69a032a6347805f274e6260322d42979`, matched published checksum. Built locally without optional ICU/readline/zlib/SSL; this is isolated test tooling, not a hosting configuration.
- Supabase CLI official v2.119.0 Darwin arm64 archive SHA-256 `cc80ee3a681a2ae735e6d494d9defc56aa6746b487980f6eed39fed8a98f0760`, matched release checksums.
- Deno official v2.9.7 Darwin arm64 archive SHA-256 `5cd46d6268f6f78f5d88bdc7159d20bd44cdaa4b3303474839f87ec6fe7ae25c`, matched release checksum.
