# Smaller JPEG codec: packaging experiment

The parent verified the isolated Supabase Free project has no application tables, buckets, policies or Edge Functions. That inventory is sufficient for this packaging investigation; no additional database read is needed yet. No hosted resources were created here.

## Result

Pinned `@jsquash/jpeg` **1.6.0** (Apache-2.0; no runtime dependencies; npm lifecycle scripts disabled) provides MozJPEG decoder/encoder WASM of **166,470** and **251,524** bytes. Its published API supports explicit WASM module initialization. The build embeds the exact integrity-checked WASM bytes in JavaScript text and bundles the package glue. It needs no static binary file, runtime download, CDN or unpinned dependency.

The generated codec bundle is **1,169,750 bytes**. It successfully decoded and reencoded a synthetic JPEG with `fetch` disabled. It is comfortably below Supabase's documented 5 MB server-bundling limit, although actual connector deployment and Deno compatibility are still unverified. The binary files declare a maximum memory of 2 GiB each; this is a ceiling, not an allocation. The prototype bounds input dimensions and admits one operation per worker, but it does not claim that native heaps have ImageMagick's configurable 96 MiB limit. Supabase's runtime memory enforcement and repeated-request behavior must be measured before choosing this codec for real uploads.

The codec preserves server-side baseline-JPEG, byte, dimension and pixel limits. APP/comment metadata is removed before decode, warnings or decoder errors reject the input, decoded dimensions are checked, pixels are freshly reencoded, and thumbnail/full-output sizes are capped. A fresh decoder/encoder heap is used per operation to isolate native failures; compiled modules are reused. A corrupt entropy test rejected the image and the next valid image succeeded. The high-noise fixture exceeded the output cap and was rejected.

Local mixed-fixture benchmark: **181.05 MiB peak process RSS**, **174.76 ms warm p95 CPU** across 36 operations; compilation was **2.81 ms CPU** and the first gradient operation **78.98 ms CPU**. This run used the currently available **Node 24.18.0** on ARM64 macOS: the earlier temporary Node 24.21.0 toolchain is no longer present. These measurements are not directly identical to the earlier ImageMagick benchmark setup and are not hosted results. Smaller bundle size does not imply lower peak memory.

## Reproduce and deployable payload

Run `node --test photo-lab/small-codec.test.ts photo-lab/benchmark-handler.test.ts`, `node photo-lab/small-benchmark.mjs`, and `node photo-lab/build-small-bundle.mjs` from the worktree. Six focused tests passed. The builder checks pinned WASM SHA-256 values, tests the bundled codec without networking, then writes:

- `photo-lab/generated-small/bundle/codec.js`
- `photo-lab/generated-small/deploy-payload.json`
- `photo-lab/results/small-codec-packaging.json`

The deployment payload matches the parent's exact `deploy_edge_function` contract: project `qmpdinzendwpkqhtqskz`, function `qlist-photo-benchmark`, entry `index.ts`, text-only files, **`verify_jwt: true`**. Regenerate immediately before deployment because the benchmark handler expires 24 hours after building. The payload includes package and codec licenses.

The handler also requires the exact existing runtime `SUPABASE_SERVICE_ROLE_KEY` in the Authorization bearer header; it does not accept an anonymous project key. It creates/configures no credential. Missing runtime credentials fail closed. Only named, bundled synthetic fixtures are accepted, with a 128-byte request-body limit, no user-image upload, no database/storage writes, one active request and twelve accepted requests **per worker**. The worker counter is not a global/project quota; this is an admin-only benchmark, not the planned public photo gateway. Reported timings are explicitly wall time; memory snapshots are not peak measurements. Obtain CPU/peak enforcement evidence separately from hosted logs/metrics where available.

Example request body: `{"fixture":"gradient"}` (then `portrait` and `noise`). The noisy fixture should return rejection. No endpoint has been deployed or invoked here.

## Remaining invocation gate

The parent connector can deploy and read logs but has no invoke action. CLI login is **not necessary for this text-only deployment path**. Prefer the existing Supabase Dashboard tester if the user can run a request using the existing project service-role authorization within their own session. Confirm the tester supports that authorization; its default anonymous key is deliberately rejected. No credentials need be copied into chat or saved on this Mac for a dashboard-run test.

Do not retrieve, transmit or save the service-role key through chat/tool outputs. A simple chat approval is not a route for handling raw highly sensitive credentials. If the Dashboard tester requires a protected credential-selection or entry step, hand that exact step to the user in their existing authenticated session. Keep gateway JWT verification and the handler's admin check enabled. If an authorized session-based invocation route is unavailable, report that blocker rather than extracting credentials or weakening authentication.

Transactional quota enforcement, storage cleanup and hosted text/photo failure isolation remain a subsequent implementation/test step. The packaging proof does not establish those properties.

Primary references:

- [jSquash JPEG API and explicit initialization](https://github.com/jamsinclair/jSquash/blob/main/packages/jpeg/README.md)
- [Supabase WebAssembly support](https://supabase.com/docs/guides/functions/wasm)
- [Supabase function limits](https://supabase.com/docs/guides/functions/limits)
- [Supabase Dashboard testing](https://supabase.com/docs/guides/functions/quickstart-dashboard)
- [Supabase function authentication](https://supabase.com/docs/guides/functions/auth)


Full local regression rerun after the codec addition: 34 existing tests plus 23 photo/codec/handler tests passed (57 total); TypeScript, ordinary preview, photo preview, and normal release builds passed. No hosted invocation was performed.
