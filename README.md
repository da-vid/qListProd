# qList development baseline

This branch makes the existing qList UI reproducible and safely reviewable. It is **preview-only**: all list data is synthetic and stored in the visitor's browser. It does not connect to production Firebase or send analytics. Production remains at commit `001fd8f291e25da26f4fdd7e5e373055edece7ce` until a separately approved rollout.

## Local setup

Use Node **24.21.0** (`nvm use`, after installing that version) and npm **11.16.0**. Then:

```sh
npm ci --ignore-scripts
npm run check
npm run dev
```

Open http://127.0.0.1:4173/Demo23 for a sample shopping list. Any legacy-style URL such as `/AbC234` starts with an empty, isolated list. `/` remembers the last list in a host-local cookie; `/new` chooses another six-character URL. The dev server binds only to loopback. Set `PORT` to choose another port. Restart `npm run dev` after source edits.

If an existing npm cache has permissions problems, use a separate cache rather than changing ownership of unrelated files:

```sh
npm ci --ignore-scripts --cache /tmp/qlist-npm-cache
```

## What a preview can and cannot do

- Add, name, check, delete, reorder, reopen, and switch lists using the legacy UI.
- Store synthetic data under `qlist:synthetic:v1:<list-id>` in localStorage. Tabs on the **same origin/browser profile** receive storage updates.
- Open the synthetic sample at `/Demo23`. The fixture is not copied from anyone's real list. Clear this preview origin's browser storage to reset it.
- Share a URL between tabs on the same browser. Sharing across devices/browsers **does not synchronize data** in this baseline. Different Netlify preview origins also have separate data.
- No credentials, Firebase projects, production rules, billing settings, or private list exports are needed.
- This adapter is a UI test double, **not a Firebase emulator**. It does not prove Firebase authorization, server concurrency, network/offline retry, or actual multi-user behavior. Existing numeric item IDs and whole-list saves remain unchanged for a later focused fix.

Use only synthetic test content. Browser storage is not a backup and can be cleared or denied by the browser. Storage failures are shown in the preview notice.

## Layout and build

- `src/app.js`: extracted legacy controller, now dependent on `qlistData` rather than a hardcoded Firebase URL.
- `src/list-routing.js`: original URL and cookie behavior, retained as a compatibility baseline.
- `src/preview-data.js`: deliberately limited, browser-local synthetic adapter.
- `src/index.html`: existing UI, with a preview notice and local-only assets.
- `vendor/legacy.js`: frozen libraries and the existing sortable integration; hashes/versions in `vendor/manifest.json`.
- `scripts/build.mjs`: dependency-free deterministic allowlist build into `dist/`. Nothing else is published.
- `test/`: Node tests plus jsdom integration of the real legacy controller/templates and sortable callbacks. Browser QA complements these tests.
- `netlify.toml`: Node/npm pins, build command, publish directory, and an explicit production refusal.

There is no Vite/framework migration in this first batch. A copy-based build preserves script order and avoids introducing bundler differences before the legacy behavior is covered. New npm tooling is exactly pinned in `package.json` and `package-lock.json`; old browser libraries are hash-pinned, **not upgraded or declared secure**. See [dependency inventory](docs/dependencies.md).

## Deployment

Netlify branch/PR previews run `npm run check` and publish `dist/`. Both the production-context build command and the build script refuse `CONTEXT=production`. The adapter also rejects qList's production hostnames. **Do not merge or deploy this baseline to production.** The CSP permits only same-origin connections and scripts; no analytics SDK is loaded. These headers apply only to this branch's output.

See [deployment and rollback](docs/deployment.md) for the verified current deployment, review steps, and unresolved Firebase checks.
