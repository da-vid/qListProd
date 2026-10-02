# Current production database rules

`database.rules.json` is the post-migration privacy policy. Its only differences from `candidate/database.rules.json` are denied reads on legacy `lists/$list` and `listAttrs/$list`. Legacy writes remain denied; all v2 rules and validation are unchanged. Data is retained, not deleted.

The candidate rules and migration journal describe the historical cutover. Do not redeploy them: they would reopen legacy reads. The old migration runner deliberately rejects a changed rules hash, so it must not be reused against this policy without a separately reviewed recovery update. Retain its private snapshots and journal.

Validate with `npm run test:production-rules`. A rules publication must first confirm the current baseline, preserve a private rules snapshot, apply only the reviewed two-read change, and then verify anonymous legacy reads fail while current v2 lists remain readable. Publish the About & Privacy frontend only after that verification passes.
