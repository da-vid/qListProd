# Initial list loading and original icon restoration

Base: released `513082f380ba0da7cf2b8235537c58815904d223`.
This candidate is local review only. No push, deployment or hosted data changes.

## Initial loading

The baseline showed welcome content during a delayed existing-list read. The
Firebase store also published the initial title and item snapshots independently,
allowing a title-only result to look like an empty list.

Existing routes (including a remembered list opened through `/`) now start with
a quiet 18 px spinner confined to the list area. The shell stays mounted, the
welcome panel and list are hidden, and list edits remain disabled until the first
complete snapshot. Firebase publishes its first state only after both title and
items arrive, in either order. Later updates retain existing behavior.

The list fades in over 180 ms. Reduced motion uses a static indicator and no
reveal animation. Loading has a named status and busy state. An initial error or
15-second timeout removes the spinner and offers "Retry loading list"; retry
preserves typed draft text and disposes the old subscription/client resources.
Attempt and path checks ignore late callbacks from superseded loads. Read errors
after a successful load retain the existing list/error behavior.

Fresh root and `/new` routes retain the normal landing. Confirmed empty or missing
custom lists retain the existing empty editable-list behavior after loading.
Navigation remains full-document navigation; no new client-side router was added.
Native back/forward and rapid navigation between pending documents were tested.

## Icons

The original logo assets remained in `icons/`, but current production HTML had
no icon metadata and those files were absent from the build. Read-only requests
for `/favicon.ico`, `/apple-touch-icon.png`, `/icons/ql.ico` and the manifest
returned HTML fallback instead of icons.

`public/` now contains byte-identical copies of the original PNG/ICO assets,
including root favicon/touch/precomposed fallbacks. Root-relative, versioned links
work from root, custom list and trailing-slash URLs. PNG dimensions and the ICO's
16/32/48 directory sizes match the declared metadata. The largest original
256 px logo supplies the default touch icon and largest manifest icon; artwork
was not redrawn, resampled, masked or assigned invented dimensions.

The manifest describes the existing 48/128/256 PNGs with `purpose: any`. It keeps
browser display, omits a forced root `start_url`/shared `id`, and adds no service
worker, install prompt, offline behavior or standalone/status-bar change. This
restores icon metadata, not a new PWA installability promise. Existing global
`no-store` deployment headers remain; versioned icon references also avoid reusing
the previous missing-resource URL cache entry. Local preview HTTP MIME/cache
responses and deployment-header artifacts are tested separately.

Apple documents using the next larger supplied icon when an exact size is absent:
[Safari Web Content Guide](https://developer.apple.com/library/archive/documentation/AppleApplications/Reference/SafariWebContent/ConfiguringWebApplications/ConfiguringWebApplications.html).
Per-document launch defaults follow the
[Web Application Manifest specification](https://www.w3.org/TR/appmanifest/#start_url-member).

## Verification

- 174 local Node tests, including both initial Firebase snapshot orders, unsubscribed
  snapshot callbacks, genuine empty snapshots, icon dimensions/bytes/metadata and existing
  draft/modal/photo/cleanup regressions.
- 17 Firebase collaboration tests and two production-rules/release-UI tests pass
  against isolated local demo emulators.
- Root and photo-beta TypeScript checks, normal/photo builds, formatting and
  whitespace checks pass. Clean release variants and four integrity checks are
  recorded separately in the review archive.
- Six loading browser scenarios: 320/390/1024 px, normal/reduced motion, slow
  success, permission error/retry, stale callbacks and late reservations after retry,
  preserved drafts, timeout,
  empty/missing lists, remembered root, fresh root/new, native back/forward and
  rapid full-document navigation. Before/after screenshots are included.
- Built-icon browser checks cover 24 URLs, actual MIME responses, all root/list
  metadata paths, and a pixel-identical rendered comparison with the original
  256 px logo. No production scripts or backends run in that check.
- Existing contrast, checked-cleanup, modal, draft/retry and real-local-codec
  photo/layout suites run against normal local preview. The modal regression now
  opens a real long list route rather than mutating history over another list.

The environment's npm CLI is incomplete; exact package-script commands were run
through the existing Node runtime and repository tools. All browser checks use
fresh headless Chrome profiles and block external requests. User Chrome, Scout
and Rankings sessions are untouched.

## Review limits

Physical iPhone/Safari Add to Home Screen, OS favicon/bookmark UI, native keyboard,
physical safe-area and screen-reader behavior remain untested. Existing home-screen
shortcuts may retain cached artwork and may need re-adding after release; this
candidate cannot force an already-installed shortcut to refresh. No claim is made
that every platform offers installation or refreshes an existing shortcut.
Vite can emit the existing ResizeObserver warnings during layout checks.

Run `loading-browser.mjs` against normal Vite preview mode on 127.0.0.1:4187.
Run `icons-browser.mjs` against the built artifact served by Vite preview on
127.0.0.1:4190. Both take the Playwright module path and output directory arguments.
