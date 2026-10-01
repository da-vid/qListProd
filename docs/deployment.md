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

Run `npm ci --ignore-scripts`, `npm run check`, and `npm run test:emulator` (Java 21+). Push only `codex/safe-development-baseline`; PR #1 remains a draft. Netlify builds `dist/` in preview context. Production context is rejected, and production hostnames are blocked at runtime. The hosted bundle contains browser-local storage only; no Firebase runtime, credentials, database URL, or analytics is included.

Review `/Demo23`, `/AbC234`, `/new`, title/item editing, check/delete, ordering controls, completed-item confirmation, links, persistence, keyboard focus, and mobile layout. Check errors and request destinations. Emulator tests validate two independent SDK clients; hosted previews do not establish cross-device collaboration. The Netlify review drawer is intentionally blocked by the strict frame CSP; use a branch-deploy permalink for a clean preview.

See [compatibility.md](compatibility.md) for exact data shape, old-client risks, offline limitations, and approval needed for a dedicated shared test database.

## Before production

1. Verify the actual Firebase project's owner, rules, usage/billing, and backups. The historical endpoint is `qwiklist.firebaseio.com`; an email referring to QuicklistProd has not established the account mapping.
2. Test restoring a backup into an isolated environment. Never publish private exports in Git or previews.
3. Approve and verify a separate synthetic-data cloud preview, if cross-device review is needed.
4. Resolve unsafe old-client whole-list writes before mixing modern random item keys with old numeric writers. Define a compatible bridge or cutover/version boundary and a recovery path for users with old tabs. Preserve existing list URLs.
5. Review production capability-link access, validation, error handling, privacy wording, abuse controls, and dependency/tooling advisories. Do not require sign-in or change rules without explicit approval.
6. Implement and review an explicit production adapter/configuration. This branch has no production mode. Do not repurpose URL parameters or remove guards ad hoc.
7. Finish visual, keyboard and real mobile/touch checks, authorize the release, and record the deploy ID before changing production.

## Rollback

No production data was changed. Discarding this preview requires no database rollback. For a future authorized release, retain and republish the known-good Netlify deploy `615b632e71eb6f0007b6422b` if needed, and revert the source before resuming automatic publishing. Verify that immutable deploy is still available before release. Frontend rollback does not undo schema/rule/data changes, which require their own tested recovery plan.

## Remaining verification limits

Production account/rules/backups, old-client cutover, real cross-device cloud sharing, and actual mobile touch behavior are not established by the tests. Browser-control tooling was unavailable in the phase-two resumed execution environment; built-DOM tests pass, but a fresh visual review is still required before release.
