# Checked items and inline cleanup review

Base: released `e3a24a938b74a7c84a42572903a68f6d173e837a`.
This is a local review candidate; no push or publication is included.

The requested checked palette is restored exactly from `bb88e6d`: editable
checked text `#b8ae7e`, checked border `#d1c898`, and checkmark `#c9c090`.
Other readability colors remain. The clear action restores the original
Font Awesome times-circle/check-square-o pair (`f057`, `f046`, found in
`da451ef:index.html`), using the existing bundled font. Its accessible name and
visible "Clear all checked" wording remain; decorative glyphs are aria-hidden.

The single count now says "x of y checked". It appears left of the clear action
or cleanup feedback, and returns to the footer when that row closes. About stays
right-aligned. The clear batch is guarded while pending; repeated confirmation
or hidden-action clicks cannot dispatch another batch.

Photo cleanup uses the same compact row instead of a separate banner. Pending
work shows "Cleaning photos…"; unsuccessful work stays visible with an accessible
"Retry photo cleanup" control (visually "Retry"). Journal persistence/restoration
failures retain the explicit keep-this-tab-open notice. Existing exact-version
queues, journal retries and gateway deduplication remain in charge of cleanup.
A local journal-removal retry does not resend a completed remote removal.

Success remains visible for 1.4 seconds, then the existing 180 ms slot transition
closes the row without flashing the clear button. The outgoing success text stays
painted within the inert/aria-hidden closing slot; new work replaces it. Reduced
motion disables the transition. New unfinished work cancels the success timer,
and a closed photo view cannot update a replacement view after late completion.
Focus returns to New item when a focused retry/action disappears; drafts survive.

## Verification

- 171 Node tests pass, including new success-timer/new-failure and closed-view
  cleanup races, plus existing version fencing, durable journal failures,
  deletion deduplication and draft tests.
- Root and photo-beta types, preview/photo builds, formatting and whitespace pass.
- Two production-rules/release-UI tests pass against the local demo Firebase
  emulator, with no production database access.
- New isolated Chrome suite passes at 320, 390 and 1024 px in normal and reduced
  motion: count alignment, exact checked colors, pending/success/failure/retry,
  repeated clicks, journal retention, preserved drafts, focus return, newly
  checked items during cleanup, safe footer padding and zero horizontal overflow.
  Frame samples check that the exit fades and never reveals the pink clear action.
- A 320 × 420 viewport exercises long journal-error feedback, visible retry and
  recovery without another gateway deletion.
- Existing modal, draft/retry and real-local-codec photo/layout browser suites
  pass at all three widths, including cached lightbox, multiline editing,
  reorder controls, keyboard-sized viewports and footer geometry.
- The contrast suite passes 177 contrast measurements plus 12 exact legacy-palette
  assertions. Checked text/mark/border are intentionally restored to the user's
  faint palette; they are no longer asserted to meet the previous contrast target.
- Three release variants and four artifact-integrity checks are recorded in the
  accompanying archive after the clean commit.

Start Vite in photo-preview mode on 127.0.0.1:4186, then run:

```sh
node photo-service/checked-cleanup-browser.mjs /absolute/path/to/playwright/index.mjs /absolute/evidence/directory
```

All browser evidence uses synthetic data, blocked external traffic and fresh
isolated profiles. Existing user Chrome, Scout and Rankings sessions are untouched.
The old browser harnesses were temporarily adapted to port 4186 (including the
photo fixture allowed origin). Their assertions were updated for labeled Retry,
count placement and the inactive cleanup state rather than erased exit text.
The environment's npm CLI remains incomplete; checks use the exact package-script
commands through the existing Node runtime and repository tools.

## Limits

Physical iPhone/Safari, real camera/HEIC, native keyboard/safe-area behavior and
screen-reader acceptance remain untested. Vite can emit its existing
ResizeObserver loop warnings during layout checks. No hosted writes, settings,
credentials, access policies, quotas, trial expiry or retention were changed.
Publishing this candidate requires the parent's go-ahead; Lineup remains on hold.
