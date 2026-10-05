// Runs a separate headless browser/profile. Never connects to an existing Chrome session.
import assert from "node:assert/strict";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { pathToFileURL } from "node:url";
const { chromium } = await import(pathToFileURL(process.argv[2]));
const out = process.argv[3];
assert.ok(out);
await mkdir(out, { recursive: true });
const base = "http://127.0.0.1:4186",
  html = await readFile(new URL("../index.html", import.meta.url), "utf8");
const browser = await chromium.launch({ channel: "chrome", headless: true });
const results = {
  browser: browser.version(),
  isolatedProfile: true,
  externalRequests: 0,
  layouts: [],
  failures: [],
};
try {
  for (const width of [320, 390, 1024]) {
    const context = await browser.newContext({
      viewport: { width, height: 844 },
      hasTouch: true,
    });
    await context.grantPermissions(["local-network-access"], { origin: base });
    await context.route("**/*", (route) => {
      if (new URL(route.request().url()).origin !== base) {
        results.externalRequests++;
        return route.abort();
      }
      if (route.request().resourceType() === "document")
        return route.fulfill({ contentType: "text/html", body: html });
      return route.continue();
    });
    const page = await context.newPage();
    await page.goto(base + "/Readability");
    const field = page.getByRole("textbox", { name: "New item", exact: true });
    for (const text of [
      "Synthetic completed item with readable wrapping text",
      "Synthetic active item",
    ]) {
      await field.fill(text);
      await field.press("Enter");
    }
    await page.getByRole("checkbox").first().check();
    await page.evaluate(async () => {
      const { installPhotoUI } = await import("/src/photo/ui.ts");
      const { MockPhotoGateway } = await import("/src/photo/gateway.ts");
      await import("/src/photo/photo.css");
      window.photoUI = installPhotoUI(
        document.querySelector("#app"),
        new MockPhotoGateway(async () => {
          throw new Error("Unused synthetic processor");
        }),
        { minimal: true },
      );
    });
    await page.locator(".photo-manage").first().waitFor();
    await page.waitForFunction(
      () =>
        getComputedStyle(document.querySelector(".clear-slot")).opacity === "1",
    );
    const samples = [];
    async function measure(
      name,
      selector,
      target = 4.5,
      pseudo = null,
      paint = "color",
    ) {
      const s = await page
        .locator(selector)
        .first()
        .evaluate(
          (el, { pseudo, paint }) => {
            const rgb = (s) => s.match(/[\d.]+/g).map(Number);
            const style = getComputedStyle(el, pseudo);
            let node = el,
              bg;
            while (node) {
              const value = rgb(getComputedStyle(node).backgroundColor);
              if (value.length === 3 || value[3] !== 0) {
                bg = value;
                break;
              }
              node = node.parentElement;
            }
            const lum = (c) =>
              c
                .slice(0, 3)
                .map((x) => {
                  x /= 255;
                  return x <= 0.04045
                    ? x / 12.92
                    : ((x + 0.055) / 1.055) ** 2.4;
                })
                .reduce((v, x, i) => v + x * [0.2126, 0.7152, 0.0722][i], 0);
            const fg = rgb(style[paint]);
            if (
              (fg.length > 3 && fg[3] !== 1) ||
              (bg?.length > 3 && bg[3] !== 1)
            )
              throw new Error("This contrast fixture requires opaque paint");
            for (let ancestor = el; ancestor; ancestor = ancestor.parentElement)
              if (Number(getComputedStyle(ancestor).opacity) !== 1)
                throw new Error(
                  "Wait for opacity transitions before measuring",
                );
            const l1 = lum(fg),
              l2 = lum(bg ?? [255, 255, 255]);
            return {
              color: style[paint],
              background: bg,
              ratio: (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05),
              fontSize: style.fontSize,
            };
          },
          { pseudo, paint },
        );
      samples.push({ name, target, ...s });
      if (
        ["saved status", "footer count", "About link"].includes(name) &&
        parseFloat(s.fontSize) < 12
      )
        results.failures.push({
          width,
          name,
          fontSize: s.fontSize,
          minimumFontSize: 12,
        });
      if (s.ratio < target)
        results.failures.push({ width, name, ratio: s.ratio, target });
    }
    await measure("saved status", ".status");
    await measure("footer count", ".bottom > span");
    await measure("About link", ".about-link");
    await measure("completed editable text", ".item.done .name");
    await measure(
      "checked checkmark",
      '.item.done input[type="checkbox"]',
      3,
      "::after",
    );
    await measure(
      "checked border",
      '.item.done input[type="checkbox"]',
      3,
      null,
      "borderTopColor",
    );
    await measure("reorder icon", ".drag-handle", 3);
    await measure("camera icon", ".photo-manage", 3);
    await measure("delete icon", ".delete-item:not([hidden])", 3);
    await measure("header button", "nav .btn");
    await measure("Clear checked button", ".clear-slot .text-button");
    await page.locator(".clear-slot .text-button").hover();
    await measure("Clear checked hover", ".clear-slot .text-button");
    await page.mouse.move(0, 0);
    await measure("new-item placeholder", ".add input", 4.5, "::placeholder");
    await measure("Add button", ".add .btn");
    await page.locator(".add .btn").hover();
    await measure("Add button hover", ".add .btn");
    await page.mouse.move(0, 0);
    await field.fill("Synthetic unsubmitted draft");
    await measure("draft status", ".status");
    await page.screenshot({ path: `${out}/readable-${width}.png` });
    await page.getByRole("button", { name: "new list", exact: true }).click();
    await measure("dialog confirmation", "dialog[open] .primary");
    await page
      .getByRole("button", { name: "Close dialog", exact: true })
      .click();
    assert.equal(await field.inputValue(), "Synthetic unsubmitted draft");
    await field.fill("");
    await page.locator(".item.done .name").focus();
    await measure("focused completed text", ".item.done .name");
    await page.locator(".item.done .name").press("Escape");
    // Visual offline/maintenance samples cover their CSS, not network state transitions.
    await page.locator(".status").evaluate((el) => {
      el.classList.add("offline");
      el.textContent = "Offline · keep this tab open";
    });
    await measure("offline visual fixture", ".status");
    await page.locator(".status").evaluate((el) => {
      el.classList.remove("offline");
      el.textContent = "Maintenance · editing paused";
    });
    await measure("maintenance visual fixture", ".status");
    await page.evaluate(() => {
      window.realLockRequest = navigator.locks.request.bind(navigator.locks);
      navigator.locks.request = async (name, callback) => {
        await new Promise((resolve) => {
          window.releaseSave = resolve;
        });
        return callback();
      };
    });
    await field.fill("Synthetic pending save");
    await field.press("Enter");
    assert.equal(await page.locator(".status").textContent(), "Saving…");
    await measure("saving status", ".status");
    await page.evaluate(() => {
      navigator.locks.request = window.realLockRequest;
      window.releaseSave();
    });
    await page.waitForFunction(
      () =>
        document.querySelector(".status").textContent ===
        "Saved on this device",
    );
    await page.evaluate(() => {
      window.realStorageSet = Storage.prototype.setItem;
      Storage.prototype.setItem = () => {
        throw new Error("Synthetic storage failure");
      };
    });
    await field.fill("Synthetic failed save");
    await field.press("Enter");
    await page.waitForFunction(
      () =>
        document.querySelector(".status").textContent ===
        "Changes need attention",
    );
    await measure("failed status", ".status");
    await measure("save error message", ".error");
    await page.evaluate(() => {
      Storage.prototype.setItem = window.realStorageSet;
    });
    await page.getByRole("button", { name: "Retry", exact: true }).click();
    await page.waitForFunction(
      () =>
        document.querySelector(".status").textContent ===
        "Saved on this device",
    );
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
      false,
    );
    results.layouts.push({ width, samples });
    await context.close();
  }
  assert.equal(results.externalRequests, 0);
  await writeFile(`${out}/contrast.json`, JSON.stringify(results, null, 2));
  console.log(
    JSON.stringify(
      {
        failures: results.failures,
        externalRequests: results.externalRequests,
      },
      null,
      2,
    ),
  );
  assert.deepEqual(results.failures, []);
} finally {
  await browser.close();
}
