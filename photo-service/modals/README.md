# qList modal and current-link review

Base: deployed/source-controlled commit
`9da71ed343c3e0c359b11674e06c40dc33c445ad`. This batch is local review only.
Do not deploy or push a deployment-triggering ref without the parent's go-ahead.

All app-controlled dialogs use `src/modal.ts`: a visually small top-right × with
an accessible name and 44 × 44 px target, Escape handling and focus restoration.
A pointer gesture must start and end outside to dismiss; inside clicks, cancelled
pointer gestures and dragging from content do not dismiss. Long privacy content
keeps the × visible while scrolling. Dismissal never invokes confirmation actions.

## Inventory

| Modal/state                                       | Dismissal and actions                                                                                                                                                                                                                                                  |
| ------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Share your list                                   | ×, outside, Escape. Shared current-link component and Copy link; no create action.                                                                                                                                                                                     |
| Create a new list                                 | Same URL/copy layout as sharing; separate explicit Create list confirmation.                                                                                                                                                                                           |
| Leave draft item                                  | Same URL/copy layout; dismissal preserves New item; only explicit Discard draft and create clears it.                                                                                                                                                                  |
| Changes have not saved                            | Same URL/copy layout; dismissal keeps pending/failed changes and the draft; creation remains blocked.                                                                                                                                                                  |
| Clear checked items                               | ×, outside, Escape leave all rows intact; only the clear action deletes checked rows.                                                                                                                                                                                  |
| About & Privacy                                   | Sticky top-right ×, outside and Escape; unchanged notice text and focus return.                                                                                                                                                                                        |
| Photo add/manage/error/preparing/selected preview | Same × and outside dismissal, Escape and return focus. Preparation/read work is aborted on dismissal; an unsaved photo preview is discarded as with the previous Close action. Text drafts remain intact.                                                              |
| Photo save/remove in progress                     | Dismissal closes the view but keeps the bounded dispatched operation alive for its row. Visible pending/confirmed/uncertain feedback avoids claiming cancellation. Late results cannot close a reopened dialog. Removing the text row still aborts its local lifetime. |
| Fullscreen lightbox                               | Same top-right ×; background dismisses. Image tap or keyboard activation, Back and Escape return to photo controls without losing the selected preview. Cache and history behavior remain.                                                                             |

No app-authored native `confirm`, `prompt` or `alert` calls were found in `src`.
Browser beforeunload warnings protect unsaved work and remain browser-controlled.
OS file/camera choosers and clipboard permission prompts are also platform UI;
these cannot be replaced by an app dialog in this change.

## Current-link alignment

Share, Create new list and its draft/unsaved variants use the same `currentLink`
component, label, read-only selectable URL field, Copy link button, spacing and
live feedback. The value is the actual current origin plus pathname, preserving
custom list links; it never substitutes `/new`. Long fields remain horizontally
selectable within the dialog without page overflow.

Copy success stays in the open dialog. Rejection or a missing Clipboard API shows
manual-copy guidance and selects the URL. A late clipboard failure after dismissal
does not steal focus. Enter in the read-only field never confirms creation. Copy
and confirmation are distinct type=button controls; the create action stays in
its own confirmation row. Sharing has no create action.

## Verification

- 173 Node regressions: list/photo/beta/storage/service suites, gesture boundaries,
  clipboard success/error/missing API, draft preservation, late clipboard focus,
  overlapping photo requests and closing/reopening during save/removal.
- Root and photo-beta TypeScript checks, preview/photo builds, targeted Prettier
  and `git diff --check` pass. There is no separate lint script.
- Two production rules/UI tests pass against the local demo Firebase emulator.
- New modal Chrome suite passes at 320, 390 and 1024 px with mouse and emulated
  touch: repeated ×/outside/Escape dismissal, inside clicks, current long URLs,
  copy feedback and Enter safety, draft/clear safety, long privacy scrolling,
  photo cache and add/manage/error/preview states, lightbox tap/keyboard/Escape,
  and outside dismissal during a dispatched save followed by reopening.
- Existing real local JPEG/HTTP photo-layout and draft/cleanup Chrome suites pass
  at all three widths. Wrapping, thumbnail controls, caret/reorder, cache,
  lightbox and safe-area footer geometry remain covered.
- Synthetic large-image normalization, eight EXIF orientations, HEIC rejection
  and JPEG reselection, and continued text editing after failure pass in Chrome.
  All browser harnesses block external traffic; none use production list data.

Run the new browser suite with Vite in normal preview mode on 127.0.0.1:4174:

```sh
node photo-service/modal-browser.mjs /absolute/path/to/playwright/index.mjs /absolute/evidence/directory
```

Screenshots and JSON/log evidence are in the review package. Review-only release
variants are built from the clean committed source and checked separately.

## Limits

No deployment, remote source push, backend/storage-cap change, database mutation,
credential/billing change or real photo upload. Browser/device-native dialogs are
outside app styling. Physical iPhone/Safari, real touch keyboards/camera/HEIC,
home-indicator safe areas and assistive-technology acceptance remain untested.
Vite's development server emits ResizeObserver loop warnings during the existing
layout exercise; layout assertions pass. No warning-free real-device claim is made.
