# qList functional readability review

Local review of audit QL-01, based on released commit
`bb88e6d10544ca505b90016df9b4f960558655f0`.
Only production CSS changes: darker secondary text and action colors, explicit
placeholder color, and 12 px status/footer/About/preview-note text. The yellow
palette, checked-row marker and existing interaction/layout behavior remain.

| Rendered sample                    |        Before |         After |
| ---------------------------------- | ------------: | ------------: |
| Saved status, footer, About, draft |        3.87:1 |        5.46:1 |
| Completed editable text            |        1.94:1 |        5.46:1 |
| Checked marker                     |        1.59:1 |        5.46:1 |
| Reorder / camera                   |        1.98:1 |        5.46:1 |
| Delete                             |        2.05:1 |        5.72:1 |
| Gray header button                 |        4.03:1 |        5.10:1 |
| Add / Add hover                    | 4.25 / 3.08:1 | 6.01 / 5.31:1 |
| Dialog confirmation                |        4.46:1 |        6.30:1 |
| Focused completed text             |        2.13:1 |        6.01:1 |

The regression first reproduced failures in 14 samples at each of three widths.
The completed suite measures 63 samples per width (189 total), including Clear
normal/hover (8.08 / 6.88:1), placeholder, checked border, saving, failed save and
error text. It requires 4.5:1 for sampled text and 3:1 for sampled control graphics,
rejects transparent fixtures, checks secondary type size and horizontal overflow.
This is a bounded functional contrast review, not a full accessibility assessment.

## Interaction-state follow-up

Independent review identified an inherited selector conflict missed by the first
suite: `.primary:hover` overrode the dialog background with pale green while
`dialog .primary` kept white text. The expanded browser suite reproduced 1.10:1
confirmation contrast on hover, hover with keyboard focus, and pressed hover at
all three widths. An explicit `dialog .primary:hover` rule now uses the dark
hover token; these states measure 5.57:1, while focus alone remains 6.30:1.

The suite now checks keyboard focus (asserting `:focus-visible`), hover with
focus, and hover alone for header buttons, Add, Clear, reorder/camera/delete,
About, dialog confirmation, Copy and Close. It also checks the pressed state of
buttons without dispatching their actions. This expands coverage by 40 samples
per width. It does not claim every possible component state or focus-ring
contrast is audited. Disabled/inactive controls are outside these checks.

## Fresh verification

- 173 Node tests pass across list, photo, beta, storage and service suites.
- Root and photo-beta TypeScript checks, normal/photo builds, targeted formatting
  and whitespace checks pass.
- Contrast, existing modal, and existing photo/layout Chrome suites pass at
  320, 390 and 1024 px. The latter exercise multiline rows, cached thumbnails,
  lightbox, footer geometry and modal dismissal/current-link behavior.
- All browser runs use fresh isolated headless Chrome profiles, synthetic data,
  and blocked external requests. Existing user Chrome sessions are untouched.
- Saving and storage failure/retry use synthetic local failures. Offline and
  maintenance colors are visual fixtures, not new network/control-flow tests.

Run the new regression with Vite photo-preview on 127.0.0.1:4186:

```sh
node photo-service/contrast-browser.mjs /absolute/path/to/playwright/index.mjs /absolute/evidence/directory
```

For this review the existing modal/photo-layout harnesses were temporary copies
pointed at port 4186; the photo fixture's allowed origin was changed to match.
The first photo-layout attempt failed because that fixture still allowed 4174;
the corrected local fixture passes. No application change was needed for this.

The temporary npm installation lacks its CLI module. Checks used the exact
package script commands via Node and the existing local tool executables; no
runtime/dependency installation was performed. Review release variants and their
four integrity checks are recorded in the accompanying review archive.

## Limits and next decisions

No new emulator/backend integration, hosted upload, physical iPhone/Safari,
real camera/HEIC, screen-reader, native keyboard, physical safe-area or native
200% zoom acceptance was exercised in this CSS batch. Vite's layout harness can
emit the existing ResizeObserver warnings; see the JSON evidence. Existing image
normalization and gateway code were unchanged.

No push, merge, deployment, production data/settings, trial expiry, quota,
retention or access-policy change. This candidate is ready for visual review;
publication needs a separate instruction. Accessible labels, touch-target
changes and remaining audit/product-policy decisions are deferred.
