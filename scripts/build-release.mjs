import { build } from "vite";
import { readFile, writeFile, readdir, mkdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
const variants = {
  modern: "/src/main.ts",
  maintenance: "/src/maintenance.ts",
  rollback: "/src/recovery.ts",
};
const variant = process.argv[2];
if (!Object.hasOwn(variants, variant) || process.argv.length !== 3)
  throw new Error(
    "Choose one explicit release artifact: modern, maintenance, rollback.",
  );
if (
  process.env.QLIST_MODE ||
  process.env.VITE_FIREBASE_CONFIG ||
  process.env.CONTEXT
)
  throw new Error(
    "Release preparation is local/CI only, without hosting context or runtime configuration overrides.",
  );
const commit = execFileSync("git", ["rev-parse", "HEAD"], {
  encoding: "utf8",
}).trim();
const dirty = Boolean(
  execFileSync("git", ["status", "--porcelain"], { encoding: "utf8" }).trim(),
);
const outDir = `release-artifacts/${variant}`;
await build({
  mode: "release",
  build: { outDir },
  plugins: [
    {
      name: "explicit-release-entry",
      transformIndexHtml: {
        order: "pre",
        handler: (html) => html.replace("/src/main.ts", variants[variant]),
      },
    },
  ],
});
await writeFile(`${outDir}/_redirects`, "/* /index.html 200\n");
// RTDB can redirect WebSockets to rotating shards under firebaseio.com. No HTTP,
// JSONP, frames, scripts or arbitrary WebSocket destinations are permitted.
const connect = variant === "maintenance" ? "" : " wss://*.firebaseio.com";
await writeFile(
  `${outDir}/_headers`,
  `/*
  Content-Security-Policy: default-src 'self'; script-src 'self'; connect-src 'self'${connect}; style-src 'self'; img-src 'self' data:; frame-src 'none'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'
  Referrer-Policy: no-referrer
  X-Content-Type-Options: nosniff
  X-Robots-Tag: noindex, nofollow
  Cache-Control: no-store
`,
);
// Public list contents must never be indexed, including anonymous capability URLs.
await writeFile(`${outDir}/robots.txt`, "User-agent: *\nDisallow: /\n");
async function files(directory, prefix = "") {
  const values = {};
  for (const entry of (await readdir(directory, { withFileTypes: true })).sort(
    (a, b) => a.name.localeCompare(b.name),
  )) {
    const path = prefix + entry.name;
    if (entry.isDirectory())
      Object.assign(
        values,
        await files(`${directory}/${entry.name}`, path + "/"),
      );
    else
      values[path] = createHash("sha256")
        .update(await readFile(`${directory}/${entry.name}`))
        .digest("hex");
  }
  return values;
}
await mkdir(outDir, { recursive: true });
await writeFile(
  `${outDir}/release.json`,
  JSON.stringify(
    {
      format: 1,
      variant,
      namespace: variant === "maintenance" ? null : "v2",
      commit,
      dirty,
      files: await files(outDir),
    },
    null,
    2,
  ) + "\n",
);
console.log(
  `Prepared ${variant} artifact at ${outDir}; no publish was performed. ${dirty ? "Working tree is dirty: deployment approval must use a clean committed rebuild." : "Clean committed build."}`,
);
