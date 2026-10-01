# qList modernization preview

A small TypeScript/Vite frontend for quick, no-signup lists, retaining the original yellow/charcoal qList appearance and bundled Lato typefaces. This branch is **review-only**. Netlify production remains on `001fd8f`; no production Firebase data, rules, credentials, or billing were changed.

## Try it

Use Node **24.21.0** and npm **11.16.0**:

```sh
npm ci --ignore-scripts
npm run check
npm run dev
```

Open http://127.0.0.1:4173/Demo23 for synthetic sample items. `/new` creates a cryptographically random 144-bit list URL. Existing case-sensitive paths such as `/AbC234`, trailing slashes, and the `lastList` cookie remain supported.

The public Netlify build stores an immutable operation log in browser storage (`qlist:modern:v1:`). Tabs on the same origin/browser see changes; **different devices do not share data**. It does not load Firebase or analytics. Sample lists from the first development baseline are not migrated; production data is untouched.

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

Open http://127.0.0.1:4173/AbC234 in two tabs. Emulator mode is restricted to loopback; hosted builds always compile browser-local mode, regardless of user URL parameters. In emulator mode, writes await server acknowledgement. Offline pending edits live only in the current session: keep the tab open until it says saved. An unload warning protects pending/failed edits, but browsers cannot guarantee recovery after a crash.

## Implementation

- `src/main.ts`: semantic DOM interface, editable title/items, check/delete, keyboard/touch ordering buttons, confirmation dialogs, copyable links, saving/offline/error/retry feedback.
- `src/model.ts`: data contract, secure link generation, legacy routes, deterministic ordering.
- `src/local-store.ts`: preview operation log; independent tabs do not overwrite entire lists.
- `src/firebase-store.ts`: modular Firebase SDK, per-item transactions, no whole-list writes, stale-edit deletion protection, granular title and monotonic `lastMod` updates.
- `test/`: built-interface tests, local-store/routing tests, real two-client Firebase emulator integration tests and test-only rules.
- `scripts/build.mjs`: Vite output plus same-origin CSP/noindex headers and production build guard.

Only `dist/` is published. The legacy AngularJS, AngularFire, jQuery, Bootstrap/AngularStrap, FastClick, and icon/font bundles are no longer shipped. Historical versions remain available in Git.

## Validation and release boundary

`npm run check` typechecks, builds, and runs thirteen model/storage/DOM/build checks. `npm run test:emulator` runs seven independent integration checks: concurrent inserts; edit/check; reorder/edit; stale edits after deletion; numeric legacy IDs/priorities; offline reconnect; and denied/malformed operations plus idempotent retry. CI runs both commands.

This phase has no approved cloud Firebase test project. The hosted preview cannot demonstrate real cross-device sharing. Production rollout requires the account/rules/backup and old-client compatibility work in [deployment.md](docs/deployment.md). Do not merge this draft or remove the production guard yet.
