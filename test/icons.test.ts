import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { JSDOM } from "jsdom";
test("built favicon, touch and manifest references resolve from every list route to original logo bytes", async () => {
  const html = await readFile("dist/index.html", "utf8");
  for (const route of ["/", "/Groceries", "/Groceries/"]) {
    const dom = new JSDOM(html, { url: "https://preview.example" + route });
    try {
      const links = [
        ...dom.window.document.querySelectorAll<HTMLLinkElement>(
          'link[rel="icon"],link[rel="apple-touch-icon"],link[rel="manifest"]',
        ),
      ];
      assert.equal(links.length, 9);
      for (const link of links) {
        assert.ok(link.getAttribute("href")!.startsWith("/"));
        const u = new URL(link.href);
        assert.equal(u.origin, "https://preview.example");
        const bytes = await readFile("dist" + u.pathname);
        assert.ok(bytes.length > 100);
        if (link.type === "image/png" || link.rel === "apple-touch-icon") {
          assert.equal(bytes.subarray(1, 4).toString(), "PNG");
          assert.equal(
            link.getAttribute("sizes"),
            `${bytes.readUInt32BE(16)}x${bytes.readUInt32BE(20)}`,
          );
        }
      }
      assert.equal(
        dom.window.document.querySelector(
          'meta[name="apple-mobile-web-app-capable"]',
        ),
        null,
        "icon restoration does not change browser/standalone behavior",
      );
    } finally {
      dom.window.close();
    }
  }
  for (const name of await readdir("icons"))
    assert.deepEqual(
      await readFile("dist/icons/" + name),
      await readFile("icons/" + name),
    );
  for (const name of [
    "apple-touch-icon.png",
    "apple-touch-icon-precomposed.png",
  ])
    assert.deepEqual(
      await readFile("dist/" + name),
      await readFile("icons/ql-favicon-256.png"),
    );
  assert.deepEqual(
    await readFile("dist/favicon.ico"),
    await readFile("icons/ql.ico"),
  );
  const manifest = JSON.parse(
    await readFile("dist/manifest.webmanifest", "utf8"),
  );
  assert.equal(manifest.display, "browser");
  assert.equal(
    manifest.start_url,
    undefined,
    "do not redirect an installed list bookmark to the root",
  );
  assert.equal(
    manifest.id,
    undefined,
    "do not merge distinct saved list URLs into one forced identity",
  );
  for (const icon of manifest.icons) {
    assert.equal(icon.type, "image/png");
    assert.equal(icon.purpose, "any");
    const bytes = await readFile(
      "dist" + new URL(icon.src, "https://preview.example").pathname,
    );
    assert.equal(
      icon.sizes,
      `${bytes.readUInt32BE(16)}x${bytes.readUInt32BE(20)}`,
    );
  }
});
