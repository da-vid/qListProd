qList synthetic hosted photo benchmark handover
Verified October 2, 2026, 22:57 UTC

Scope and status
The isolated synthetic benchmark is deployed as qlist-photo-benchmark, version 4, in qlist-photos (qmpdinzendwpkqhtqskz), dedicated qList Free organization. JWT verification remains enabled. No production qList code, storage schema, bucket, or real photos were changed. No new credentials, paid service, or paid fallback was created.

Actual hosted results (one cold run per fixture)
Gradient: HTTP 200; 196.83 ms processing wall time; worker CPU 194 ms; 1280 x 960; full 19,896 bytes; thumbnail 1,316 bytes.
Portrait: HTTP 200; 168.57 ms processing wall time; worker CPU 217 ms; 720 x 1280; full 15,445 bytes; thumbnail 1,003 bytes.
Noise: HTTP 422, rejected; 392.52 ms processing wall time; worker CPU 440 ms. Same codec and fixture reproduced locally with error: This image is too complex for the free photo limit. The hosted catch returns only rejected, so the exact hosted exception was not disclosed.
All three workers ended with EarlyDrop, not CPUTime or Memory termination. The CPU observations are below the documented 2,000 ms limit for these three samples only.

Evidence limits
These are three cold single-request samples, not load or abuse testing and not warm p95. Deno RSS reports zero and is unavailable. Heap/external and shutdown memory are snapshots, not peak memory. Successful runs demonstrate these fixtures completed under actual hosting limits; they do not guarantee all images fit. Hosted storage upload, quota accounting, read delivery, cleanup, and text-list fault isolation remain untested. This endpoint accepts a fixture name, not arbitrary uploads.

Auth recovery
An exact comparison against SUPABASE_SERVICE_ROLE_KEY rejected requests even after the user's Authorization value had correct Bearer formatting and service_role/project claims. Non-secret logs included sb_api_key_compatibility=minted; token transformation was suspected but not proven. Do not treat raw decoded claims as verified identity.
Version 4 uses verifyAuth from npm:@supabase/server@1.9.0/core with auth secret:default. It validates only the existing default modern secret on apikey. JWT remains on as an additional platform compatibility gate. No key appears in this bundle. The user performed credential entry and authenticated Send Request actions manually.
Nine focused local cases passed with real pinned Supabase SDK and synthetic local credentials: default secret accepted; missing/publishable/wrong/other-named/Authorization-only keys rejected; GET rejected; unknown fixture rejected; oversized body rejected. Downloaded v4 handler exactly matched tested source.

Current code limits
The bounded codec accepts baseline JPEG only, input <=524,288 bytes, max edge 1280 pixels, <=1,638,400 pixels. It strips JPEG APP/comment metadata before decode and re-encodes. Full output cap 393,216 bytes (384 KiB); thumbnail cap 32,768 bytes (32 KiB), thumbnail max edge192. The synthetic request envelope is <=128 bytes. In-worker busy/12-request limit is not a durable global or user quota and resets across workers. Never use it as abuse protection.
Expires October 3, 2026 at18:59:01.129 UTC. Expiry is a test safeguard, not a production photo retention policy.

Files
source/ contains exact downloaded v4 code for index/handler and byte-matched original codec/fixtures. LICENSE is restored from original source bundle; LICENSE.codec.md matches deployment.
hosted-results.json contains secret-free measurements.
NEXT_STAGE.txt describes proposed implementation and acceptance tests, not deployed schema.
package-lock.json records local SDK test dependency versions; not a Supabase/Deno deployment lock.

Official references
https://supabase.com/docs/guides/functions/auth
https://supabase.com/docs/guides/functions/auth-headers
https://supabase.com/docs/guides/troubleshooting/edge-function-shutdown-reasons-explained
https://supabase.com/docs/guides/functions/limits

Production remains disabled. Continue in the existing qList photo-prototype checkout when the user's Mac is available. Reconcile code, tests, and current provider Free-plan restrictions before any rollout.
