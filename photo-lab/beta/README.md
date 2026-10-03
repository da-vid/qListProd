# qList photos: simplified local review

October 3, 2026. This supersedes the provisional seven-day beta design at `2047d249`. The user approved simplifying the first version. Nothing here is deployed. Production photos and all new service controls remain disabled. The existing hosted trial, its counters and its `2026-10-04T00:00:00Z` expiry are unchanged.

## Product behavior

One compressed JPEG belongs to each text item. The same JPEG supplies the small preview and expanded view. Anyone with the selected list link can view, replace or remove it, matching the accepted shared-list access model. Short/custom list links can be guessed; there is no claim of private ownership or individual revocation.

Photos have a small overall storage allowance. When it is full, new uploads stop; existing photos can still be viewed and removed. Text remains independent. There is no photo TTL, seven-day product expiry, or lifetime request/read/item allowance. The only remaining user choices are the actual beta list and whether to authorize a limited rollout.

Proposed implementation defaults, **not applied to hosted budgets**:

- 32 MiB of accounted beta photo storage; each admitted image reserves 384 KiB until verified cleanup. This accommodates up to 85 simultaneously charged versions. Current, replacement, cleanup-pending and unknown uploads all count. Replacement requires temporary room and preserves the old photo until commit.
- 64 MiB project-wide accounted photo storage, including unchanged legacy trial used/reserved bytes. Beta accounting starts separately; no trial counters or history are erased or reset.
- Four concurrent unexpired processing operations. Ambiguous uploads keep their byte charge but do not occupy an encoding slot forever.
- 60 upload requests per fixed minute and a separate 60 read/maintenance requests per fixed minute. Reconciliation uses the latter allowance. No lifetime request/read cap. These are abuse safeguards, not billing guarantees.
- New ledger allocations stop at 8 MiB of server metadata, with reserved room for recovery. This is a metadata storage bound, not a historical operation/item allowance. Replay records prevent a duplicate operation from uploading again.

The provider-enforced **Free organization/project with no paid fallback or upgrade** is the no-charge boundary, to be reconfirmed before any hosted setup. Application counters do not cover all provider protocol/response overhead, Firebase reads, or rejected Edge invocations. They cannot guarantee availability under abuse. No plan or billing setting changed here.

## Image path

The existing browser normalization produces baseline JPEG ≤512 KiB and ≤1280 pixels, applies orientation and strips metadata. Unsupported HEIC has a clear JPEG/export fallback. Actual iPhone/Android camera behavior remains untested.

The accepted server codec independently validates/reencodes the input. The beta stores and delivers only its full JPEG, ≤384 KiB and ≤1280 pixels. The codec still computes its existing thumbnail internally, but that output is discarded; it is not another object, write, read, reservation or network response. This reuses the exact reviewed codec without changing its implementation.

Immutable random operation keys, no overwrite, expected versions and deletion epochs fence competing work. The client receives no privileged key, bucket URL or signed URL. The normal production app does not import `beta-entry.ts`; `CLIENT_ENABLED` remains false.

## Deletion and recovery

`control.enabled` and `RUNTIME_ENABLED` gate **uploads only**. Separately enabled maintenance/service controls permit reads, read-only operation status, version-checked photo removal and confirmed text-deletion cleanup. `stop.sql` stops uploads while preserving these paths. A complete emergency shutdown can still stop the service, but storage and history must be retained for later recovery.

The text verifier distinguishes a valid existing item, an exact Firebase JSON `null`, and an invalid/unavailable response. A browser DOM-removal hint never authorizes deletion by itself. `delete` requires positively observed item absence under a valid list claim. A present, malformed or unreachable item preserves the photo and never creates a permanent tombstone. Photo-only removal checks the expected version, does not tombstone the text item, and permits later re-addition.

Cleanup intent is durable in the server ledger (`cleanup` operations and fenced item associations). Browser markers are only helpful hints. Each successful ordinary read also makes a best-effort maintenance pass over **one server-known item in the same allowlisted list**, using a durable round-robin cursor. There is no public enumeration/reconciliation endpoint, separate credential, paid scheduler or manual key entry. A trusted server operator can invoke the same bounded method. A missing item read also fences and cleans its own association.

Reconciliation deletes only objects already authorized for removal/replacement, or photos whose associated text item is positively absent. It is not an expiry policy. A text outage or malformed record does not authorize deletion. No visits means no automatic maintenance execution; durable work resumes on the next read or an operator pass. The client and server routes remain scoped to the exact selected list.

Each cleanup pass removes at most one settled object and verifies exact absence before releasing its reservation. Remaining work stays recorded for another pass. A failed upload retains its full charge if a physical PUT outcome is unknown. A late successful receipt records settlement, then cleanup can proceed even with uploads stopped. A missing object, timeout or expired lease is **not** proof that an unknown writer cannot still finish. Unknown charges are never automatically refunded or retried, including after restart. They no longer block all processing capacity; only their finite storage charge remains. Rare permanently lost receipts require existing privileged operator/provider investigation before any release. There is deliberately no public or string-attestation API for asserting a writer settled.

Firebase and Storage cannot share an atomic transaction. An item deleted immediately after the last text check can briefly leave an orphan; subsequent reads and bounded reconciliation repair confirmed deletions. Already downloaded bytes cannot be recalled. These limits remain explicit; no distributed-transaction guarantee is claimed.

## External setup permissions: not performed

1. Reconfirm the dedicated Free project `qmpdinzendwpkqhtqskz`, organization spending boundary, actual legacy budgets/inventory, function configuration and hosted database advisors. Do not extend the old trial expiry, reset counters or rerun its mutations.
2. Review/apply only the still-disabled `supabase/migrations/20261003040950_qlist_photo_beta_disabled.sql`. It creates a private RLS-protected ledger and service-only invoker RPCs. Its guard requires the exact accepted legacy state and stops on unexpected Storage policies. It never edits the trial. No anonymous/authenticated table grants or Storage policies are proposed.
3. Create private bucket `qlist-photo-beta-v1` with `public:false`, `fileSizeLimit:393216`, `allowedMimeTypes:['image/jpeg']`. Verify direct client read/write/list denial; no public/signed URLs, upsert or scheduled deletion.
4. Deploy the **new** `qlist-photo-beta` function from `review/disabled-deploy-payload.json`, initially `verify_jwt:true`, `RUNTIME_ENABLED=false`, `MAINTENANCE_ENABLED=false`. It uses the existing server admin client, without minting/copying keys. Do not change the old trial function.
5. Authorize narrow live verification of the chosen list/sample item, then bounded hosted synthetic acceptance. The Firebase verifier makes credential-free GETs only to `https://qwiklist.firebaseio.com/v2/listClaims/<encoded-list>.json` and `https://qwiklist.firebaseio.com/v2/lists/<encoded-list>/<encoded-item>.json`, with credentials omitted, no redirects, a 2-second timeout and an 8192-byte response bound. The claim must be true; only exact item `null` proves absence. No Firebase writes, service account, Admin SDK, rules/auth changes or persistent privileged Firebase access are proposed. Deployed public read rules have not been verified live; if they deny access, stop rather than create credentials or broaden rules.
6. After acceptance and explicit rollout approval, enable anonymous ingress on the **new function only**, enable its service/upload flags and set database control to `{"enabled":true,"maintenance":true,"lists":["<approved exact list>"]}`. There is no product activation deadline. Administrative control updates remain outside service-role privileges. The server allowlist is not published in client JavaScript.
7. Separately release the reviewed client entry. Preserve the normal text-only build for rollback. Stop uploads with `stop.sql`, retaining reads/deletion. Restore only consistently reconciled ledger/object state; never restore an older ledger over newer objects or refund unknown writers to reopen space.

The source design for credential-free Firebase validation is locally verified; **live Firebase access and the new hosted stack are not yet verified**. Hosting acceptance is still needed before rollout. No new user decision is required for compression, version checks, deletion safety or retry mechanics.

Current [Storage access-control documentation](https://supabase.com/docs/guides/storage/security/access-control) confirms that service credentials bypass RLS and belong only on the server. The [Supabase changelog](https://supabase.com/changelog) was checked October 3; no new SDK/dependency or affected extension was introduced. The Markdown endpoint was unavailable, so official HTML was used.

## Local checks and reproducibility

- 137 Node tests: 34 core, 52 photo, 31 existing trial/phase-B, 20 beta. Four additional release-build tests pass (141 total).
- Eleven temporary PostgreSQL checks, including actual RLS/privileges, CAS races, unchanged legacy data, stop behavior and reads/status/deletion after upload closure. Temporary cluster stopped; no network listener or hosted DB access.
- Chrome 154 phone-sized touch emulation: single stored image, second-client read, reload, continued text edits and cleanup while uploads remain paused. Eleven photo requests, all loopback; zero external requests/uploads. Screenshots visually inspected. Not a physical-device test.
- Root/beta TypeScript, frozen cached Deno check, normal/photo builds and modern/maintenance/rollback builds. Normal production asset hashes remain unchanged; no photo feature import was added.

Evidence: `results/checks.json`, `results/postgres.json`, `results/browser.json` and the two screenshots. The original hosted trial evidence remains separate and is not acceptance of this new design. PostgreSQL and browser tests exercised separate local paths; neither proves a complete hosted stack or provider recovery of a permanently lost writer receipt.

The exact immutable codec and synthetic fixtures are included in the checkout/source bundle, with their existing licenses and pins:

- `photo-lab/storage-trial/phase-b/codec.js`: SHA-256 `75a280f9a74ad26420d10cb68d8bbea9689e31b2e6bf6d2cd58c45aacdc27ab2`
- `photo-lab/storage-trial/phase-b/fixtures.js`: SHA-256 `bda03b92994e8d381ef70a559bf7bb54423cdd9ca518d904cf3cd0ba04b0d629`

The codec bytes were compared to the previous reviewed deployment payload; fixture bytes match the previously committed asset pin. No replacement dependency was downloaded or rebuilt.

With Node 24.21 and the existing installed dependencies:

```sh
npm run test:photo-beta
npm run typecheck:photo-beta
python3 photo-lab/beta/test-postgres.py /absolute/pg/bin /absolute/node
# Existing loopback photo Vite preview on 127.0.0.1:4174:
node photo-lab/beta/browser.mjs /absolute/playwright/index.mjs
python3 photo-lab/beta/build-review.py
```

The database runner only accepts local binaries and uses a temporary private Unix socket. The review builder writes inert JSON and never deploys.
