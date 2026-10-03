# Publication receipt

The parent confirmed backend acceptance and opened the publication gate. The exact staged frontend was published through the Mac's existing authenticated Netlify CLI session; no new credentials, login, access grant, or backend redeployment was performed by this task.

- Live URL: https://www.qlist.cc
- Netlify site: `qlist`, `bdd4cbf4-e000-4def-83d4-519db38d609f`
- Published deploy: `6ac1220e13abc27982b0a504`
- Deploy details: https://app.netlify.com/projects/qlist/deploys/6ac1220e13abc27982b0a504
- Frontend source: `e41f68d464f1f55642563d5c12798389b6b2e231`
- Live `release.json` SHA-256: `04b78d0a36739e250b30c2a1699929aa73e0506fc4a243523f9bce0a36cb5a2b`
- Retained rollback deploy: `6abf472505e5bd2a66b61559`, text-only source `c7b163aacbf71422ac5774703072c6141b8101d4`.

Fresh preflight matched the retained baseline. The publish command exited successfully. Subsequent read-only CLI lookup confirmed the new deploy was ready and published. The live release manifest and all 14 publicly served files matched the approved artifact hashes. Netlify's effective CSP, the camera control code and pinned photo endpoint were verified. `_headers` and `_redirects` are consumed deployment configuration, not separately served assets. No list data was written. The parent owns live browser interaction acceptance and any authorized synthetic frontend lifecycle test; static verification is not a substitute for those checks.

## Canonical backend transport fix

After publication, the parent's independently reviewed transport-only patch was incorporated into canonical local source. Hosted Deno can expose an empty stream for a POST with no bytes. The handler now accepts EOF, rejects meaningful bytes, caps inspection at 16 reads and one second, and cancels stalled reads. The exact handler SHA-256 is `33a05ecc619007823626945ab4c2f93410443be9f9bfff02709e6c74283e898d`.

The parent reports `qlist-photos` v2 already deployed and accepted, with upload/maintenance/general-namespace gates enabled, completed lifecycle checks, zero final objects/charged bytes/unknown writers, four retained receipts and unchanged historical trial state. Those are parent-reported backend results; this task did not redeploy that function.

Local verification after incorporating the exact patch: 151 Node tests, root and beta TypeScript, pinned cached Deno check, and 11 temporary PostgreSQL checks passed. Frontend source and staged/published bytes were not rebuilt or changed. The backend source commit therefore intentionally differs from the published frontend source commit. Review manifests identify both.

Initial schema/bucket/activation files remain historical setup inputs. Do not rerun the disabled migration or reset live ledgers. Lost text-delete hints can still leave bounded, charged orphan photos; unknown writers are not refunded. Physical iPhone/Safari/HEIC behavior remains untested.
