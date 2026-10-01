# Isolated Spark staging handoff

The separate `qlist-staging` Spark project was provisioned by the browser worker, with the exact rules and control node confirmed. The application now has an explicit staging build. Only the separately approved, synthetic-only Spark project may receive these files. Never apply them to the production project or `qwiklist.firebaseio.com`.

## Console setup (browser worker)

1. Verify the signed-in Google account and new project's owner; record the exact project ID. Use the existing user-approved account. Create one separate project, disable optional Google Analytics, keep Spark, and do not link a Cloud Billing account.
2. Create **Realtime Database**, not Firestore or Cloud Storage, in `us-central1` (Iowa). Choose **Locked mode**, not the blanket test-mode rules. Record the exact database URL shown by the console; do not infer it from the display name. Region reference: https://firebase.google.com/docs/database/locations
3. In that new project's database Rules view, use the exact contents of `staging/database.rules.json`. These deny root/collection reads and whole-list writes; allow only known-path shared-list access, immutable claims, and validated per-item/attribute changes during an owner-controlled test window.
4. Add only the `stagingControl` node below through the owner console. No user list data needs importing. `expiresAt` is a UTC timestamp in milliseconds; the example expires at **2026-10-08 23:59:59 UTC**. Expiration disables client reads/writes but does not delete data. Set `enabled` false to stop testing early. Browser clients cannot read or modify this control node.

```json
{ "stagingControl": { "enabled": true, "expiresAt": 1791503999000 } }
```

No account signup is introduced. Anyone who knows or guesses a list URL can read/edit that list, as explicitly accepted for the digital Post-it use case. Clients cannot enumerate list IDs through a root read. The rules bound individual values, not total list count or request rate; Spark quotas and the test cutoff remain the service-wide limits.

## Exact data contract

```json
{
  "stagingControl": { "enabled": true, "expiresAt": 1791503999000 },
  "listClaims": { "AbC234": true },
  "lists": {
    "AbC234": {
      "0123456789abcdef0123456789abcdef": {
        "ID": "0123456789abcdef0123456789abcdef",
        "name": "Synthetic apples",
        "checked": false,
        ".priority": 1024
      }
    }
  },
  "listAttrs": {
    "AbC234": { "listName": "Synthetic shared list", "lastMod": 1790884800 }
  }
}
```

`.priority` is Firebase priority metadata in exported/imported JSON. New item keys are UUID-derived 32-character hex strings; numeric legacy keys/IDs remain valid. Names are 1–1000 characters, titles at most 160, priorities numeric/null within the documented bounds, and `lastMod` epoch seconds with a five-minute clock-skew allowance. IDs must match their item key and cannot change. Unknown item fields are rejected.

Generated list IDs have **six cryptographically random characters**. `listClaims/<id>` is reserved with an atomic create-if-absent transaction, retrying another random ID on collision. A post-claim check also avoids pre-registry lists/attributes. Custom IDs reuse an existing claim without clearing content; concurrent custom opens intentionally share that list. Readable single-segment custom names, Unicode, spaces and longer legacy IDs are allowed up to Firebase's 768 UTF-8-byte key limit. Forbidden Firebase key characters/control characters are rejected; `/new` is reserved for creation. Query/fragment text is not the list ID. New IDs are short by explicit user preference, not a secrecy guarantee.

## Client configuration to return

For this unauthenticated Realtime Database-only integration, the initializer needs the verified `projectId` and exact `databaseURL`. No admin credentials, database secret, OAuth token, service-account key, or Firebase Authentication setup is needed. If a web app already exists, its public configuration can be returned, but registering a new web app or adding Analytics is unnecessary for this adapter.

```ts
const stagingConfig = {
  projectId: "<exact new project ID from Console>",
  databaseURL: "<exact HTTPS database URL from Console>",
};
```

Return these alongside the Console project/database links, selected region, Spark/no-billing confirmation, rule publication status, and control-node expiry. Do not send any credentials.

## Preview wiring (follow-up code change after verified configuration)

The implemented `npm run build:staging` emits `dist-staging/` with the pinned project ID `qlist-staging` and URL `https://qlist-staging-default-rtdb.firebaseio.com`. Netlify runs local checks first, then this staging build and its guard tests. Environment/URL overrides remain forbidden. Production build and host guards remain in place.

1. Add a separate, explicit `staging` build mode containing an exact project/URL allowlist from the verified console result. Reject production Netlify context, production hosts and any config mismatch before initializing the SDK. Do not accept project/endpoint/mode from URL parameters, localStorage, a user form, or a fallback.
2. Initialize only this approved project, use the existing `FirebaseStore` plus `reserveFirebaseList`, and keep the existing original-style UI. Change the notice to clearly say it is shared synthetic staging data. Local preview and emulator modes remain separate.
3. Use the SDK's `forceWebSockets()` in staging so connection transport does not require remote JSONP scripts or iframes. Keep `script-src 'self'`, `frame-src 'none'`, no-referrer and noindex.
4. Add the exact database WebSocket host to staging-only `connect-src`. **Firebase may redirect to a shard host** (verified in the pinned SDK's `RepoInfo.internalHost` implementation), so capture the actual staging redirect host during the browser check and add that exact Firebase-owned host if needed. Never relax to `connect-src *`, add production endpoints, or assume that the configured database hostname is the only network destination. If stable hosting needs a broader Firebase WebSocket subdomain allowlist, document that transport tradeoff before changing it; config pinning still remains mandatory.
5. Publish only the existing draft branch/PR preview. Verify two separate devices/browser profiles on different networks can edit the same synthetic short/custom URL, survive reload and reconnect, and see denied-write/expired-window errors. Verify production artifact hashes and no production network requests.

## Local rules verification

```sh
# Node/npm pins from the repository; Java 21+ required
npm run test:staging-rules
```

This runs only the `demo-qlist` emulator at `127.0.0.1:9000`; the test's owner bypass is hard-coded to loopback. It verifies successful granular collaboration and rejects root reads, claim/control mutation, whole-list writes, invalid fields/IDs/types/priority, oversized values, expired and disabled access. Do not copy the emulator owner bypass into application or cloud commands.

No broader approval is needed for the agreed separate Spark/synthetic/no-billing setup. Paid services, production rules/data, broader IAM access, new admin credentials, or legal acceptance outside existing authorization require separate handling. The console worker must honor any mandatory action-time approval prompts.

## Verified staging transport and smoke test

On 2026-10-01, two independent SDK clients connected directly to `wss://qlist-staging-default-rtdb.firebaseio.com` without a shard redirect. The staging CSP allows only that observed WebSocket host; no Firebase wildcard is enabled. The synthetic list `CMCUPZ` passed concurrent add, text/check, reorder and second-client read assertions. The browser worker should independently verify this deployed list from separate browser profiles/networks. If a future Firebase shard redirect is blocked, inspect and approve that specific staging transport hostname; do not silently widen CSP.

To intentionally rerun cloud smoke testing against only this project:

```sh
QLIST_STAGING_SMOKE=1 npm run test:staging-cloud
```

This creates one new synthetic list and retains it for review. It is excluded from CI; CI uses emulators and static staging-build assertions, avoiding cloud writes on every push. No credentials are used. `test:staging-rules` still targets only the loopback demo emulator.
