import assert from "node:assert/strict";
import { createServer } from "node:http";
import { Readable } from "node:stream";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { fixture } from "../photo-lab/beta/test-support.ts";
const { chromium } = await import(pathToFileURL(process.argv[2]));
const f = await fixture();
let now = Date.now();
Object.defineProperty(f.engine, "now", { value: () => now });
f.ledger.value.control = {
  enabled: true,
  maintenance: true,
  lists: [],
  allLists: true,
};
const server = createServer(async (req, res) => {
  try {
    const response = await f.handler(
      new Request("http://127.0.0.1" + req.url, {
        method: req.method,
        headers: req.headers,
        body:
          req.method === "POST" && req.headers["content-type"]
            ? Readable.toWeb(req)
            : undefined,
        duplex: "half",
      }),
    );
    res.writeHead(response.status, Object.fromEntries(response.headers));
    res.end(Buffer.from(await response.arrayBuffer()));
  } catch {
    res.writeHead(503);
    res.end("Synthetic request failed");
  }
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const endpoint = `http://127.0.0.1:${server.address().port}/photo`,
  base = "http://127.0.0.1:4174";
const browser = await chromium.launch({ channel: "chrome", headless: true });
const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
const out = new URL("./results/", import.meta.url);
await mkdir(out, { recursive: true });
const results = {
  browser: browser.version(),
  scope:
    "loopback synthetic production photo UI with real local codec/files; desktop/mobile emulation",
  layouts: [],
  external_requests: 0,
  hosted_uploads: 0,
};
try {
  for (const width of [320, 390, 1024]) {
    now += 60000; // Independent layout scenarios use distinct simulated rate windows.
    const context = await browser.newContext({
      viewport: { width, height: 844 },
      isMobile: width < 500,
      hasTouch: width < 500,
    });
    await context.grantPermissions(["local-network-access"], { origin: base });
    await context.route("**/*", (route) => {
      const u = new URL(route.request().url());
      if (route.request().resourceType() === "document" && u.origin === base)
        return route.fulfill({
          status: 200,
          contentType: "text/html",
          body: html,
        });
      if (
        u.hostname !== "127.0.0.1" ||
        ![new URL(base).port, new URL(endpoint).port].includes(u.port)
      ) {
        results.external_requests++;
        return route.abort();
      }
      return route.continue();
    });
    const page = await context.newPage();
    page.setDefaultTimeout(7000);
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    await page.goto(base + "/index.html", { waitUntil: "networkidle" });
    for (const text of [
      "Synthetic apples",
      "Synthetic long item with enough words to inspect editing space at a narrow mobile width",
    ]) {
      await page
        .getByRole("textbox", { name: "New item", exact: true })
        .fill(text);
      await page.getByRole("button", { name: "add", exact: true }).click();
      await page
        .getByRole("textbox", { name: "Edit " + text, exact: true })
        .waitFor();
    }
    const keys = await page
      .locator(".item")
      .evaluateAll((rows) => rows.map((r) => r.dataset.key));
    keys.forEach((k) => f.textItems.add(k));
    const geometry = () =>
      page.locator(".item").evaluateAll((rows) =>
        rows.map((row) => {
          const rect = (e) => {
            const r = e.getBoundingClientRect();
            return {
              x: r.x,
              y: r.y,
              w: r.width,
              h: r.height,
              right: r.right,
              bottom: r.bottom,
            };
          };
          return {
            key: row.dataset.key,
            row: rect(row),
            handle: rect(row.querySelector(".drag-handle")),
            check: rect(row.querySelector("input[type=checkbox]")),
            camera: row.querySelector(".photo-manage")
              ? rect(row.querySelector(".photo-manage"))
              : null,
            padding: getComputedStyle(row).padding,
          };
        }),
      );
    const before = await geometry();
    await page.screenshot({
      path: new URL(`rows-${width}-before.png`, out).pathname,
      fullPage: true,
    });
    await page.evaluate(async (endpoint) => {
      await import("/src/photo/photo.css");
      const { installPhotoUI } = await import("/src/photo/ui.ts");
      const { HttpPhotoGateway } = await import("/src/photo/http-gateway.ts");
      window.reviewPhotos = installPhotoUI(
        document.querySelector("#app"),
        new HttpPhotoGateway(endpoint, "PhotoDemo"),
        { storage: "gateway", minimal: true },
      );
    }, endpoint);
    await page
      .getByRole("button", { name: "Add photo", exact: true })
      .first()
      .waitFor();
    const after = await geometry();
    for (let i = 0; i < before.length; i++) {
      assert.equal(after[i].row.h, before[i].row.h);
      assert.equal(after[i].padding, before[i].padding);
      assert.equal(after[i].check.x, before[i].check.x);
      assert.equal(after[i].handle.right, before[i].handle.right);
      assert(after[i].camera.w >= 44 && after[i].camera.h >= 44);
      assert(after[i].camera.right <= after[i].handle.x + 0.1);
      assert(
        after[i].camera.y >= after[i].row.y &&
          after[i].camera.bottom <= after[i].row.bottom,
      );
    }
    assert.equal(
      await page.locator(".photo-manage").first().innerText(),
      "\uf030",
    );
    await page.screenshot({
      path: new URL(`rows-${width}-camera.png`, out).pathname,
      fullPage: true,
    });
    const camera = page
      .getByRole("button", { name: "Add photo", exact: true })
      .first();
    await camera.focus();
    await camera.press("ArrowDown");
    assert.deepEqual(
      await page
        .locator(".item")
        .evaluateAll((rows) => rows.map((r) => r.dataset.key)),
      keys,
    );
    await camera.press("Enter");
    await page.getByRole("dialog").waitFor();
    assert.equal(
      await page.getByRole("button", { name: "Try synthetic image" }).count(),
      0,
    );
    assert.equal(
      await page.getByText(/Photo beta|Local preview · JPEG/).count(),
      0,
    );
    await page
      .locator("dialog input[type=file]")
      .last()
      .setInputFiles(
        new URL("../photo-lab/fixtures/browser/phone-12mp.jpg", import.meta.url)
          .pathname,
      );
    await page.getByRole("button", { name: "Save photo", exact: true }).click();
    await page.locator(".photo-thumbnail").waitFor();
    const saved = await geometry();
    assert.equal(saved[0].row.h, before[0].row.h);
    await page.screenshot({
      path: new URL(`rows-${width}-saved.png`, out).pathname,
      fullPage: true,
    });
    // Existing grab handle still reorders, while camera keyboard actions did not.
    await page
      .locator(".item")
      .first()
      .locator(".drag-handle")
      .press("ArrowDown");
    await page.waitForFunction(
      (first) => document.querySelector(".item").dataset.key !== first,
      keys[0],
    );
    await page
      .getByRole("button", { name: "Expand item photo", exact: true })
      .click();
    await page.getByRole("dialog").waitFor();
    await page.getByRole("button", { name: "Close", exact: true }).click();
    const item = page.locator(`.item[data-key="${keys[0]}"]`);
    f.ledger.value.control.enabled = false;
    await item
      .getByRole("button", { name: "Change photo", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Remove photo", exact: true })
      .click();
    await item.locator(".photo-thumbnail").waitFor({ state: "detached" });
    f.ledger.value.control.enabled = true;
    await item.locator("input[type=checkbox]").check();
    await item.locator(".delete-item").waitFor({ state: "visible" });
    // Re-attach after removal, then use the real text-save callback to remove the observed photo.
    await item.getByRole("button", { name: "Add photo", exact: true }).click();
    await page
      .locator("dialog input[type=file]")
      .last()
      .setInputFiles(
        new URL("../photo-lab/fixtures/browser/phone-12mp.jpg", import.meta.url)
          .pathname,
      );
    await page.getByRole("button", { name: "Save photo", exact: true }).click();
    await item.locator(".photo-thumbnail").waitFor();
    // Use the other row for deletion so the saved row can still provide wrapped layout evidence.
    const other = page.locator(`.item[data-key="${keys[1]}"]`);
    await other.getByRole("button", { name: "Add photo", exact: true }).click();
    await page
      .locator("dialog input[type=file]")
      .last()
      .setInputFiles(
        new URL("../photo-lab/fixtures/browser/phone-12mp.jpg", import.meta.url)
          .pathname,
      );
    await page.getByRole("button", { name: "Save photo", exact: true }).click();
    await other.locator(".photo-thumbnail").waitFor();
    const beforeDelete = f.paths.size;
    await other.locator("input[type=checkbox]").check();
    await other.locator(".delete-item").click();
    await other.waitFor({ state: "detached" });
    await page.waitForFunction(
      () => !document.querySelector(".photo-cleanup")?.textContent,
    );
    assert.equal(f.paths.size, beforeDelete - 1);
    // Layout robustness for a tall/wrapped editor: does not force row height or overlap controls.
    const wrapped = await item.evaluate((row) => {
      const field = row.querySelector(".name");
      const text = document.createElement("div");
      text.className = "name";
      text.textContent =
        "Wrapped synthetic item\nwith multiple lines and additional words";
      text.style.whiteSpace = "pre-wrap";
      field.replaceWith(text);
      const r = row.getBoundingClientRect(),
        c = row.querySelector(".photo-manage").getBoundingClientRect();
      return {
        height: r.height,
        cameraWithin: c.top >= r.top && c.bottom <= r.bottom,
        padding: getComputedStyle(row).padding,
      };
    });
    assert(wrapped.cameraWithin);
    assert.equal(wrapped.padding, before[0].padding);
    await page.screenshot({
      path: new URL(`rows-${width}-wrapped.png`, out).pathname,
      fullPage: true,
    });
    assert.deepEqual(errors, []);
    results.layouts.push({
      width,
      before,
      after,
      saved,
      wrapped,
      cameraKeyboardNoReorder: true,
      handleKeyboardReorder: true,
      removeWhileUploadsPaused: true,
      reattachAfterRemoval: true,
      confirmedTextDeleteCleanup: true,
    });
    await context.close();
  }
  assert.equal(results.external_requests, 0);
  results.passed = true;
} finally {
  await writeFile(
    new URL("browser.json", out),
    JSON.stringify(results, null, 2) + "\n",
  );
  await browser.close();
  await new Promise((r) => server.close(r));
}
console.log(
  JSON.stringify({
    passed: results.passed,
    widths: results.layouts.map((x) => x.width),
    external_requests: results.external_requests,
  }),
);
