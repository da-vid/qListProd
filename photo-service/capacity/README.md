# Production Free storage capacity update

Prepared for parent review/application. This package does not publish a frontend, mutate hosted data, change plans/billing, add credentials, reset counters or extend the trial. The deployed frontend remains commit `3f283040d72ff7aecbfa0245d8a86bc3a3a44700`, Netlify deploy `6ac1509e1b9c5731afb9f3e8`.

## Allowance and scope

Both the production service cap and aggregate cap become **1,000,000,000 bytes**. This is a conservative decimal interpretation of Supabase's Free **1 GB** Storage allowance. The pricing/billing text does not explicitly define its byte unit; the storage guide's sample display SQL uses 1,073,741,824 bytes for “GB”, which alone is not proof of the billing unit. We deliberately do not allocate the larger binary quantity.

Supabase applies the quota across the entire organization, not separately to projects, schemas or buckets. Storage billing/quota usage is a GB-hour average over the billing period, not simply current bytes. A live byte ceiling cannot clear a restriction caused by prior billing-period usage.

Official sources checked 2026-10-03:
- https://supabase.com/docs/guides/platform/billing-on-supabase
- https://supabase.com/docs/guides/platform/manage-your-usage/storage-size

Read-only inventory found one visible project in organization `fcqzrsaycccyhdjnzzbx`, on `free` / `tier_free`: `qmpdinzendwpkqhtqskz`. Its two buckets were `qlist-photos-v1` and `qlist-photo-trial-v1`, both private, with zero objects. Production ledger revision 311 had zero charged operations, pending operations or unknown writers; historical receipts remained. Trial used/reserved bytes were zero, with operations 9, items 6, reads 6, read bytes 2359296 and expiry `2026-10-04T00:00:00Z` unchanged. These are observations, not migration requirements to zero or restore those values.

**Organization allocation condition:** qList currently receives this sole-project allocation. Recheck the organization's complete project inventory and usage before applying. If another project shares the allowance, do not give each 1 GB: pause this rollout and reserve/deduct its allocation first. This project's SQL cannot atomically coordinate future unrelated projects or independent external uploaders. Adding one requires a shared allocation review before enabling its writes. Within this project, unaccounted objects in every bucket are included on each transaction; such observation does not replace reservation coordination for a new independent writer.

## Components and accounting

- `photo-lab/beta/ledger.ts` supports trusted SQL `storageBudget` metadata, bounded by `FREE_STORAGE_BYTES = 1_000_000_000`. Production receives the new service and aggregate values from its RPC. Old RPC/beta snapshots retain the 32/64 MiB defaults; the historical beta and trial entrypoints/migrations are not changed.
- `20261003193000_qlist_photos_free_capacity.sql` checks exact deployed v2 load/swap definitions, locks the existing ledgers, creates one service-only, invoker-security read helper, then replaces only the two production RPC definitions. It never updates the ledger or trial rows, Storage objects/buckets, constraints, policies, control flags, authentication, or expiry.
- The production aggregate is nonreleased-operation reservations + unchanged trial used/reserved bytes + conservatively computed external bytes. External bytes cover trial physical excess over its recorded charges, other buckets, untracked production objects (including objects whose operation is released), and mapped-object bytes above their reservation. Already reserved expected JPEGs are not double-counted. Invalid/missing object sizes consume the allowance; the external component saturates at the allowance, which denies new growth while permitting nonincreasing recovery.
- External usage is included in the CAS token and recomputed under the existing ledger transaction. A changed observation rejects a stale snapshot. Existing reservation-before-upload, unknown-writer handling, verified-absence cleanup and historical accounting remain intact.
- `build-review.py` emits the exact backend payload and both new cap values. The only changed runtime payload file relative to deployed v2 is `photo-lab/beta/ledger.ts`; the empty-POST handler is unchanged (`33a05ecc619007823626945ab4c2f93410443be9f9bfff02709e6c74283e898d`). Source, migration and payload hashes are in the package manifest.

## Other enforcing limits retained

Stored JPEG/object/reservation maximum: 393,216 bytes. Upload contract: baseline JPEG <=524,288 bytes and <=1280px. Pending processing: four. Upload admissions: 60/minute. Maintenance: independent 60/minute. SQL new-history allocation bound: 8,388,608 bytes; total-state constraint: 16,777,216 bytes. The existing request/SQL timeouts, platform compute/egress/invocation quotas and free-plan restrictions still apply.

At zero other usage, 2,543 simultaneous full reservations account for 999,948,288 bytes, leaving 51,712 bytes. Replacements temporarily require an additional reservation; retained cleanup/unknown writes occupy slots. This remains conservative accounting rather than charging only compressed physical bytes. Historical metadata can eventually stop new allocations before the byte cap. No unrelated limit is loosened and no availability/cost guarantee is inferred.

## Apply after review

1. Recheck organization plan/projects, current function v2 and source hashes, exact production SQL definitions, bucket configuration, policies and aggregate usage. Use `preflight.sql` for a read-only local-project snapshot. If source/permissions/inventory differ, reconcile rather than disabling guards. Keep observations/receipts; do not reset any value to a previous snapshot.
2. Deploy the package's `deploy-payload.json` to **existing** `qlist-photos`, preserving `verify_jwt: false`, entrypoint/import map and current runtime flags. Existing server environment only; no credentials/plan changes. Before SQL migration the new runtime intentionally falls back to the old smaller limits.
3. Apply the exact forward migration to project `qmpdinzendwpkqhtqskz`. Existing traffic can retry across the RPC definition/CAS-token change. Both the backend and SQL change are necessary; applying only one leaves the old runtime or SQL limit constraining uploads.
4. Run `verification.sql`: both returned caps must equal 1,000,000,000, the helper must exist and be service-only, old controls/history/expiry must be retained, and the deployed runtime hash must match the reviewed payload. Do not perform near-gigabyte hosted load tests. Relevant boundary/concurrency tests are already local.
5. Leave Netlify and the frontend entirely untouched. Retain the current backend payload as a recovery artifact. No reapplication of the old bootstrap migration or activation script is needed.

## Safe rollback

Apply `rollback.sql` only against the exact expanded definitions and helper it checks. It lowers service/aggregate limits to 33,554,432 / 67,108,864 bytes **without changing a single stored charge, reservation, object, history entry or control flag**. External accounting remains active. When usage exceeds the smaller limits, new growth is blocked but reads, receipts and nonincreasing cleanup remain possible; it never pretends usage is below a limit or deletes photos to fit. The new runtime reads the lower RPC limits immediately, so backend redeployment is not required for capacity rollback. Never restore an old ledger snapshot. Returning to the expanded quota after rollback needs a newly guarded migration from that state; replaying the initial migration is deliberately rejected.

## Evidence

- 162 Node tests, root/beta TypeScript and cached frozen Deno checks passed.
- Original production PostgreSQL integration suite: 11 checks, unchanged behavior.
- Capacity PostgreSQL suite: 15 checks. It covers exact source guards, preservation, service-only access, all-bucket/trial/unknown-object accounting, both old-cap crossings, limit-1/limit/limit+1, concurrent last slot, stale external observations, real local JPEG/HTTP round-trip, retained rate/concurrency/history bounds, and rollback above the old cap. `postgres-results.json` has exact results and SQL hashes.
- The full 2,543-object local accounting read completed within its 4-second test bound. This is local performance evidence, not a hosted latency claim.
- No frontend source or artifact rebuild/replacement, real user-photo access, hosted upload, external data write, plan change or new credential occurred during preparation.
