// Synthetic, loopback-only audit regressions. No production credentials or traffic.
import assert from "node:assert/strict";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
const { chromium } = await import(pathToFileURL(process.argv[2]));
const out = process.argv[3];
assert.ok(out, "Pass an absolute evidence directory");
await mkdir(out, { recursive: true });
const base = "http://127.0.0.1:4174";
const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
const browser = await chromium.launch({ channel: "chrome", headless: true });
const results = {
  browser: browser.version(),
  externalRequests: 0,
  layouts: [],
};
try {
  for (const width of [320, 390, 1024]) {
    const context = await browser.newContext({
      viewport: { width, height: 844 },
    });
    await context.grantPermissions(["local-network-access"], { origin: base });
    const navigations = [];
    await context.route("**/*", (route) => {
      const u = new URL(route.request().url());
      if (u.origin !== base) {
        results.externalRequests++;
        return route.abort();
      }
      if (route.request().resourceType() === "document") {
        navigations.push(u.pathname);
        return route.fulfill({ contentType: "text/html", body: html });
      }
      return route.continue();
    });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    const nativeDialogs = [];
    page.on("dialog", async (d) => {
      nativeDialogs.push(d.type());
      await d.dismiss();
    });
    await page.goto(base + "/Synthetic");
    const input = page.getByRole("textbox", { name: "New item", exact: true });
    await page.getByRole("button", { name: "add", exact: true }).waitFor();
    await input.fill("Synthetic draft 🍎");
    await page.waitForFunction(() =>
      document.querySelector(".status").textContent.includes("Draft item"),
    );
    await page.screenshot({ path: `${out}/draft-${width}.png` });
    await page.getByRole("button", { name: "new list", exact: true }).click();
    assert.match(
      await page.locator("dialog[open]").textContent(),
      /hasn't been added/,
    );
    await page.screenshot({ path: `${out}/draft-navigation-${width}.png` });
    await page.keyboard.press("Escape");
    assert.equal(await input.inputValue(), "Synthetic draft 🍎");
    await page.getByRole("button", { name: "new list", exact: true }).click();
    await page
      .getByRole("button", { name: "Close dialog", exact: true })
      .click();
    assert.equal(await input.inputValue(), "Synthetic draft 🍎");
    const before = page.url();
    await page.goto(base + "/Interrupted").catch(() => {});
    assert.equal(page.url(), before);
    assert.ok(nativeDialogs.includes("beforeunload"));
    assert.equal(await input.inputValue(), "Synthetic draft 🍎");
    await input.press("Enter");
    await input.press("Enter");
    await page.locator(".item").waitFor();
    assert.equal(await page.locator(".item").count(), 1);
    await page.evaluate(async () => {
      const { MockPhotoGateway } = await import("/src/photo/gateway.ts");
      const { inspectJpeg } = await import("/src/photo/jpeg.ts");
      const { installPhotoUI } = await import("/src/photo/ui.ts");
      const { cleanupJournal } = await import("/src/photo/cleanup-journal.ts");
      await import("/src/photo/photo.css");
      const full = await (
        await fetch("/photo-lab/fixtures/clean-full.jpg")
      ).blob();
      const thumbnail = await (
        await fetch("/photo-lab/fixtures/clean-thumbnail.jpg")
      ).blob();
      window.syntheticPhotos = new MockPhotoGateway(async () => ({
        full,
        thumbnail,
      }));
      const key = document.querySelector(".item").dataset.key;
      await window.syntheticPhotos.put(
        key,
        null,
        {
          operationId: crypto.randomUUID(),
          jpeg: new Blob(
            [
              Uint8Array.from(
                inspectJpeg(new Uint8Array(await full.arrayBuffer())).sanitized,
              ),
            ],
            { type: "image/jpeg" },
          ),
        },
        new AbortController().signal,
      );
      window.syntheticPhotoUI = installPhotoUI(
        document.querySelector("#app"),
        window.syntheticPhotos,
        {
          minimal: true,
          cleanupJournal: cleanupJournal(localStorage, "Synthetic"),
          timeout: 200,
        },
      );
    });
    await page.locator(".photo-thumbnail").waitFor();
    await page.evaluate(() => {
      window.syntheticPhotos.fault = "offline";
    });
    await page.getByRole("checkbox").check();
    await page
      .getByRole("button", { name: "Delete Synthetic draft 🍎", exact: true })
      .click();
    const retry = page.getByRole("button", {
      name: "Retry photo cleanup",
      exact: true,
    });
    await retry.waitFor();
    await page.waitForFunction(
      () =>
        ![...document.querySelectorAll("button")].find(
          (b) => b.getAttribute("aria-label") === "Retry photo cleanup",
        ).disabled,
    );
    assert.equal(await page.locator(".item").count(), 0);
    await page.screenshot({ path: `${out}/cleanup-waiting-${width}.png` });
    // Still failing: retry remains actionable and a fresh text item saves independently.
    await retry.click();
    await input.fill("Text still works during cleanup");
    await input.press("Enter");
    await page
      .getByRole("textbox", {
        name: "Edit Text still works during cleanup",
        exact: true,
      })
      .waitFor();
    await page.evaluate(async () => {
      window.syntheticPhotoUI.close();
      const { installPhotoUI } = await import("/src/photo/ui.ts");
      const { cleanupJournal } = await import("/src/photo/cleanup-journal.ts");
      window.syntheticPhotoUI = installPhotoUI(
        document.querySelector("#app"),
        window.syntheticPhotos,
        {
          minimal: true,
          cleanupJournal: cleanupJournal(localStorage, "Synthetic"),
          timeout: 200,
        },
      );
      window.syntheticPhotos.fault = "healthy";
    });
    await retry.click();
    await page.waitForFunction(
      () =>
        document.querySelector(".photo-cleanup").textContent ===
        "Photo cleanup complete.",
    );
    assert.equal(
      await page.evaluate(() => window.syntheticPhotos.records.size),
      0,
    );
    assert.equal(await page.locator(".item").count(), 1);
    await page.screenshot({ path: `${out}/cleanup-recovered-${width}.png` });
    await input.fill("Explicitly discarded draft");
    await page.getByRole("button", { name: "new list", exact: true }).click();
    await page
      .getByRole("button", { name: "Discard draft and create", exact: true })
      .click();
    await page.waitForLoadState("networkidle");
    assert.ok(navigations.includes("/new"));
    assert.equal(
      nativeDialogs.length,
      1,
      "explicit discard must not prompt a second time",
    );
    assert.deepEqual(errors, []);
    results.layouts.push({
      width,
      draftFeedback: true,
      escapeAndStayPreserveDraft: true,
      cancelledBrowserNavigationPreservesDraft: true,
      repeatedEnterAddsOnce: true,
      cleanupRetryAfterReinstall: true,
      textEditsDuringPhotoFailure: true,
      explicitDiscardNavigates: true,
    });
    await context.close();
  }
  assert.equal(results.externalRequests, 0);
  await writeFile(
    `${out}/reliability-browser.json`,
    JSON.stringify(results, null, 2),
  );
  console.log(JSON.stringify(results, null, 2));
} finally {
  await browser.close();
}
