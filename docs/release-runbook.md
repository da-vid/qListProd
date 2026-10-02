# Prepared release and recovery procedure

**Preparation only. No production publication, rules change, migration or write enablement has occurred.** Keep PR #1 a draft until review and release approval. The owner confirmed the production project as `project-8156335338801733535` (QuicklistProd), database `qwiklist`, us-central1. Netlify remains the host. This procedure preserves the public list URLs and existing Firebase keys, item ID values/types, titles, checked states and priorities.

The supplied active rules are in `candidate/current-active.rules.json`; the replacement is `candidate/database.rules.json`. The replacement freezes every legacy write path and grants narrowly validated `v2` writes only while `v2Control/writesEnabled` is true. The control boolean alone is publicly readable so modern clients can pause editing. A known list URL remains anonymously collaborative. Neither claims nor the versioned namespace are authentication. Root enumeration stays denied.

## Artifacts and reproducibility

From a clean committed checkout with pinned dependencies and Node:

```
npm run check
npm run test:emulator
npm run test:staging-rules
npm run test:candidate-rules
npm run test:migration
npm run test:release-ui
npm run build:staging && npm run test:staging-build
npm run build:release && npm run test:release-build
npm run release:review
```

Java 21+ is required for emulator tests. `release-artifacts/review.json` records the commit, canonical candidate-rules checksum and each artifact's manifest checksum. Each manifest hashes every deployable asset. Dirty builds are marked and rejected by the live runner. The generated directories are excluded from Git:

- `release-artifacts/modern`: production frontend, pinned to the owner-confirmed database and `v2`. Only `qlist.cc`, `www.qlist.cc`, and `qlist.netlify.app` may initialize it. It observes the write-control boolean, disables editing while paused, and reserves unknown custom links when editing resumes.
- `release-artifacts/maintenance`: static maintenance/refresh instructions with no Firebase connection. It preserves the requested URL.
- `release-artifacts/rollback`: read-only frontend for the **current `v2` data**, including edits made after launch. It does not reserve claims, change data or offer editing. Open an existing list link to read and copy saved items.

Normal Netlify preview commands continue building only the isolated staging variant. The production context still rejects automatic builds. Release artifacts are prepared explicitly outside hosting context; nothing in these scripts publishes them. Publish only the approved variant directory through the existing site's authorized Netlify deployment workflow, never the repository root or a private backup directory.

Production and rollback force WebSockets. Their CSP allows only same-origin connections plus `wss://*.firebaseio.com`, because the Firebase SDK may redirect the canonical database host to rotating `s-` shard hosts. Script, frame, JSONP and arbitrary cross-origin HTTP access remain blocked. Staging retains its existing exact-host policy. All variants use no-store and noindex headers; shared list contents should not be indexed.

## Dry run and private files

Before live approval, use an absolute **private directory outside Git** (mode `0700`):

```
node scripts/migrate.mjs plan --export /PRIVATE/legacy-export.json --out-dir /PRIVATE/dry-run
```

This performs no network requests. It rejects duplicate JSON keys, unsafe numbers, server-value directives, unexpected root/schema shapes and unsupported fields. It creates a priority-preserving `v2-export.json` and an aggregate plan; original arrays, values and metadata are retained. It creates claims from the union of list and attribute IDs, including title-only lists. It never renumbers historical IDs or keys.

Snapshots are created exclusively, mode `0600`, and never overwritten. Journals retain canonical and file-byte checksums. Verification normalizes only Firebase array/numeric-key and null/absence representations, preserving user values, types and priorities. Directory permissions are not proof of encryption or an off-device backup; arrange an owner-approved durable backup before release.

## Required approval and execution access

Copy `candidate/approval.example.json` outside Git, mode `0600`, only after the owner approves the concrete release. Bind it to the clean review's commit/rules/artifact hashes, permitted actions, and an expiry no more than 24 hours ahead. The acceptance fields must reflect actual approval, including mobile testing or explicit acceptance of its remaining limits. A template is not approval.

Live execution additionally needs an owner-authorized **short-lived OAuth access token** in a separate `0600` file outside Git, with Firebase Database access and rules-management permission. The runner uses its contents only in an Authorization header, never in URLs, command-line arguments, output, Git or artifacts. Do not use an admin database secret or commit credentials. This environment currently has no authorized Firebase CLI account and no supported access to the owner's existing Chrome tab; those are execution-access barriers, not reasons to weaken the gates. See Firebase's [REST authentication](https://firebase.google.com/docs/database/rest/auth) requirements.

The live runner pins the production endpoint/project, checks clean Git state and approval hashes, refuses unexpected current rules/data, requires explicit `--live --execute`, and does not accept an arbitrary remote endpoint. `--emulator --execute` uses only `127.0.0.1:19000` and `demo-qlist`; it cannot be combined with live approval/token options. [Conditional REST writes](https://firebase.google.com/docs/reference/rest/database#section-conditional-requests) protect namespace/control updates from overwriting a changed value. No client write can override an ancestor rule grant; the freeze is a complete reviewed rules replacement, not an ineffective child deny.

## Approved maintenance sequence — do not run before approval

Reserve an exclusive owner-operated window. Complete mobile/touch checks, confirm Netlify release access and retained artifacts, and check fresh production data against the policy. Leave the production auto-build rejection in place and prevent concurrent manual publishes/rules edits. Budget an attended window; local timings do not predict hosting propagation or user refresh time.

Use the same private `--out-dir`, approved `--approval` file and `--token-file` for every live command. The shared arguments below are written out conceptually to avoid embedding credentials in a command:

```
node scripts/migrate.mjs ACTION --live --execute --out-dir /PRIVATE/cutover --approval /PRIVATE/approval.json --token-file /PRIVATE/access-token
```

1. Publish the approved **maintenance** artifact to the existing Netlify production site. Copy any pending text out of old tabs before refreshing. Offline legacy edits are not automatically transferred; already-open legacy tabs cannot be made reliable by publishing new assets.
2. Run `freeze`. The runner first fetches and hashes the published maintenance manifest/assets and checks CSP. It verifies the supplied active rules and absence of an existing target namespace, saves the pre-freeze data/rules, applies the reviewed candidate rules and sets modern writes false. It then captures and checksums a **fresh post-freeze snapshot**. This is the migration source, not an earlier downloaded export. Legacy data remains readable and all legacy writes stay denied.
3. Run `copy`, then `verify`. The runner requires frozen writes, the exact candidate rules and unchanged source/backup checksums. It conditionally creates `v2` only if absent and verifies the complete tree. A repeated matching copy is harmless; unexpected existing data causes a stop rather than overwrite. Copy does not enable editing.
4. Publish the approved **modern** artifact. While writes remain false, inspect several known list links read-only, console/network behavior and CSP. Confirm titles/order/checks and maintenance behavior. Artifact hashes are necessary but do not replace this hosted browser smoke check.
5. Run `enable`. It verifies the approved modern manifest/assets/CSP, rechecks candidate rules, frozen control and exact copied data, then conditionally enables modern writes. Verify one owner-authorized synthetic production list or another explicitly approved write smoke test; do not edit someone's real list without permission. No such production test has been executed by this preparation.
6. Old paths remain read-only. Old tabs must refresh. Keep the private journal, fresh backups, rules snapshot, release hashes and Netlify deploy IDs. Record completion and arrange ongoing backups separately; no billing or backup-service change is included here.

A crash or rejection must not trigger an automatic rollback to permissive legacy rules. `freeze` can resume its recorded in-progress freeze; `copy` can verify an interrupted matching copy. Unexpected state stops the runner. If enablement committed but the client lost the response, use `freeze-modern` and recovery; do not guess from the journal alone or overwrite a namespace.

## Recovery without losing post-launch changes

Run `freeze-modern` with the same approved target/rules. It denies modern writes and saves the **latest** `v2` tree in a new private recovery snapshot. Publish the approved **rollback** artifact and run `verify-recovery`; that checks both the preserved live data and the exact read-only artifact. Users can read current acknowledged data while the issue is investigated. No database rollback or old snapshot restore is needed for this frontend recovery.

A later `enable` from the recorded recovery state preserves the recovery snapshot and requires an approved modern artifact. A changed commit requires a fresh approval binding. Do not republish the historical writer with writable legacy rules or restore the pre-launch export over current data: either can lose newer edits.

An item write and its activity timestamp remain separate operations. If only the timestamp fails, the adapter emits a distinct **saved-change warning**, and the UI does not queue that operation for retry. The database snapshot remains authoritative, including writes whose responses were lost. Failed item operations retain normal retry/error handling.

## Evidence boundaries

CI runs synthetic checks only. Private full-data rehearsal results and all actual record IDs/content remain outside Git and external uploads. DOM-simulator tests exercise production-mode maintenance transitions, custom-link reservation, saved-change warnings and the same-schema read-only renderer using a build-time loopback substitution that is absent from published artifacts. Legacy tests simulate whole-list, item-delete and offline queued write shapes through the current SDK; they do not run the historical bundle in a real browser. This environment has no supported browser observation tool. Real mobile touch/swipe, sustained edge auto-scroll, hosted production CSP/transport behavior and the owner-operated live execution remain release checks or explicit acceptance decisions.
