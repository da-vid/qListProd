import { build as viteBuild } from "vite";
import { writeFile, readFile } from "node:fs/promises";
if (process.env.CONTEXT === "production")
  throw new Error("Production deployment is disabled for this review branch.");
if (process.env.QLIST_MODE || process.env.VITE_FIREBASE_CONFIG)
  throw new Error("Hosted builds must use browser-local preview data.");
await viteBuild({ mode: "preview" });
await writeFile("dist/_redirects", "/* /index.html 200\n");
await writeFile(
  "dist/_headers",
  `/*
  Content-Security-Policy: default-src 'self'; script-src 'self'; connect-src 'self'; style-src 'self'; img-src 'self' data:; frame-src 'none'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'
  Referrer-Policy: no-referrer
  X-Content-Type-Options: nosniff
  X-Robots-Tag: noindex, nofollow
  Cache-Control: no-store
`,
);
await writeFile("dist/robots.txt", "User-agent: *\nDisallow: /\n");
console.log("Built browser-local review preview. Production remains disabled.");
