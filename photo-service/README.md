# qList photos — local production review

Prepared October 3, 2026. **Nothing in this directory has been deployed.** The user approved ordinary shared-list photo access and asked for a camera icon beside each grab handle, without larger rows or persistent explanatory notices. This supersedes the earlier selected-list beta proposal. External setup and final deployment remain for the parent task to review and apply.

## Result

The modern client adds a 44 × 44 camera button immediately beside the grab handle. It has an accessible Add photo / Change photo name, title and keyboard focus. The optional thumbnail opens the same stored JPEG. Normal item rows remain 45 px high. Checkbox, text editing, drag and keyboard ordering still work. The renderer now addresses delete and drag buttons by class instead of assuming their position among all buttons. Photo failures leave the text list usable. The optional About & Privacy dialog describes photo handling; no new persistent fine print appears.

Browser normalization produces baseline JPEG, at most 512 KiB and 1280 px per side, with orientation applied and metadata removed. The server re-encodes one JPEG at most 384 KiB; no separate thumbnail object is stored. Unsupported HEIC/HEIF gives a local JPEG export instruction; it is not silently uploaded or sent to an external converter. Physical iPhone, Safari, camera capture and actual decodable HEIC have not been tested.

A new endpoint, `qlist-photos`, uses the reviewed processor, failure handling and transactional ledger. The old trial and beta entrypoints remain separate. General access still requires an existing v2 list claim and a valid item, checked by exact credential-free Firebase reads. Possessing the shared list URL grants photo view/edit access just as it grants text access; list addresses are not passwords. CORS limits browser origins, not determined callers. No login, Firebase rule change, paid fallback, new credential or automatic photo expiry is introduced.

Existing defensive limits are retained: 32 MiB of conservative photo reservations for this service, 64 MiB aggregate including unchanged trial reservations, four in-flight jobs, independent 60/min upload and maintenance request budgets, and bounded ledger metadata. Failed deletion remains charged until absence is verified. Historical counters are never reset. Upload stop preserves viewing, deletion and reconciliation. Free-plan exhaustion can interrupt photos; these controls do not guarantee availability or modify existing Firebase billing.

## Read-only production evidence

- `https://www.qlist.cc/release.json` reports clean modern/v2 commit `c7b163aacbf71422ac5774703072c6141b8101d4`, already an ancestor of this branch.
- Netlify's published deploy is `6abf472505e5bd2a66b61559` (“Approved qList modern c7b163a”). Rollback URL: `https://app.netlify.com/projects/qlist/deploys/6abf472505e5bd2a66b61559`. Auto publishing from master is **on**; do not push or merge master as an incidental setup action.
- Supabase project `qmpdinzendwpkqhtqskz`, organization `fcqzrsaycccyhdjnzzbx`, is healthy on **Free / tier_free**. No plan or billing setting changed. Supabase's current cost-control documentation states Free projects are not charged: https://supabase.com/docs/guides/platform/cost-control . Do not upgrade, enable paid fallback or treat Pro Spend Cap as an equivalent substitute.
- Only `qlist-photo-benchmark` v4 and `qlist-photo-storage-trial` v3 exist, both with JWT verification enabled. Only private bucket `qlist-photo-trial-v1` exists; object count is zero and no Storage object/bucket policies exist. No beta or production photo schema exists.
- Trial global values: used/reserved bytes, pending, photos all zero; operations 9, items 6, reads 6, read bytes 2359296; blocked batch, complete continuation; expiry **2026-10-04T00:00:00Z**. Preserve all values and historical rows.
- Narrow public GET of `/v2Control/writesEnabled.json` returned `true`. This proves only that flag is readable. Live list claim/item reads have **not** been verified because no authorized synthetic production list/item was supplied. No guessed list was read and no personal data was enumerated.

## Local validation

- 143 Node tests: text UI/model, release/CSP isolation, normalization, mock/HTTP contracts, full photo failure cases, trial and beta ledger behavior, general-list isolation and production SDK routing.
- Root and beta TypeScript checks; frozen, cached Deno production entrypoint check.
- Normal, isolated photo-preview, modern, maintenance and rollback builds.
- Temporary local PostgreSQL: 11 checks covering service/anonymous privileges, CAS races, quota guards, actual JPEG round trip, cleanup failure/retry, unchanged legacy state and pg-safeupdate. No hosted database used.
- Firebase demo emulator: two production privacy-rule and maintenance/read-only UI integration tests. No live text data changed.
- `results/browser.json` plus 12 screenshots: loopback Chrome at widths 320, 390 and 1024, actual 12 MP synthetic image file and local codec/HTTP/files. Add/change/preview/remove, upload-stop cleanup, camera vs drag keyboard handling, checkbox/delete controls, short/long names and a simulated wrapped-row layout passed. Normal row heights, padding and checkbox/handle positions did not change. Zero external requests or hosted uploads. The existing real editor remains single-line; the wrapped fixture is a layout stress test.
- Normalization evidence lives in `photo-lab/results/browser/`, including all eight EXIF orientations, large synthetic raster inputs and metadata/byte/dimension checks. The latest loopback run passed, including 12 MP and 24 MP synthetic images and a detailed image that exercised quality and dimension reduction. These are desktop Chrome emulations, not physical device certification.

## Exact setup and deployment order — review before external writes

1. Verify the consuming machine's ZIP SHA-256, then all `photo-service/review/manifest.json` source hashes. Require a clean committed build whose modern `release.json` commit matches the manifest. Preserve the current published Netlify deploy above. Recheck the Free tier, current release and the narrow inventory/counters above immediately before setup; stop if they differ. Do not expose keys or enumerate Firebase content.
2. Review and approve the concrete external changes together: new private schema/service-only RPCs, private bucket, **new anonymous-invocable function** with `verify_jwt:false`, database activation for general claimed lists, tiny synthetic hosted acceptance and publication of the exact modern artifact. This public endpoint changes the access surface. If using browser UI, its access-expansion confirmation is required at action time even with general release approval. No old function JWT setting changes.
3. Apply `supabase/migrations/20261003054619_qlist_photos_disabled.sql` to the pinned project with the authorized Supabase migration tool. It starts with upload and maintenance gates off. It fails transactionally if a beta schema, unexpected Storage objects/policies or changed accepted trial counters are present. Never bypass a failed guard or reset state to make it pass.
4. Create private bucket `qlist-photos-v1` using exactly `review/bucket.json`: public false, 393216-byte object limit, JPEG only. Add **no** anonymous/authenticated Storage policy. Never directly edit Supabase's storage metadata tables.
5. Deploy the new function with the exact source-complete `review/deploy-payload.json`; use the pinned project, entrypoint and import map. `supabase/config.toml` declares only the new function's public invocation setting. The server uses its existing default server credential environment; no new secret, key export, client service key or admin Firebase credential is needed. Verify provider policy allows this new function and that the old two functions remain unchanged.
6. With DB gates still off, verify fail-closed behavior and private-bucket denial. Resolve one explicitly authorized synthetic production list and item, or create it through the supported text UI during the authorized acceptance task. Read only its exact claim/item paths without credentials. Stop if validation does not match the deployed Firebase rules; do not loosen rules or add privileged reads.
7. After approval, run `activate.sql` to enable general claimed-list photos for acceptance. This is needed before a real hosted round trip; it is **not** a selected-list beta gate. Keep the current text-only frontend published during acceptance. Use tiny synthetic images only; exercise upload/read/replace/remove, failed/ambiguous cleanup accounting and text availability on photo failure. Confirm resulting objects are gone and ledger receipts/counters remain cumulatively retained. Do not reset the ledger, delete its history or extend the old trial. If anything fails, run `stop.sql` and retain evidence for review.
8. Only after hosted acceptance, publish the exact `release-artifacts/modern/` directory through the already configured Netlify workflow. Avoid an incidental master push while automatic publishing is on. Verify public `release.json`, source hashes and CSP, then a supported-browser synthetic UI check. No real-user image is needed.
9. Roll back client behavior by republishing the retained Netlify deploy `6abf472505e5bd2a66b61559`, and stop new uploads with `stop.sql`. Keep maintenance enabled so existing photos can be removed/reconciled. Do not roll back/delete photo tables, bucket contents or receipts as a shortcut. Keep trial expiry unchanged.

## Reproduce locally

Use Node 24.21.x and the lockfile. The isolated preview is `npm run dev:photos`, `http://127.0.0.1:4174/photos.html`; it uses local mock storage only. Production host guards prevent the real endpoint from being selected by that preview.

```sh
npm run typecheck
npm run typecheck:photo-beta
npm run build
npm run build:photos
npm run build:release
node --test --test-timeout=15000 test/*.test.ts test/release-build.integration.ts photo-lab/*.test.ts photo-lab/beta/*.test.ts photo-lab/storage-trial/*.test.ts photo-lab/storage-trial/phase-b/*.test.ts photo-service/*.test.ts
python3 photo-service/test-postgres.py /path/to/postgres/bin /path/to/node
node photo-service/browser.mjs /path/to/playwright/index.mjs
node photo-lab/browser-normalization.mjs /path/to/playwright/index.mjs
python3 photo-service/build-review.py
```

Browser harnesses require the loopback preview running and installed Chrome. PostgreSQL starts an isolated temporary Unix-socket cluster. For Deno, use the committed import map/lockfile and `check --cached-only --frozen` after dependencies have been supplied. Firebase emulator tests require Java 21 and the demo-only configuration; never substitute the live project.

Remaining release conditions: external-action review, exact live synthetic claim/item validation, hosted acceptance and final clean artifact publication. Real iPhone/Safari/HEIC behavior remains unverified. General-list access and no automatic expiry are implemented as requested; no additional beta-list selection is needed.
