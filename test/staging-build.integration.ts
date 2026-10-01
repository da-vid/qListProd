import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { spawnSync } from "node:child_process";
test("staging bundle uses only pinned test configuration and explicit shared notice", async () => {
  const files = await readdir("dist-staging/assets");
  const js = (
    await Promise.all(
      files
        .filter((f) => f.endsWith(".js"))
        .map((f) => readFile("dist-staging/assets/" + f, "utf8")),
    )
  ).join("\n");
  assert.match(js, /qlist-staging-default-rtdb\.firebaseio\.com/);
  assert.match(js, /Shared test lists only/);
  assert.doesNotMatch(
    js,
    /qwiklist\.firebaseio\.com|UA-48582921-2|google-analytics\.com/,
  );
});
test("staging headers allow only the observed staging WebSocket host", async () => {
  const headers = await readFile("dist-staging/_headers", "utf8");
  assert.match(
    headers,
    /connect-src 'self' wss:\/\/qlist-staging-default-rtdb\.firebaseio\.com;/,
  );
  assert.match(headers, /script-src 'self';/);
  assert.match(headers, /frame-src 'none'/);
  assert.doesNotMatch(headers, /unsafe-inline|unsafe-eval|wss:\/\/\*/);
});
test("staging production/override attempts fail before changing output", async () => {
  const before = await readFile("dist-staging/index.html", "utf8");
  for (const env of [
    { CONTEXT: "production" },
    { VITE_FIREBASE_CONFIG: "unapproved" },
    { QLIST_MODE: "production" },
  ]) {
    const r = spawnSync(process.execPath, ["scripts/build.mjs", "--staging"], {
      env: { ...process.env, ...env },
      encoding: "utf8",
    });
    assert.notEqual(r.status, 0);
    assert.equal(await readFile("dist-staging/index.html", "utf8"), before);
  }
});
