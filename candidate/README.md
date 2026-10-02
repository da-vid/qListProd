# Local migration candidate — not deployed

The supplied active production rules are captured in `current-active.rules.json` (comments omitted, active JSON unchanged). `database.rules.json` is a candidate replacement, not a patch to merge beneath the old grants. Root enumeration remains denied. Known legacy list paths remain readable; **all legacy writes are denied**, including whole-list saves, item removal, attribute changes, and queued writes when an old client reconnects. Firebase ancestor allows cannot be canceled by child denies.

Modern clients explicitly select the `v2` namespace using the optional `FirebaseStore` constructor argument and matching `reserveFirebaseList` argument. The default remains the existing root namespace. Explicit production/recovery configuration is prepared separately; default previews, staging rules and live data remain unchanged. See [the release runbook](../docs/release-runbook.md).

## Candidate data policy

- Copy `lists` and `listAttrs` with all priorities, keys, values and types intact. Add an immutable claim for every ID in their union, including title-only lists. Claims are collision reservations, not ownership or authentication.
- Reads require a known list path. No login or secret-link redesign is introduced. Anyone who knows a list address can still collaborate; the namespace does not authenticate clients or prevent intentional abuse by someone implementing the modern protocol.
- Existing item IDs are immutable in both type and value. They do not have to equal the Firebase key. New items require a 32-character hexadecimal key and an identical string ID. A deleted historical numeric-key item cannot be re-created through the public client; administrative recovery remains separate.
- Item writes require an existing claim and the private control `v2Control/writesEnabled === true`. An absent/false control fails closed. Only individual item writes are granted; whole-list replacement is denied.
- Items require `ID`, `name`, and boolean `checked`, and reject unknown fields and field-level priorities. Item priorities retain Firebase's supported null/number/string domain. Item names allow 1–1,000 characters with a non-space character; titles allow up to 160 characters. Revalidate each fresh export against the full policy before a real migration.
- Deleting an existing item requires its **server-current** checked state to be true. Repeating a completed deletion is an allowed no-op. The adapter also retries transactions against current state, preventing stale checked UI from deleting an item another client unchecked.
- Title and last-modified writes are granular. Existing timestamps cannot decrease; new timestamps cannot exceed server time by more than five minutes. An unchanged historical timestamp is accepted. `lastMod` is a separate write after the item operation. A timestamp-only failure now returns a distinct saved-change warning; the UI does not queue the already committed edit for retry. Recovery must inspect/preserve the actual database snapshot, not infer success solely from client promises.

## Reproduce using synthetic data only

Use the pinned Node toolchain, Java 21+, and installed dependencies:

```
npm run check
npm run test:emulator
npm run test:staging-rules
npm run test:candidate-rules
npm run build:staging && npm run test:staging-build
```

The candidate suite binds `127.0.0.1:19000`, uses `demo-qlist`, loads both policies, and uses only synthetic fixtures. Its owner bypass helper hardcodes loopback and the demo namespace; it accepts no remote endpoint. Do not run this port concurrently with another emulator. Private exports, actual record identifiers, and rehearsal logs must remain outside the repository and all publish directories.

Coverage includes active-rule behavior; fail-closed writes; legacy online/offline saves and deletes after freeze; concurrent edit/check and string-priority reorder on a mismatched legacy ID; new claims/items; title-only lists; schema/immutability/enumeration denials; checked-only deletion; stale offline checked-delete; and a post-write freeze/snapshot/restore that preserves an acknowledged modern edit. This simulates the original client's write shapes using the installed SDK; it is not a browser run of the historical bundle.

## Proposed cutover sequence requiring separate approval

1. Review the exact rules/build/migration diff and a user-visible refresh/maintenance message. Preserve pending text before old clients reconnect: rejected offline legacy edits are **not migrated automatically**. Preservation guarantees concern server data captured after the freeze, not unsent local edits.
2. Apply the reviewed replacement policy with modern writes disabled; verify legacy whole saves, item deletes and attribute writes are denied. Take a fresh priority-preserving data export and rules snapshot, with checksums, after the freeze. Keep a durable private backup.
3. Copy and compare the full legacy tree into `v2`; populate claims from both list and attribute IDs. Verify order, types, priorities and title-only paths through the versioned adapter. Keep public URLs unchanged.
4. Publish an explicitly reviewed production mode using that namespace and the verified production Firebase configuration/transport CSP. Only then enable modern writes. Retain legacy paths read-only; old tabs must refresh to edit. Measure the rehearsal/window rather than promising a duration.
5. If recovery is needed, disable modern writes, snapshot the latest `v2` tree, and use a known-good same-schema frontend or maintenance page. Preserve post-launch data. Never restore only the pre-cutover snapshot or re-enable the historical writer as a frontend rollback shortcut.

Release artifacts, a migration/verification runner and maintenance/recovery messaging are implemented; see [the current release procedure](../docs/release-runbook.md). Owner-authorized live access, real mobile/touch and hosted production smoke checks, and explicit release approval remain. No live action is authorized by these local tests.
