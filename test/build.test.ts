import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { spawnSync } from "node:child_process";
test("production build guard fails before changing the preview artifact", async () => {
  const before = await readFile("dist/index.html", "utf8");
  const result = spawnSync(process.execPath, ["scripts/build.mjs"], {
    env: { ...process.env, CONTEXT: "production" },
    encoding: "utf8",
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Production deployment is disabled/);
  assert.equal(await readFile("dist/index.html", "utf8"), before);
});
test("published output contains only the modern frontend and strict preview headers", async () => {
  assert.deepEqual((await readdir("dist")).sort(), [
    "_headers",
    "_redirects",
    "apple-touch-icon-precomposed.png",
    "apple-touch-icon.png",
    "assets",
    "favicon.ico",
    "icons",
    "index.html",
    "manifest.webmanifest",
    "robots.txt",
  ]);
  const headers = await readFile("dist/_headers", "utf8");
  assert.match(headers, /connect-src 'self'/);
  assert.doesNotMatch(headers, /unsafe-inline|unsafe-eval|firebaseio/);
  assert.match(headers, /noindex, nofollow/);
  assert.equal(
    await readFile("dist/_redirects", "utf8"),
    "/* /index.html 200\n",
  );
});
