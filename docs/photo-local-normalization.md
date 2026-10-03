# Local photo normalization and mock gateway acceptance

Follow-up: the user subsequently accepted same-link access. Current integration status and remaining decisions are in [the disabled beta review](../photo-lab/beta/README.md).

Completed October 3, 2026 in `qList-photo-prototype`, continuing the uncommitted work after `06e25d158043728dd39ed0b764e3dd08d00ffb1d`. This is a local-only acceptance batch. Production photos remain disabled; the hosted trial, expiry, counters, credentials, access policy and storage were untouched. No user photos or external uploads were used.

## Browser input and gateway contract

`normalizePhoto` accepts actual baseline/progressive JPEG bytes up to 10 MiB, 24,000,000 pixels and an 8192-pixel edge. It checks dimensions before decoding. The browser applies EXIF orientation while decoding the original, then canvas redraws pixels and emits one baseline, 8-bit JPEG with an edge at most 1280 and size at most 524,288 bytes. The encoded MIME, JPEG structure, dimensions and length are checked; all APP and COM segments are removed, including EXIF, GPS, XMP and ICC. The preview uses those normalized bytes. Color-managed/wide-gamut fidelity is not established.

Work is bounded to one active preparation, one source decode and at most 12 quality/size attempts. The size ladder never enlarges a source. Detailed 1280-pixel input exposed an early-exit bug in the partial implementation: the normalizer now proceeds to smaller dimensions even if the first attempt was already at original size. Preparation receives the UI timeout's abort signal, so cancellation stops subsequent work and stale results cannot save or replace a preview. Native decode/encode already running cannot be interrupted by JavaScript; buffers are released when it settles, and overlapping preparation is rejected meanwhile.

HEIC/HEIF is deliberately rejected with: “Export or share a JPEG copy, then choose it here.” Detection uses MIME, filename and container hints. The fixture is a 24-byte synthetic type header, **not a decodable HEIC photo**. No native HEIC support or file-picker conversion is claimed. PNG and other formats remain unsupported; actual JPEG bytes still work with empty or incorrect MIME labels.

`PhotoGateway` exposes `get`, `put`, `status`, `remove` and permanent `deleteItem` fencing. `put` receives an item key, expected version and exactly `{ operationId, jpeg }`; the client supplies no thumbnails, hashes or output proofs. `MockPhotoGateway` validates the envelope and normalized bytes, reserves capacity before processing, and creates full/thumbnail outputs through an injected local processor. A UUID and server-side input fingerprint bind replay to the same key/version/bytes. Historical replay does not restore an old current record. Status resolves a lost response; a committed status refreshes the current association. Failed operations need a newly selected photo; pending/unknown operations must keep their original ID on retries.

Mock limits are local test values: 2 MiB accounted output capacity, 416 KiB per in-flight reservation, two concurrent reservations, 100 operation records and 100 deleted-item fences. They are **not approved beta quotas**. Old objects remain charged on cleanup failure, stale replacements/removals fail, and deletion during processing cannot resurrect a photo. No transport, auth token, grant system, public-access policy or database migration was added. `PhotoDemo` allowlisting and injected 403 failures are local simulations, not authorization evidence. The in-memory status history retains historical result blobs until reload and is not a durable storage ledger.

The mock output processor uses browser canvas and is not byte-identical to the server codec. Separately, actual normalized browser bytes were run through the existing unchanged WASM server codec locally. A valid upload may still be rejected if the server's independently encoded full/thumbnail output exceeds 384 KiB/32 KiB.

## Exercised behavior

Chrome 154.0.8037.97, headless on this Mac, fresh 390 × 844 touch-emulated context at device scale 2. This is **not iPhone Safari or Android device testing**. All fixture pixels were generated deterministically; the browser harness blocks external requests and non-GET/HEAD methods before sending.

| Synthetic input | Original bytes | Normalized bytes | Normalized size | Local server-codec outcome |
| --- | ---: | ---: | --- | --- |
| Progressive JPEG | 1,949 | 1,026 | 320 × 240 | Accepted |
| 12 MP textured landscape | 3,037,451 | 165,005 | 1280 × 960 | Accepted |
| 24 MP textured portrait | 5,873,941 | 141,567 | 853 × 1280 | Accepted |
| Full-range detailed noise | 3,969,112 | 455,343 | 1024 × 1024 | Expected output-cap rejection |

The detailed case required six encodes (four qualities at 1280, then two at 1024). All eight EXIF orientation values passed both pixel-quadrant/mirroring and width/height assertions, followed by metadata stripping. Progressive input became baseline. Browser checks also covered malformed/empty/over-limit sources, empty/spoofed MIME, cancellation and retry, null/incorrect-MIME canvas output and recovery, selection after a HEIC error, normalized preview, save, thumbnail, reopening the saved portrait, text editing/checking/deletion after photo failure, and no horizontal overflow. Three screenshots were visually inspected. Recorded browser requests: zero external requests and zero uploads.

Node/DOM checks cover envelope rejection, nonbaseline/metadata rejection before processing, replay/fingerprint mismatch, wrong demo list, version conflicts, concurrent last-capacity admission, deletion races, stale refreshes, lost save response, timeout signal propagation, object URL cleanup, and real built text add/edit/check/delete under seven injected photo faults (offline, paused, quota, rate, 403, 503, timeout).

## Checks and artifacts

All checks ran with the existing Node 24.21.0 toolchain and installed dependencies; no package installation was needed.

- `npm run check`: TypeScript, normal preview build, 34 core tests passed.
- `npm run build:photos` and `npm run test:photos`: photo build and 52 tests passed.
- `node --test --test-timeout=15000 photo-lab/storage-trial/handler.test.ts photo-lab/storage-trial/phase-b/*.test.ts`: 31 local mock/static tests passed; no hosted invocation or database changes.
- `npm run build:release` and `npm run test:release-build`: modern/maintenance/rollback artifacts and 4 tests passed. Builds are validation artifacts from the working tree, not authorized deployment candidates.
- Normal preview and all three release bundles were scanned for photo UI/code/asset markers: none present.
- Browser and codec scripts below passed. Total Node tests: **121**, with zero failures/skips.

Evidence: [`photo-lab/results/browser/`](../photo-lab/results/browser/) contains `results.json`, `codec-contract.json`, `checks.json`, normalized JPEGs and three screenshots. Source fixture identities/hashes are in [`fixtures/browser/manifest.json`](../photo-lab/fixtures/browser/manifest.json). No artifacts need cross-environment transfer for this local checkout; no Library upload was performed.

Reproduce with the existing dependencies (do not install through the sibling `node_modules` symlink):

```sh
node photo-lab/generate-browser-fixtures.mjs
npm run dev:photos
# In another terminal, pass the absolute path of an already installed Playwright entry:
node photo-lab/browser-normalization.mjs /absolute/path/to/playwright/index.mjs
node photo-lab/browser-codec-check.mjs
```

The browser harness uses an installed Chrome channel with an isolated context; it does not attach to a personal browser profile. It expects the loopback preview on port 4174. No unsupported browser runtime was fabricated.

## Remaining decisions and untested behavior

Before any hosted beta, the user must choose the selected list/testers and access model (shared capability versus membership, visibility and revocation), retention/deletion/export policy, and finite duration/storage/photo/delivery quotas. Public access is not implemented. Existing hosted acceptance and its original expiry remain unchanged.

Physical iPhone/Android camera and library selection, actual HEIC files, Safari/Firefox, memory on constrained devices, wide-gamut/color fidelity, keyboard/screen-reader behavior across devices, durable status/outbox recovery, cross-device persistence and simultaneous clients, real grant/revocation/wrong-list authorization and direct-bucket denial remain untested or unimplemented. Native image work may finish after cancellation. The demo stays tab-only, and its in-memory cleanup queue does not survive reload. These gaps block a beta release, not this completed local batch.
