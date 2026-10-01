import { build as viteBuild } from "vite";
import { writeFile } from "node:fs/promises";
import { STAGING_WEBSOCKET_HOSTS } from "../src/staging-config.ts";
if (process.env.CONTEXT === "production")
  throw new Error("Production deployment is disabled for this review branch.");
if (process.env.QLIST_MODE || process.env.VITE_FIREBASE_CONFIG)
  throw new Error(
    "Runtime mode and Firebase configuration overrides are forbidden.",
  );
const staging = process.argv.includes("--staging");
const output = staging ? "dist-staging" : "dist";
const connections = staging
  ? STAGING_WEBSOCKET_HOSTS.map((host) => ` wss://${host}`).join("")
  : "";
await viteBuild({
  mode: staging ? "staging" : "preview",
  build: { outDir: output },
});
await writeFile(`${output}/_redirects`, "/* /index.html 200\n");
await writeFile(
  `${output}/_headers`,
  `/*
  Content-Security-Policy: default-src 'self'; script-src 'self'; connect-src 'self'${connections}; style-src 'self'; img-src 'self' data:; frame-src 'none'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'
  Referrer-Policy: no-referrer
  X-Content-Type-Options: nosniff
  X-Robots-Tag: noindex, nofollow
  Cache-Control: no-store
`,
);
await writeFile(`${output}/robots.txt`, "User-agent: *\nDisallow: /\n");
console.log(
  `Built ${staging ? "shared synthetic staging" : "browser-local"} review preview in ${output}. Production remains disabled.`,
);
