import assert from "node:assert/strict";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
const { chromium } = await import(pathToFileURL(process.argv[2]));
const out = process.argv[3];
assert.ok(out);
await mkdir(out, { recursive: true });
const base = "http://127.0.0.1:4174",
  html = await readFile(new URL("../index.html", import.meta.url), "utf8");
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
      hasTouch: true,
      isMobile: width < 500,
    });
    await context.grantPermissions(["local-network-access"], { origin: base });
    await context.route("**/*", (route) => {
      const u = new URL(route.request().url());
      if (u.origin !== base) {
        results.externalRequests++;
        return route.abort();
      }
      if (route.request().resourceType() === "document")
        return route.fulfill({ contentType: "text/html", body: html });
      return route.continue();
    });
    const page = await context.newPage();
    page.setDefaultTimeout(5000);
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    await page.goto(base + "/Synthetic");
    const add = page.getByRole("textbox", { name: "New item", exact: true });
    await add.fill("Draft stays here");
    const longPath = "/MyCustomList" + "LongName".repeat(12);
    await page.evaluate((path) => {
      history.replaceState(null, "", path);
      Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: {
          writeText: async (text) => {
            window.copiedLink = text;
          },
        },
      });
    }, longPath);
    const current = base + longPath;
    const modal = page.locator("dialog[open]");
    async function outside(touch = false) {
      if (touch) await page.touchscreen.tap(2, 2);
      else await page.mouse.click(2, 2);
      await modal.waitFor({ state: "detached" });
    }
    async function checkTarget() {
      const b = await modal.locator(".modal-close").boundingBox();
      assert.ok(b.width >= 44 && b.height >= 44);
      assert.equal(
        await modal
          .getByRole("button", { name: /^(Close|Cancel|Stay)$/ })
          .count(),
        0,
      );
    }
    for (const action of ["new list", "share your list"]) {
      await page.getByRole("button", { name: action, exact: true }).click();
      await checkTarget();
      assert.equal(
        await modal
          .getByRole("textbox", { name: "Current list link", exact: true })
          .inputValue(),
        current,
      );
      await modal
        .getByRole("textbox", { name: "Current list link", exact: true })
        .press("Enter");
      await modal
        .getByRole("button", { name: "Copy link", exact: true })
        .click();
      await page.waitForFunction(
        () =>
          document.querySelector("dialog[open] .copy-feedback").textContent ===
          "Link copied",
      );
      assert.equal(await page.evaluate(() => window.copiedLink), current);
      assert.equal(page.url(), current);
      assert.equal(await add.inputValue(), "Draft stays here");
      await modal.locator("h2").click();
      assert.equal(await modal.count(), 1);
      await page.screenshot({
        path: `${out}/${action.startsWith("new") ? "new-list" : "share"}-${width}.png`,
      });
      await outside(width < 500);
      assert.equal(
        await page
          .getByRole("button", { name: action, exact: true })
          .evaluate((e) => e === document.activeElement),
        true,
      );
      await page.getByRole("button", { name: action, exact: true }).click();
      await page.evaluate(() => {
        navigator.clipboard.writeText = async () => {
          throw new Error("Synthetic clipboard denial");
        };
      });
      await modal
        .getByRole("button", { name: "Copy link", exact: true })
        .click();
      await page.waitForFunction(() =>
        document
          .querySelector("dialog[open] .copy-feedback")
          .textContent.includes("manually"),
      );
      assert.equal(
        await modal
          .locator("input")
          .evaluate((e) => e.selectionEnd - e.selectionStart),
        current.length,
      );
      await page.keyboard.press("Escape");
      assert.equal(await add.inputValue(), "Draft stays here");
      await page.evaluate(() => {
        navigator.clipboard.writeText = async (text) => {
          window.copiedLink = text;
        };
      });
    }
    await add.fill("");
    await page.getByRole("button", { name: "new list", exact: true }).click();
    await checkTarget();
    assert.match(await modal.textContent(), /Create a new list/);
    await modal
      .getByRole("button", { name: "Close dialog", exact: true })
      .click();
    assert.equal(page.url(), current);
    await page
      .getByRole("link", { name: "About & Privacy", exact: true })
      .click();
    await checkTarget();
    await modal.evaluate((e) => {
      e.scrollTop = e.scrollHeight;
    });
    const aboutX = await modal.locator(".modal-close").boundingBox();
    const about = await modal.boundingBox();
    assert.ok(
      aboutX.y >= about.y && aboutX.y + aboutX.height <= about.y + about.height,
    );
    await page.screenshot({ path: `${out}/about-bottom-${width}.png` });
    await modal
      .getByRole("button", { name: "Close About & Privacy", exact: true })
      .click();
    await page
      .getByRole("link", { name: "About & Privacy", exact: true })
      .click();
    await outside(true);
    for (const text of ["Synthetic checked item", "Synthetic photo item"]) {
      await add.fill(text);
      await add.press("Enter");
    }
    await page
      .getByRole("checkbox", {
        name: "Complete Synthetic checked item",
        exact: true,
      })
      .check();
    await page
      .getByRole("button", { name: "Clear all checked", exact: true })
      .click();
    await checkTarget();
    await modal.locator("p").first().click();
    assert.equal(await page.locator(".item").count(), 2);
    await outside(true);
    assert.equal(await page.locator(".item").count(), 2);
    await page
      .getByRole("button", { name: "Clear all checked", exact: true })
      .click();
    await modal
      .getByRole("button", { name: "Close dialog", exact: true })
      .click();
    assert.equal(await page.locator(".item").count(), 2);
    await page.evaluate(async () => {
      const { MockPhotoGateway } = await import("/src/photo/gateway.ts");
      const { installPhotoUI } = await import("/src/photo/ui.ts");
      const { inspectJpeg } = await import("/src/photo/jpeg.ts");
      await import("/src/photo/photo.css");
      const full = await (
          await fetch("/photo-lab/fixtures/clean-full.jpg")
        ).blob(),
        thumbnail = await (
          await fetch("/photo-lab/fixtures/clean-thumbnail.jpg")
        ).blob();
      const jpeg = new Blob(
        [
          Uint8Array.from(
            inspectJpeg(new Uint8Array(await full.arrayBuffer())).sanitized,
          ),
        ],
        { type: "image/jpeg" },
      );
      const gateway = new MockPhotoGateway(async () => ({ full, thumbnail }));
      window.syntheticPhotos = gateway;
      const key = document.querySelectorAll(".item")[1].dataset.key;
      await gateway.put(
        key,
        null,
        { operationId: crypto.randomUUID(), jpeg },
        new AbortController().signal,
      );
      window.photoReads = 0;
      const get = gateway.get.bind(gateway);
      gateway.get = (...args) => {
        window.photoReads++;
        return get(...args);
      };
      window.photoUI = installPhotoUI(document.querySelector("#app"), gateway, {
        minimal: true,
        synthetic: async () => ({ jpeg, width: 1280, height: 960 }),
        timeout: 1000,
      });
    });
    await page
      .getByRole("button", { name: "Change photo", exact: true })
      .waitFor();
    await page.getByRole("button", { name: "Add photo", exact: true }).click();
    await checkTarget();
    await outside(true);
    await page
      .getByRole("button", { name: "Change photo", exact: true })
      .click();
    await checkTarget();
    const reads = await page.evaluate(() => window.photoReads);
    await modal.locator(".photo-preview img").evaluate((img) => img.decode());
    await page.screenshot({ path: `${out}/photo-${width}.png` });
    await modal
      .getByRole("button", { name: "Close photo", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Change photo", exact: true })
      .click();
    assert.equal(await page.evaluate(() => window.photoReads), reads);
    await modal
      .getByRole("button", { name: "Expand photo", exact: true })
      .click();
    await page.screenshot({ path: `${out}/lightbox-${width}.png` });
    await modal.locator("img").click();
    assert.equal(
      await modal.evaluate((e) => e.classList.contains("photo-lightbox")),
      false,
    );
    await modal
      .getByRole("button", { name: "Expand photo", exact: true })
      .click();
    await page.keyboard.press("Escape");
    assert.equal(
      await modal.evaluate((e) => e.classList.contains("photo-lightbox")),
      false,
    );
    await modal
      .getByRole("button", { name: "Expand photo", exact: true })
      .click();
    await modal.locator(".photo-preview").press("Enter");
    assert.equal(
      await modal.evaluate((e) => e.classList.contains("photo-lightbox")),
      false,
    );
    await modal
      .getByRole("button", { name: "Expand photo", exact: true })
      .click();
    await page.touchscreen.tap(2, 200);
    await modal.waitFor({ state: "detached" });
    await page
      .getByRole("button", { name: "Change photo", exact: true })
      .click();
    await modal
      .getByRole("button", { name: "Try synthetic image", exact: true })
      .click();
    await page.waitForFunction(
      () =>
        !document.querySelector('dialog[open] [aria-label="Save photo"]')
          .disabled,
    );
    await outside();
    assert.equal(
      await page.evaluate(() => window.syntheticPhotos.records.size),
      1,
    );
    await page.evaluate(() => {
      const put = window.syntheticPhotos.put.bind(window.syntheticPhotos);
      window.syntheticPhotos.put = async (...args) => {
        await new Promise((resolve) => {
          window.releasePhotoRequest = resolve;
        });
        return put(...args);
      };
    });
    await page
      .getByRole("button", { name: "Change photo", exact: true })
      .click();
    await modal
      .getByRole("button", { name: "Try synthetic image", exact: true })
      .click();
    await modal
      .getByRole("button", { name: "Save photo", exact: true })
      .click();
    await page.waitForFunction(
      () => typeof window.releasePhotoRequest === "function",
    );
    await page.screenshot({ path: `${out}/photo-in-progress-${width}.png` });
    await outside(true);
    assert.match(
      await page.locator(".photo-operation").textContent(),
      /does not cancel/,
    );
    await page
      .getByRole("button", { name: "Change photo", exact: true })
      .click();
    await page.evaluate(() => window.releasePhotoRequest());
    await page.waitForFunction(
      () =>
        document.querySelector(".photo-operation").textContent ===
        "Photo saved.",
    );
    assert.equal(
      await modal.count(),
      1,
      "late save must not close a reopened view",
    );
    await modal
      .getByRole("button", { name: "Close photo", exact: true })
      .click();
    await page.evaluate(() => {
      window.syntheticPhotos.fault = "offline";
    });
    await page.getByRole("button", { name: "Add photo", exact: true }).click();
    await checkTarget();
    await page.keyboard.press("Escape");
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
      false,
    );
    assert.deepEqual(errors, []);
    results.layouts.push({
      width,
      mouseAndTouchDismiss: true,
      insideClickSafe: true,
      copySuccessAndFailure: true,
      currentLongURL: true,
      copyAndEnterNeverCreate: true,
      draftPreserved: true,
      aboutCloseVisibleAfterScroll: true,
      clearDismissNeverDeletes: true,
      photoAddSavedErrorDraftDismiss: true,
      lightboxImageTapAndEscapeReturn: true,
      lightboxBackgroundDismiss: true,
      cachedReopen: true,
      keyboardLightboxReturn: true,
      dismissDuringSaveDoesNotCancelOrCloseReopenedView: true,
    });
    await context.close();
  }
  assert.equal(results.externalRequests, 0);
  await writeFile(
    `${out}/modal-browser.json`,
    JSON.stringify(results, null, 2),
  );
  console.log(JSON.stringify(results, null, 2));
} finally {
  await browser.close();
}
