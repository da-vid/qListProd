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

## Preview process

1. Run `npm ci --ignore-scripts` and `npm run check` on the pinned Node/npm versions.
2. Push the development branch / open a draft PR. Netlify should build in `branch-deploy` or `deploy-preview` context, never `production`.
3. Verify the build log reports Node 24.21.0 and npm 11.16.0, the expected branch commit, passing tests, and publishing `dist/`.
4. Open `/Demo23` on the preview URL. Verify the visible synthetic-data notice. Use only fake data.
5. Exercise title edits, add/check/delete, delete-checked confirmation, reorder, reload, shared URL, new-list flow, and legacy `/AbC234` and trailing-slash routes. Inspect desktop and phone widths. Check errors and request destinations; scripts/connections must be same-origin.
6. Confirm production is still published at the original deploy. Review the PR before any next stage.

The build checks for a production context **before** removing output. Netlify's production command also exits unsuccessfully. A failed production build should leave the currently published deploy in place. The synthetic adapter refuses `qlist.cc`, `www.qlist.cc`, and `qlist.netlify.app` at runtime. Do not bypass these guards to release this branch.

The public preview has no credentials or private data. CSP blocks external scripts and connections, a no-referrer policy avoids leaking list paths, and previews are marked noindex. The sample fixture is browser-local; URL sharing between devices is not real collaboration. A successful preview does not prove production Firebase behavior.

## Data contract preserved for follow-up

The old app addresses `lists/<list-id>` and `listAttrs/<list-id>`. Items have numeric `ID`, string `name`, boolean `checked`, and Firebase priority metadata; attributes include `listName` and epoch-seconds `lastMod`. The synthetic adapter serializes priorities as `.priority`, exposing `$priority` to Angular as before. Existing short list paths and the `lastList` cookie remain recognizable. No production data is migrated.

Known defects deliberately left for a separate behavior change:

- Local `max(ID)+1` can collide across simultaneous writers.
- Whole-list saves during checking/reordering can overwrite other clients' changes.
- Error/offline state, keyboard accessibility, and link rendering need follow-up.
- Short IDs use `Math.random()`; longer secure IDs need legacy-link compatibility planning.

## Before a future production rollout

- Confirm the Firebase project's identity, owner access, database rules, usage/billing, and backups. The database hostname is `qwiklist.firebaseio.com`; an email mentioning a project named QuicklistProd has not been conclusively linked to it.
- Review/export the rules and define permitted shared-list access and validation. Do not blindly enable mandatory sign-in or tighten rules in a way that locks out existing links.
- Verify a backup can be restored into an isolated environment. Do not put private exports in Git or public previews.
- Implement a separately reviewed production data adapter and explicit environment selection. No runtime query parameter or fallback should turn a preview into a production client.
- Test Firebase rules, concurrent updates, permissions failures, reconnect/offline behavior, and old/new client compatibility using an isolated Firebase environment or emulator.
- Only then replace the production guard in a separately approved release change. Keep URL/data shape backward compatible or document a reversible migration.

## Rollback

This branch has no production data changes, and discarding its preview requires no database rollback. Avoid deleting historical production deploys during development.

For a future authorized release: record its commit/deploy ID and the current published deploy first. If regression occurs, use Netlify's deploy history to publish the known-good immutable deploy above (after confirming it is still available), then revert the source change before resuming automatic production deployments. Republishing old static assets is preferable to depending on a fresh legacy build. A frontend rollback does not undo data/schema/rule changes; that is why this baseline makes none and why later data changes need their own recovery plan.

## Not yet verified

Firebase rules/backups/billing, existing-list writes, real cross-device concurrency, and true offline/retry behavior. jsdom tests simulate UI events and sortable callbacks but cannot replace real touch/keyboard/browser testing or prove server semantics.
