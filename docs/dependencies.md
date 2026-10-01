# Dependencies (verified 2026-10-01)

- Node 24.21.0 LTS / npm 11.16.0 remain pinned.
- Vite 8.3.2, TypeScript 7.0.2: exact current stable versions verified against npm metadata; Vite supports this Node line. Official guidance: https://vite.dev/guide/ and https://vite.dev/releases
- Firebase 12.19.0: modular app/database SDK only in local emulator mode. Official guidance: https://firebase.google.com/docs/database/web/read-and-write and https://firebase.google.com/docs/emulator-suite/connect_rtdb
- Firebase CLI 15.32.1 / database emulator 4.11.2: development-only integration testing with a `demo-` project. Java 21 is used.
- jsdom 30.1.1 and Prettier 3.9.9: test/format tools only.

All direct versions and the lockfile are pinned. Install scripts are disabled. `@grpc/grpc-js` is overridden to compatible patched 1.14.5 because the Firebase umbrella package includes an older Firestore-only dependency; this app does not import Firestore. `npm audit --omit=dev` reports **zero** vulnerabilities as of this review.

Full development-tool audit still reports **9** findings (5 high, 4 moderate), transitively through Firebase CLI: basic-ftp/get-uri/proxy-agent, OpenTelemetry, and uuid/gaxios. The current upstream CLI has no compatible automatic fix; npm suggests a major downgrade, which is not applied blindly. These packages are not in the browser build. The CLI is used only with a loopback demo database, no authenticated cloud access. Track upstream fixes before extending the CLI's use. This is a documented tooling risk, not a claim that all dependencies are vulnerability-free.

The old AngularJS 1.2.10, jQuery 1.10.2, jQuery UI 1.10.3, Firebase 1.0.2, AngularFire 0.7.0, AngularStrap, FastClick, and Font Awesome bundles are removed from the active code/build. Git commit `f3ef9ac` retains the original inventory and source for comparison.
