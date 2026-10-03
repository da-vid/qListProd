# Held frontend refinement review

This batch changes frontend interaction only, based on clean commit `f5098bb6faad4c84f4c45ec437beecf01ce30247`. Publication is held for parent/user review. The published frontend remains `e41f68d464f1f55642563d5c12798389b6b2e231`, deploy `6ac1220e13abc27982b0a504`. No backend, authentication, quota, retention, trial, credential or hosted data changes were made.

## Behavior

- Native auto-growing textareas wrap long names and unbroken text. The existing 300ms autosave, blur/Enter save, Escape reset to current saved value, composition handling and focused selection are preserved. Short rows stay compact. Width/font changes resize editors; removed rows are unobserved.
- One 44px photo control shows either the camera or a 34px thumbnail. It opens management with change/delete controls. Existing photos have no visible photo heading. Buttons use shorter labels and existing licensed icons, with full accessible names and at least 44px targets.
- Tapping the displayed image enters a viewport lightbox; tapping again or Back/Escape returns to the same management draft. Browser Back returns from the lightbox. A visible Close button closes it. This uses no browser fullscreen permission.
- Row memory retains the loaded Blob and revision. Reopening within 60 seconds uses those bytes without another request. Older entries revalidate on opening; Refresh checks changes explicitly. Reload reconstructs state from the gateway. This is bounded staleness, not live synchronization. Replace/remove update the cache, uncertain writes expire it, and existing version checks prevent stale writes overwriting someone else's photo. Dialog and row object URLs are released independently.
- The footer uses `max(20px, calc(env(safe-area-inset-bottom, 0px) + 12px))`, side insets, and `viewport-fit=cover`. It remains in normal flow. Lightbox controls also respect safe-area insets.

## Exercised locally

- 153 Node tests passed, including cache reuse/expiry, remote replacement, stale write rejection, selected-draft preservation and URL cleanup. Full existing text/photo/backend synthetic regressions remain included.
- Root and beta TypeScript checks; standard and photo-preview builds passed. The packaged release is rebuilt from the clean source commit, and its modern/maintenance/rollback manifests are checked separately.
- Two existing Firebase demo-emulator tests passed: production privacy rules and release UI maintenance/recovery. No production database traffic or writes.
- Chrome 154.0.8037.97, loopback only, at widths 320/390/1024: JPEG attach/change/remove, paused-upload removal, confirmed text-delete cleanup, keyboard and pointer reordering, compact row geometry, actual wrapping textarea with unbroken text, caret/save/cancel, aligned thumbnail/handle, management, tap lightbox toggle, browser Back, Escape, Close, zero additional cached-open downloads, and short/long/380px-height footer layouts. Evidence: `results/browser.json` and PNGs. The keyboard case is a resized viewport, not an actual mobile keyboard.
- Normalization browser checks passed again: eight EXIF orientations, progressive-to-baseline JPEG, metadata removal, 12MP and 24MP synthetic images, high-detail size fallback, cancellation, codec/input failures, HEIC rejection/reselection and continued text editing. Outputs stay within 512 KiB and 1280px. Evidence: `../photo-lab/results/browser/results.json` and PNGs.

## Remaining review

Physical iPhone capture, Safari, real keyboard/home-indicator insets, and real HEIC decoding were not exercised. HEIC remains explicitly unsupported with JPEG guidance; no actual iPhone support claim is made. Chrome's zero-inset fallback was measured; safe-area CSS was reviewed, not verified on hardware. Review the screenshots and the physical-device behavior before approving publication. No backend change is needed for this batch. Apply the separate patch only to a matching base, or review/cherry-pick it without overwriting later work.
