# qList local reliability review — 4 October 2026

This batch addresses QL-02 and the isolated, reproduced QL-04 hypothesis from
`qList_UI_Audit_2026-10-03.docx` (Library
`libfile_9836886f5574819196a5935129176bc2`, version 0). The audit was materialized
on the Mac, its DOCX ZIP was readable, and both embedded screenshots were inspected.
Verified bytes: 221869; SHA-256:
`17f1bbd84df77a3ad0b30e39dba33720ac83a58f16fd67e3d6e6da5c550d9ab8`.

The starting checkout was clean at `a295a3f02b1939901e0000fa380cf8f8a19db799`.
Its frontend matched `3f283040d72ff7aecbfa0245d8a86bc3a3a44700`; the intervening
capacity preparation is unchanged. The supplied live backend context is
qlist-photos v3 with a shared 1,000,000,000-byte cap. This task neither reapplies
that migration nor independently queries live capacity.

## Behavior

- Non-whitespace New item content says “Draft item · press Enter or Add”. Existing
  pending, failed, offline and maintenance feedback stays visible alongside it.
- New list offers Stay or explicit draft discard. Pending/failed saved-list changes
  require staying and completing/retrying those changes first. Confirmation checks
  the current draft and save state again before navigating.
- Browser unload protection includes the new-item draft. Cancel/Escape does not
  publish or discard it. Drafts remain in memory; there is no claim of recovery
  after a killed browser/mobile process. An explicit discard is final.
- Add hands the exact trimmed text to the existing pending/failed retry path before
  clearing the field. Repeated submission of the cleared field does nothing;
  composition suppresses premature submission.
- A failed observed-photo cleanup has a visible Retry photo cleanup button above
  the list. Requests are deduplicated while in flight, and retry status is shown.
  Routine successful cleanup stays quiet; a successful explicit retry announces
  completion. Text editing remains available.
- Reinstall/reload reads the existing device-local cleanup journal and presents a
  retry action. It does not automatically delete anything. Each attempt keeps the
  original key/version; a newer-photo conflict stays queued, never rebases and
  never deletes the newer photo. No new cleanup/retention or deletion policy exists.

## Reproduction and checks

Before changes, three focused regressions failed: draft feedback was “Saved on
this device”, the new-list dialog ignored a failed save, and the cleanup retry
button was absent. The production-mode emulator also verifies that “All changes
saved” is replaced while a new-item draft exists.

- 165 Node tests pass across the list UI, photo gateway, beta/storage trials and
  service suites, including late-cache/draft-version regressions.
- Two production rules/UI integration tests pass against the local demo Firebase
  emulator. No production database is used.
- Root and photo-beta TypeScript checks, local preview/photo builds, targeted
  Prettier checks and `git diff --check` pass. There is no separate lint script.
- Chrome 154.0.8037.97 at 320, 390 and 1024 px: draft feedback, Escape/Stay,
  cancelled native beforeunload navigation, repeated Enter, explicit discard,
  cleanup failure/retry after UI reinstall, and text edits during photo failure.
- The existing synthetic HTTP/codec browser suite also passes at those widths:
  photo add/replace/remove, wrapping/caret, keyboard/pointer reorder, thumbnails,
  lightbox, cache and footer geometry. Both browser suites record zero external
  requests. All images/list content are synthetic.

Run the new browser suite with the local preview on 127.0.0.1:4174:

```sh
node photo-service/reliability-browser.mjs /absolute/path/to/playwright/index.mjs /absolute/evidence/directory
```

The script blocks every non-preview request. Separate evidence and a source patch
are included in the review ZIP; release artifacts are review-only and are built
from the committed source afterward.

## Boundaries and decisions

No deployment, remote push, credentials, billing, production data/settings changes,
trial reset or access expansion. Existing wrapping, compact rows/photo controls,
lightbox/cache logic and safe-area CSS remain intact.

Physical iPhone/Safari, real IME keyboards, camera/HEIC selection, touch gestures,
actual home-indicator safe areas and OS-kill recovery were not tested. Desktop
viewport emulation is not real-device acceptance. The existing HEIC fallback and
normalization contract are unchanged.

Review/release approval and physical-device acceptance are the next decisions.
Undo/retention semantics, other audit polish and optional product features remain
separate work requiring agreement; this batch does not implement them.
