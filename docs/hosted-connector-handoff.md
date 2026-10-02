# Hosted photo trial: connector handoff

Parent-provided target: project `qmpdinzendwpkqhtqskz`, name `qlist-photos`, region `us-west-2`, state `ACTIVE_HEALTHY`; organization `fcqzrsaycccyhdjnzzbx` (`qList`), plan `free` / `tier_free`. These were verified by the parent's connector, not by this delegated executor.

This executor's complete tool catalog contains no Supabase tools and no tool-search entry point. The complete paginated cloud-skill catalog also contains no Supabase skill. Do not retrieve credentials as a workaround or ask the user to reconnect an already working parent connector.

## Required parent operations now

1. Read the installed Supabase skill. Return any constraints applicable to deployment, SQL, authentication or action-time approvals, plus its source locator.
2. Using the existing authorized connector, re-read the exact project and organization above if the earlier results are no longer current. Return only status, project/organization identity, Free plan and region. Do not retrieve API keys, database passwords or secret values.
3. List deployed Edge Functions (name/slug, version, status and JWT-verification configuration). Do not create or overwrite any function yet. Return whether `qlist-photo-benchmark` or another qList photo function already exists.
4. Execute the first statement in `photo-lab/preflight.sql` as a read-only query against this exact project. It reads catalog metadata only. Execute the second statement separately if `storage.buckets` exists. Return the inventory. Existing objects must be reviewed because project creation predates this setup exchange; do not assume an empty project or overwrite it.
5. Return the exact callable schemas for function deployment, function invocation, logs/metrics, SQL execution, migration application and function retrieval. Include whether deployment accepts binary/static files or only text sources, whether invocation uses the existing authorized connector without generating new credentials, and whether a project-scoped authenticated request is supported.

The read-only inventory intentionally excludes table data, object contents, function bodies, policy expressions and secrets. No function invocation, image upload, mutation or hosted benchmark has been attempted from this executor.

## Deployment gate to resolve

The assessed package is pinned to `@imagemagick/magick-wasm` 0.0.44. Its x86 WASM file is 15,447,097 bytes. Current Supabase limits specify 20 MB when bundled locally versus 5 MB through server-side/API bundling; static files require CLI/Docker packaging. A connector backed by the Management API may therefore be unable to deploy the tested static-WASM package. Check the tool's actual bundling contract before promising deployment. Do not change to a remote runtime binary fetch or a different compressor without reviewing that implementation and its integrity/resource limits.

Sources checked for this handoff:

- https://supabase.com/docs/guides/functions/limits
- https://supabase.com/docs/guides/functions/examples/image-manipulation
- https://supabase.com/docs/guides/functions/wasm
- https://supabase.com/docs/guides/platform/cost-control

## Planned work after inventory and tool contracts arrive

Prepare a new isolated benchmark endpoint using only the repository's synthetic fixtures, bounded request sizes, single-flight processing and existing authorized invocation. Keep authentication enabled; a public, unbounded benchmark endpoint is not an acceptable substitute for missing invocation capability. No persistent credential should be created/configured without the required action-time approval.

Return processing outcomes, output sizes/dimensions, metadata-removal assertions and wall time. Obtain actual CPU/memory enforcement evidence from available hosted logs/metrics; do not label JavaScript wall-clock timings as CPU time or heap snapshots as peak process memory. Test cold and warm starts and bounded concurrent admission. Cap the trial's accepted requests; do not repeatedly invoke until provider quotas are exhausted.

Next implement/review transactional quota and version enforcement in an isolated schema with default-deny access, then verify reservation races, cleanup accounting and timeout/retry behavior. Start with the agreed 10 MiB application cap, two active reservations and 100 accepted uploads/day. Synthetic storage failures must remain independent from text saves. Keep Firebase, Netlify, live qList, paid features and existing project objects outside the change set.

The local benchmark and 51 passing local tests remain useful evidence, but they are not hosted test results. Hosted compression, quota enforcement and failure-isolation results are blocked on the parent connector operations above.
