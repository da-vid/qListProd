import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { JSDOM } from "jsdom";
import {
  assertProductionHost,
  PRODUCTION_CONFIG,
} from "../src/production-config.ts";
async function scripts(variant: string) {
  const dir = `release-artifacts/${variant}/assets`;
  return (
    await Promise.all(
      (await readdir(dir))
        .filter((x) => x.endsWith(".js"))
        .map((x) => readFile(`${dir}/${x}`, "utf8")),
    )
  ).join("\n");
}
test("production database and runtime hosts are pinned; previews cannot open it", () => {
  assert.equal(
    PRODUCTION_CONFIG.databaseURL,
    "https://qwiklist.firebaseio.com",
  );
  for (const host of ["qlist.cc", "www.qlist.cc", "qlist.netlify.app"])
    assert.doesNotThrow(() => assertProductionHost(host));
  for (const host of [
    "localhost",
    "127.0.0.1",
    "deploy-preview-1--qlist.netlify.app",
    "evil.example",
  ])
    assert.throws(() => assertProductionHost(host));
});
test("release manifests verify all bytes and keep variants separate", async () => {
  for (const variant of ["modern", "maintenance", "rollback"]) {
    const root = `release-artifacts/${variant}`;
    const manifest = JSON.parse(await readFile(`${root}/release.json`, "utf8"));
    assert.equal(manifest.variant, variant);
    assert.equal(manifest.namespace, variant === "maintenance" ? null : "v2");
    for (const [file, hash] of Object.entries(manifest.files))
      assert.equal(
        createHash("sha256")
          .update(await readFile(`${root}/${file}`))
          .digest("hex"),
        hash,
      );
    const headers = await readFile(`${root}/_headers`, "utf8");
    assert.doesNotMatch(headers, /unsafe-inline|unsafe-eval/);
    assert.match(headers, /no-store/);
    const js = await scripts(variant);
    if (variant === "maintenance")
      assert.doesNotMatch(js, /firebaseio\.com|firebase\/|FirebaseStore/);
    else {
      assert.match(js, /qwiklist\.firebaseio\.com/);
      assert.doesNotMatch(js, /qlist-staging-default-rtdb/);
    }
  }
});
test("maintenance artifact preserves the URL and explains old offline edits", async () => {
  const dom = new JSDOM('<div id="app"></div>', {
    url: "https://www.qlist.cc/Synthetic",
    runScripts: "outside-only",
  });
  try {
    dom.window.eval(await scripts("maintenance"));
    assert.match(
      dom.window.document.body.textContent ?? "",
      /old offline edits will not transfer automatically/,
    );
    assert.equal(dom.window.document.querySelectorAll("input,form").length, 0);
    assert.equal(dom.window.location.pathname, "/Synthetic");
  } finally {
    dom.window.close();
  }
});
test("release preparation rejects hosting-context or configuration overrides", () => {
  for (const override of [
    { CONTEXT: "production" },
    { VITE_FIREBASE_CONFIG: "other" },
    { QLIST_MODE: "release" },
  ]) {
    const result = spawnSync(
      process.execPath,
      ["scripts/build-release.mjs", "modern"],
      { env: { ...process.env, ...override }, encoding: "utf8" },
    );
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /overrides/);
  }
});
