# Dependency baseline

Source: `da-vid/qListProd` commit `001fd8f291e25da26f4fdd7e5e373055edece7ce` (2021-10-04). The original repository contained a prebuilt bundle, no dependency manifest, and no build/test scripts. No separate source checkout was found during the audit.

The library prefix of `js/prod.js` was extracted into `vendor/legacy.js`. Only trailing separator whitespace was normalized in the vendor prefix. Application code after `//quicklist.js` and routing after `//idHelper (prod)` were separated. The vendor prefix still includes the customized Angular sortable adapter and retains license banners. Its checksum and the original bundle checksum are recorded in `vendor/manifest.json`; the build refuses an unexpected vendor checksum change.

| Component | Bundled version |
| --- | --- |
| jQuery | 1.10.2 |
| jQuery UI | 1.10.3 |
| jQuery UI Touch Punch | 0.2.2 |
| AngularJS / ngAnimate | 1.2.10 |
| AngularUI | 0.4.0 |
| Firebase client | 1.0.2 |
| AngularFire | 0.7.0 |
| AngularStrap | 2.0.0-rc.4 |
| FastClick | 1.0.0 |
| Placeholders.js | 3.0.2 |
| Font Awesome (CSS) | 4.4.0 |
| Custom angular-linkify | no reliable version banner |

These are retained only to establish a behavioral baseline. AngularJS is end-of-life. jQuery 1.10.2 is in the affected range of CVE-2020-11022; exploitability in qList has not been established. New npm dependency audit results do **not** cover these vendored browser libraries. The Firebase SDK is present in the frozen bundle but is never instantiated by the preview application. A later migration can remove unused libraries after compatibility tests exist.

- AngularJS support: https://docs.angularjs.org/misc/version-support-status
- jQuery advisory: https://github.com/jquery/jquery/security/advisories/GHSA-gxr4-xjj5-5px2
- Node support: https://nodejs.org/en/about/previous-releases
- Netlify runtime configuration: https://docs.netlify.com/build/configure-builds/manage-dependencies/
- Firebase modular migration: https://firebase.google.com/docs/web/modular-upgrade

## New tooling

Node 24.21.0 (LTS) and npm 11.16.0 are pinned. jsdom 30.1.1 is an exactly pinned **test-only** dependency; its transitive versions and integrity hashes are locked. Install scripts are disabled by `.npmrc`. The build itself uses only Node standard-library modules. GitHub Actions are pinned to immutable commits of checkout v6 and setup-node v6.

The first batch intentionally does not update the production analytics integration. The previous inline Universal Analytics snippet is retained as `docs/upstream-analytics.html` for reference, excluded from published output. Its presence alone does not establish the state of any other analytics integration or account.
