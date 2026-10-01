# Deployment, verification, and rollback

## Verified production baseline (2026-10-01)

- Repository: https://github.com/da-vid/qListProd
- Production branch: `master`
- Published commit: `001fd8f291e25da26f4fdd7e5e373055edece7ce`
- Published deploy: https://app.netlify.com/projects/qlist/deploys/615b632e71eb6f0007b6422b
- Immutable deployed page: https://615b632e71eb6f0007b6422b--qlist.netlify.app
- Public site: https://www.qlist.cc (apex redirects to www)
- Build log: no build steps; publish from `/`; zero functions.
- Dashboard build settings: Node 0.12.2, Ubuntu Noble 24.04, no build/publish command/directory set. Branch deployment and PR previews enabled.
- Public HTTPS certificate verified through 2026-11-01. Dashboard showed an inconsistent expired-2016 warning; actual renewal/account metadata needs follow-up. HSTS was present.

None of these dashboard settings were changed for this baseline. Runtime overrides live only in this development branch's `.nvmrc`/`netlify.toml`.

## Current review process

Run `npm ci --ignore-scripts`, `npm run check`, and `npm run test:emulator` (Java 21+). Push only `codex/safe-development-baseline`; PR #1 remains a draft. Netlify first checks the browser-local `dist/` build, then builds and publishes `dist-staging/` in preview context. Production context is rejected, and production hostnames are blocked at runtime. The hosted bundle pins only the approved `qlist-staging` project/database, with a shared synthetic-data notice, exact-host WebSocket CSP, and no credentials or analytics. Local browser-only builds remain available.

Review `/Demo23`, `/AbC234`, `/new`, title/item editing, check/delete, ordering controls, completed-item confirmation, links, persistence, keyboard focus, and mobile layout. Check errors and request destinations. Emulator tests and a two-client synthetic cloud SDK test pass. The hosted staging preview is ready for independent cross-device browser verification. The Netlify review drawer is intentionally blocked by the strict frame CSP; use a branch-deploy permalink for a clean preview.

See [compatibility.md](compatibility.md) for exact data shape, old-client risks, offline limitations, and approval needed for a dedicated shared test database.

## Before production

1. Verify the actual Firebase project's owner, rules, usage/billing, and backups. The historical endpoint is `qwiklist.firebaseio.com`; an email referring to QuicklistProd has not established the account mapping.
2. Test restoring a backup into an isolated environment. Never publish private exports in Git or previews.
3. The separate synthetic-data preview is provisioned and cross-client sharing is verified; keep it isolated from production and retain the staging cutoff.
4. Resolve unsafe old-client whole-list writes before mixing modern random item keys with old numeric writers. Define a compatible bridge or cutover/version boundary and a recovery path for users with old tabs. Preserve existing list URLs.
5. Review production capability-link access, validation, error handling, privacy wording, abuse controls, and dependency/tooling advisories. Do not require sign-in or change rules without explicit approval.
6. Implement and review an explicit production adapter/configuration. This branch has no production mode. Do not repurpose URL parameters or remove guards ad hoc.
7. Finish visual, keyboard and real mobile/touch checks, authorize the release, and record the deploy ID before changing production.

## Rollback

No production data was changed. Discarding this preview requires no database rollback. For a future authorized release, retain the legacy Netlify deploy `615b632e71eb6f0007b6422b`, but use the same-schema rollback procedure in the readiness checkpoint once modern writes have been accepted. Verify that immutable deploy is still available before release. Frontend rollback does not undo schema/rule/data changes, which require their own tested recovery plan.

## Remaining verification limits

Production account/rules/backups and the old-client cutover remain unverified. Cloud sharing and desktop interactions have independent browser evidence; actual touch/swipe, sustained edge auto-scroll and the new fades still require browser/device review. See the current checkpoint below.

## Go-live readiness checkpoint — 2026-10-01

**Decision: keep the Netlify site and Firebase service, but do not merge or cut over yet.** The review branch deliberately rejects production builds and production hostnames. UI modernization is ready for further review; recoverability and mixed-client safety are not yet established. No production export, restore, rules change or release was performed for this checkpoint.

### Evidence and remaining checks

Desktop browser QA on `bac3641` passed sticky controls, conditional clear-action endpoints, mouse reorder, toolbar-drop cancellation, keyboard Home/focus visibility, clear-only-checked confirmation and focus restoration. Earlier two-tab synchronization passed. Automated regression tests cover stale checked-only deletes, reconnect, ordering and UI behavior. Actual touch/swipe and sustained edge auto-scroll remain unverified because available browser tools lack touch and hold/dwell. Directional fades need a fresh browser check at top/middle/bottom, after clearing items, with keyboard focus and reduced motion.

The production endpoint in the historical source is `qwiklist.firebaseio.com`. Its owning project, current rules, billing tier, backup status and data inventory still need confirmation in the owner's existing authenticated Firebase console. Do not infer ownership from `qlist-staging` or a similarly named project. This execution environment has no supported console/browser tool; the parent browser worker can perform that read-only inspection. Existing preview access is not administrative production access.

The identified ordering defects in `src/model.ts`/`src/firebase-store.ts` are fixed: priorities retain null/number/string types and key ties use Firebase's integer-key ordering instead of locale collation. Four emulator fixture groups cover equal null/numeric/string priorities and mixed types, including keys `2`/`10`, leading zeros, signed 32-bit boundaries and Unicode; each compares directly to Firebase snapshot order and verifies metadata preservation during read/edit/check/reconnect. Mixed-type move/append tests prove untouched items remain unchanged. Unrepresentable single-item moves reject rather than normalize neighboring data.

Full production inventory/rehearsal is still required: check every actual list, oversized names/titles, nonstandard keys/IDs/extra fields and missing values before selecting production validation rules. The existing synthetic staging policy remains unchanged and is deliberately bounded to numeric/null priorities; string fixtures run only against the isolated emulator policy. Do not apply that staging policy to production. Firebase documents priority-aware iteration and export in [DataSnapshot](https://firebase.google.com/docs/reference/js/database.datasnapshot), and integer-key ordering in [list queries](https://firebase.google.com/docs/database/web/lists-of-data#how_query_data_is_ordered).

Read-only access check: the installed Firebase CLI's `login:list` reports **No authorized accounts**. No supported Firebase console/browser tool is exposed in this execution environment. No login flow, credential inspection, production content export or configuration change was attempted. The missing execution access is an authenticated owner-authorized view of the actual production database's project identity, Rules and Backups pages; a staging owner login alone does not establish that mapping. The parent browser worker should use the existing authenticated owner console, without changing settings. Recommended private backup destination (not created): `~/Library/Application Support/qList/Backups/` outside the repository and `/tmp`, with directory mode `0700` and files `0600`, on verified encrypted storage or a user-selected encrypted vault. Keep it out of shared/synced locations; store data/rules exports and a checksum/source/time manifest together.

### Smallest next batch: recovery and compatibility rehearsal

1. Read-only console inventory: confirm the exact source database/project and owner, current rules, data size and existing backups. Record the live Netlify deploy, domain/TLS, publishing configuration and retained rollback deploys. No settings changes. Determine a private backup destination outside Git, build output, public staging and chat attachments; do not print list contents or credentials.
2. Obtain one complete, authenticated data export plus a **separate rules snapshot**. Require priority-preserving export format: REST `format=export` or SDK `exportVal()`, not `val()`/ordinary JSON reads. Retain any `.priority` and `.value` wrappers unchanged, including metadata on parent nodes. Record UTC timestamp, source identity, byte count and SHA-256 checksum in a private manifest. Root data export does not replace the rules/configuration snapshot. Firebase's [REST export format](https://firebase.google.com/docs/reference/rest/database#section-query-parameters) includes priorities. For ongoing backups, first inspect existing arrangements: Firebase [automatic backups](https://firebase.google.com/docs/database/backups) require Blaze and use billable Cloud Storage; do not upgrade billing merely to do this one-time rehearsal.
3. Restore into a disposable **loopback-only emulator**, not the publicly writable Spark staging database. Prevent all production network connections during rehearsal. Re-export with priorities and compare the complete canonical tree and data types, with zero unintended differences. Keep production content private. A successful download alone is not proof of a recoverable backup.
4. Compare every existing list ID/URL, title, item key, numeric/string ID type, text, checked state, priority and ordered item-key sequence. Compare the original SDK query order against the new rendered order. Opening/reading a copied list must not rewrite content or priorities. Claim creation, if needed, must be confined to the new registry. Use separate copies for add/edit/check/reorder/delete/reconnect tests; untouched records must remain byte/semantically equivalent. Resolve any actual-data inventory exceptions before deployment.
5. Rehearse old online and offline/reconnecting clients against proposed rules, including whole-list saves **and per-item removal**. Rehearse restoring a failed candidate and recovering writes made after the candidate was published. Measure the maintenance interval rather than promising a duration now.

### Proposed cutover to review, not execute

Prefer a short, explicitly approved maintenance window and a versioned data namespace in the **same Firebase database**, preserving list IDs and public URLs. The new adapter would use, for example, `v2/lists`, `v2/listAttrs` and `v2/listClaims`; existing paths remain the preserved legacy snapshot. This needs implementation and a private rehearsal first; it is not part of the current preview adapter.

After approval: establish a rules-enforced write freeze, prove old online/offline writes are denied, take the final priority-preserving snapshot, copy and verify the data into the new namespace, then enable only the reviewed modern write paths and publish the reviewed production build. Keep legacy paths read-only to prevent old tabs from later overwriting current data. A namespace is a protocol boundary for unmodified old clients, not authentication or a new secrecy guarantee. No signup or longer links are proposed.

Blocking only whole-list writes is insufficient: the old client also deletes individual items. Asking users to refresh or publishing new assets does not stop already-open/offline tabs. A refresh/help notice should explain how to preserve pending text, but cannot retroactively add reliable errors to the old bundle. The user must accept the refresh/maintenance behavior. Firebase parent write grants must be audited: deeper deny rules cannot override a broader ancestor allow. See [rule cascading](https://firebase.google.com/docs/database/security/core-syntax#read_and_write_rules_cascade). Never implement a write freeze by adding an ineffective child deny.

The production adapter/build/CSP/host allowlist must be an explicit reviewed change; retain preview isolation and verify the actual Firebase transport hosts. Remove staging-only notices/cutoff/noindex only in the production mode. Check claims, validation, denied-write feedback, telemetry without list contents, TLS, and the final mobile/edge-scroll QA before release approval.

### Rollback boundary and approvals

Netlify can republish a retained successful deploy; new automatic production publishes can supersede it unless publishing is locked. [Netlify rollback documentation](https://docs.netlify.com/deploy/manage-deploys/manage-deploys-overview/#rollbacks). Confirm the original `615b632e71eb6f0007b6422b` artifact is retained, but do not treat it as a safe writable rollback after the new app has accepted data.

If a release fails, freeze writes, preserve a fresh export of post-release data, and publish a maintenance/read-only or known-good **same-schema** build. Prefer fixing forward. Returning to the legacy writer requires a tested reconciliation of all post-cutover changes and approved rules restoration. Never overwrite the database with the pre-release snapshot just to roll back the frontend: that discards valid new edits. A release is not ready until this drill demonstrates preservation of acknowledged writes.

The immediate next action is the read-only owner-console inventory and a private backup/restore rehearsal, followed by any inventory-specific compatibility fixes and a reviewable production-adapter/rules diff. Needed access: verified production owner/read-export access through the existing authorized console/session, plus an agreed private backup location; no new admin keys are requested. Before any live changes, approve the maintenance/refresh approach, exact migration/rules/build changes, rollback procedure and final production publish. The current request authorizes preparation only, not those live actions.
