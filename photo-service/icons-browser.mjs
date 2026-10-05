import assert from "node:assert/strict";
import { readFile, mkdir, writeFile, readdir } from "node:fs/promises";
import { pathToFileURL } from "node:url";
const { chromium } = await import(pathToFileURL(process.argv[2]));
const out = process.argv[3];
await mkdir(out, { recursive: true });
const base = "http://127.0.0.1:4190";
const browser = await chromium.launch({ channel: "chrome", headless: true });
const result = {
  scope:
    "Built local Vite preview; scripts/backends blocked; original PNG pixel comparison",
  urls: [],
  routes: [],
  externalRequests: 0,
};
try {
  const context = await browser.newContext({
    viewport: { width: 900, height: 660 },
  });
  await context.route("**/*", (route) => {
    if (new URL(route.request().url()).origin !== base) {
      result.externalRequests++;
      return route.abort();
    }
    if (route.request().resourceType() === "script") return route.abort();
    return route.continue();
  });
  const page = await context.newPage();
  const urls = new Set([
    "/favicon.ico",
    "/apple-touch-icon.png",
    "/apple-touch-icon-precomposed.png",
  ]);
  for (const name of await readdir(new URL("../icons/", import.meta.url)))
    urls.add("/icons/" + name);
  for (const route of ["/", "/Family%20notes", "/Family%20notes/"]) {
    await page.goto(base + route);
    const links = await page
      .locator(
        'link[rel="icon"],link[rel="apple-touch-icon"],link[rel="manifest"]',
      )
      .evaluateAll((els) =>
        els.map((el) => ({
          rel: el.rel,
          href: el.href,
          sizes: el.getAttribute("sizes"),
        })),
      );
    assert.equal(links.length, 9);
    for (const link of links) {
      const u = new URL(link.href);
      assert.equal(u.origin, base);
      urls.add(u.pathname + u.search);
    }
    result.routes.push({ route, links });
  }
  const manifestResponse = await context.request.get(
    base + "/manifest.webmanifest?v=original-1",
  );
  assert.equal(manifestResponse.status(), 200);
  assert.match(
    manifestResponse.headers()["content-type"],
    /application\/manifest\+json/,
  );
  const manifest = await manifestResponse.json();
  assert.equal(manifest.display, "browser");
  assert.equal(manifest.start_url, undefined);
  assert.equal(manifest.id, undefined);
  for (const icon of manifest.icons) urls.add(icon.src);
  for (const url of urls) {
    const response = await context.request.get(base + url);
    assert.equal(response.status(), 200);
    const bytes = await response.body(),
      mime = response.headers()["content-type"];
    if (url.includes(".png")) {
      assert.match(mime, /image\/png/);
      assert.equal(bytes.subarray(1, 4).toString(), "PNG");
    } else if (url.includes(".ico")) {
      assert.match(mime, /image\/(x-icon|vnd.microsoft.icon)/);
      assert.equal(bytes.readUInt16LE(2), 1);
    } else {
      assert.match(mime, /application\/manifest\+json/);
      JSON.parse(bytes.toString());
    }
    result.urls.push({
      url,
      status: response.status(),
      mime,
      cacheControl: response.headers()["cache-control"],
      bytes: bytes.length,
    });
  }
  const original = await readFile(
    new URL("../icons/ql-favicon-256.png", import.meta.url),
  );
  const pixels = await page.evaluate(
    async ({ base, original }) => {
      const load = async (src) => {
        const img = new Image();
        img.src = src;
        await img.decode();
        return img;
      };
      const [built, old] = await Promise.all([
        load(base + "/apple-touch-icon.png"),
        load(original),
      ]);
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = 256;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(built, 0, 0);
      const a = ctx.getImageData(0, 0, 256, 256).data;
      ctx.clearRect(0, 0, 256, 256);
      ctx.drawImage(old, 0, 0);
      const b = ctx.getImageData(0, 0, 256, 256).data;
      document.body.innerHTML =
        '<h1>Original qList icons</h1><p>Unchanged source artwork, served from the built app</p><div id="icons" style="display:flex;align-items:center;gap:24px;flex-wrap:wrap"></div>';
      for (const name of [
        "ql-favicon.png",
        "ql-favicon-retina.png",
        "ql-favicon-48.png",
        "ql-favicon-128.png",
        "ql-favicon-256.png",
        "ql-icon-retina-iphone.png",
        "ql-icon-retina-ipad.png",
      ]) {
        const img = await load(base + "/icons/" + name);
        const f = document.createElement("figure"),
          cap = document.createElement("figcaption");
        cap.textContent = `${img.naturalWidth} × ${img.naturalHeight}`;
        f.append(img, cap);
        document.querySelector("#icons").append(f);
      }
      return {
        width: built.naturalWidth,
        height: built.naturalHeight,
        identical: a.every((v, i) => v === b[i]),
      };
    },
    { base, original: "data:image/png;base64," + original.toString("base64") },
  );
  assert.equal(pixels.identical, true);
  result.originalPixels = pixels;
  result.manifest = manifest;
  await page.screenshot({ path: `${out}/original-icons.png`, fullPage: true });
  assert.equal(result.externalRequests, 0);
  await writeFile(`${out}/icons.json`, JSON.stringify(result, null, 2));
  console.log(
    JSON.stringify({
      passed: true,
      verifiedURLs: result.urls.length,
      originalPixelsIdentical: true,
    }),
  );
} finally {
  await browser.close();
}
