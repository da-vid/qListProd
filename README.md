# qList modernization preview

A small TypeScript/Vite frontend for quick, no-signup lists, retaining the original yellow/charcoal qList appearance and bundled Lato typefaces. This branch is **review-only**. Netlify production remains on `001fd8f`; no production Firebase data, rules, credentials, or billing were changed.

## Try it

Use Node **24.21.0** and npm **11.16.0**:

```sh
npm ci --ignore-scripts
npm run check
npm run dev
```

Open http://127.0.0.1:4173/Demo23 for synthetic sample items. `/new` creates a cryptographically random six-character list URL with atomic reservation/retry. Custom URL names (including short names, spaces, Unicode and longer legacy IDs), case sensitivity, trailing slashes and the `lastList` cookie remain supported. Unknown names open empty lists; `/new` is reserved. Generated local-preview IDs use Web Locks for atomic cross-tab reservation; browsers without Web Locks can still open custom URLs.

The public Netlify review build now uses **only the separate approved `qlist-staging` Spark database**, with synthetic shared lists and no signup. Local `npm run dev` still uses browser-local storage (`qlist:modern:v1:`) and does not share across devices. Neither mode connects to production or loads analytics. Sample lists from the first development baseline are not migrated; production data is untouched.

## Firebase integration, locally

Install Java 21 or later, then run:

```sh
npm run test:emulator
```

This starts and stops only the Realtime Database emulator on `127.0.0.1:9000`, using project `demo-qlist` and synthetic fixtures. No Firebase login or cloud project is required. Never replace the demo project ID with a real project in this workflow. The test rules deliberately permit access to known list IDs and deny database-wide reads; they are **not approved production rules**.

To inspect the emulator UI behavior manually, use two terminals:

```sh
# Terminal 1
npx firebase emulators:start --only database --project demo-qlist
# Terminal 2
npm run dev:emulator
```

Open http://127.0.0.1:4173/AbC234 in two tabs. Emulator mode is restricted to loopback; Netlify builds the explicitly pinned staging mode; URL parameters cannot select a project or mode. In emulator mode, writes await server acknowledgement. Offline pending edits live only in the current session: keep the tab open until it says saved. An unload warning protects pending/failed edits, but browsers cannot guarantee recovery after a crash.

## Implementation

- `src/main.ts`: semantic DOM interface, editable title/items, checked-only delete, mouse/touch drag handles with arrow-key/Home/End alternatives, confirmation dialogs, copyable links, saving/offline/error/retry feedback.
- `src/model.ts`: data contract, secure link generation, legacy routes, deterministic ordering.
- `src/local-store.ts`: preview operation log; independent tabs do not overwrite entire lists.
- `src/firebase-store.ts`: modular Firebase SDK, per-item transactions, no whole-list writes, stale-edit deletion protection, granular title and monotonic `lastMod` updates.
- `test/`: built-interface tests, local-store/routing tests, real two-client Firebase emulator integration tests and test-only rules.
- `scripts/build.mjs`: Vite output plus same-origin CSP/noindex headers and production build guard.

Netlify publishes only `dist-staging/`; `dist/` remains the browser-local test build. The legacy AngularJS, AngularFire, jQuery, Bootstrap/AngularStrap, FastClick, and icon bundles are no longer shipped (the original static Lato fonts are retained). Historical versions remain available in Git.

## Validation and release boundary

`npm run check` typechecks, builds, and runs model/storage/DOM/build checks. `npm run test:emulator` runs independent integration checks: concurrent inserts; edit/check; reorder/edit; stale edits after deletion; numeric legacy IDs/priorities; offline reconnect; and denied/malformed operations plus idempotent retry. CI also runs `npm run test:staging-rules` against the separately proposed staging policy. See [staging handoff](staging/README.md) for exact schema, rules and setup instructions.

The approved staging project is now configured for shared synthetic lists through October 8, 2026 at 23:59:59 UTC. A two-client SDK smoke test passed; independent browser/network review is still required. Production rollout requires the account/rules/backup and old-client compatibility work in [deployment.md](docs/deployment.md). Do not merge this draft or remove the production guard yet.

### Dragging and checked-only removal

Drag the right-hand handle to reorder with a mouse or touch. The rest of the row remains available for scrolling, checking and text editing. Focus the handle and use Up/Down, Home or End for keyboard ordering; moves are announced and focus is retained. SortableJS 1.15.7 supplies touch fallback and edge auto-scrolling. Only the moved item's priority is written, resolving the drop anchor against the latest received list. Conflicting/deleted targets produce a retryable message rather than a whole-list rewrite.

The individual × button appears only on checked items. Firebase deletion transacts the item and checks its current `checked` value on every retry, including reconnect after another client unchecks it. Already-absent items remain an idempotent success. Browser-local writes use Web Locks where available and conditional operation replay. Existing Firebase rules are unchanged: this is a UI/application safeguard, not a security boundary against raw database clients or the old production app.

Actual mobile touch gestures still require independent browser QA on the deployed preview; automated DOM checks do not prove touch behavior. Test handle dragging in both directions and at viewport edges, ordinary swipe scrolling outside handles, editing, keyboard reordering, second-tab synchronization and reload persistence. The explicit staging smoke test creates a fresh scrollable synthetic list and prints its six-character ID.
