// Fresh isolated Chrome profiles, synthetic photos, loopback-only requests.
import assert from "node:assert/strict";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
const { chromium } = await import(pathToFileURL(process.argv[2]));
const out = process.argv[3];
await mkdir(out, { recursive: true });
const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
const browser = await chromium.launch({ channel: "chrome", headless: true });
const results = { externalRequests: 0, scenarios: [] };
try {
  for (const reducedMotion of ["no-preference", "reduce"]) {
    for (const width of [320, 390, 1024]) {
      const context = await browser.newContext({
        viewport: { width, height: 844 },
        reducedMotion,
      });
      const base = "http://127.0.0.1:4186";
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
      page.setDefaultTimeout(6000);
      await page.goto(base + "/CheckedReview");
      const input = page.locator(".add input");
      for (const text of [
        "Synthetic apples",
        "Synthetic bread",
        "Keep this item",
      ]) {
        await input.fill(text);
        await input.press("Enter");
      }
      for (const text of ["Synthetic apples", "Synthetic bread"]) {
        const row = page.locator(".item").filter({
          has: page.getByRole("textbox", {
            name: `Edit ${text}`,
            exact: true,
          }),
        });
        await row.getByRole("checkbox").check();
      }
      await page.waitForFunction(
        () =>
          document.querySelector(".checked-count").textContent ===
          "2 of 3 checked",
      );
      await page.waitForFunction(
        () =>
          getComputedStyle(document.querySelector(".clear-slot")).opacity ===
          "1",
      );
      assert.equal(
        await page.locator(".clear-inner .checked-count").textContent(),
        "2 of 3 checked",
      );
      assert.equal(await page.locator(".bottom .checked-count").count(), 0);
      const palette = await page
        .locator(".item.done")
        .first()
        .evaluate((row) => ({
          text: getComputedStyle(row.querySelector(".name")).color,
          border: getComputedStyle(row.querySelector("input")).borderColor,
          mark: getComputedStyle(row.querySelector("input"), "::after").color,
        }));
      assert.deepEqual(palette, {
        text: "rgb(184, 174, 126)",
        border: "rgb(209, 200, 152)",
        mark: "rgb(201, 192, 144)",
      });
      await page.evaluate(async () => {
        const { MockPhotoGateway } = await import("/src/photo/gateway.ts");
        const { inspectJpeg } = await import("/src/photo/jpeg.ts");
        const { installPhotoUI } = await import("/src/photo/ui.ts");
        const { cleanupJournal } =
          await import("/src/photo/cleanup-journal.ts");
        await import("/src/photo/photo.css");
        const full = await (
          await fetch("/photo-lab/fixtures/clean-full.jpg")
        ).blob();
        const thumbnail = await (
          await fetch("/photo-lab/fixtures/clean-thumbnail.jpg")
        ).blob();
        const adapter = new MockPhotoGateway(async () => ({ full, thumbnail }));
        const jpeg = new Blob(
          [
            Uint8Array.from(
              inspectJpeg(new Uint8Array(await full.arrayBuffer())).sanitized,
            ),
          ],
          { type: "image/jpeg" },
        );
        for (const row of document.querySelectorAll(".item.done"))
          await adapter.put(
            row.dataset.key,
            null,
            { operationId: crypto.randomUUID(), jpeg },
            new AbortController().signal,
          );
        window.cleanupCalls = [];
        window.cleanupReleases = [];
        window.cleanupFails = true;
        const remove = adapter.remove.bind(adapter);
        adapter.remove = async (key, version, signal) => {
          window.cleanupCalls.push({ key, version });
          await new Promise((resolve) => window.cleanupReleases.push(resolve));
          if (window.cleanupFails) throw new Error("Synthetic cleanup failure");
          return remove(key, version, signal);
        };
        window.cleanupJournal = cleanupJournal(localStorage, "CheckedReview");
        window.photos = adapter;
        window.photoUI = installPhotoUI(
          document.querySelector("#app"),
          adapter,
          {
            minimal: true,
            cleanupJournal: window.cleanupJournal,
            timeout: 10000,
          },
        );
      });
      await page.waitForFunction(
        () => document.querySelectorAll(".photo-thumbnail").length === 2,
      );
      const prefix = `${out}/${width}-${reducedMotion}`;
      await page.screenshot({ path: prefix + "-checked.png" });
      const geometry = await page.locator(".clear-inner").evaluate((el) => {
        const count = el
            .querySelector(".checked-count")
            .getBoundingClientRect(),
          button = el.querySelector("button").getBoundingClientRect();
        return {
          sameRow:
            Math.abs(
              (count.top + count.bottom) / 2 - (button.top + button.bottom) / 2,
            ) < 3,
          countLeft: count.right < button.left,
          transition: getComputedStyle(el.parentElement).transitionDuration,
        };
      });
      assert.ok(geometry.sameRow && geometry.countLeft);
      if (reducedMotion === "reduce") assert.equal(geometry.transition, "0s");
      await input.fill("Keep this unsubmitted draft");
      await page
        .getByRole("button", { name: "Clear all checked", exact: true })
        .click();
      // Repeated confirmation events must not duplicate the batch or photo removals.
      await page.locator("dialog[open] .primary").evaluate((b) => {
        b.click();
        b.click();
        document.querySelector(".clear-inner > button").click();
      });
      await page.waitForFunction(() => window.cleanupCalls.length === 2);
      await page.waitForFunction(
        () => document.querySelectorAll(".item").length === 1,
      );
      assert.equal(
        await page.locator(".clear-feedback .photo-cleanup").textContent(),
        "Cleaning photos…",
      );
      assert.equal(
        await page.locator(".clear-inner > button").isVisible(),
        false,
      );
      assert.equal(
        await page.locator("main .photo-recovery").isVisible(),
        false,
      );
      await page.screenshot({ path: prefix + "-pending.png" });
      await page.evaluate(() =>
        window.cleanupReleases.splice(0).forEach((resolve) => resolve()),
      );
      const retry = page.getByRole("button", {
        name: "Retry photo cleanup",
        exact: true,
      });
      await retry.waitFor();
      await page.waitForTimeout(1550); // Failures must outlive the success dismissal timer.
      assert.equal(await retry.isVisible(), true);
      assert.equal(
        await page.evaluate(() => window.cleanupJournal.load().length),
        2,
      );
      await page.screenshot({ path: prefix + "-failure.png" });
      assert.equal(await input.inputValue(), "Keep this unsubmitted draft");
      if (width === 390) {
        await page.getByRole("checkbox").check(); // New checked work stays available after cleanup settles.
        await page.waitForFunction(
          () =>
            document.querySelector(".checked-count").textContent ===
            "1 of 1 checked",
        );
      }
      await retry.focus();
      await retry.evaluate((b) => {
        b.click();
        b.click();
      });
      await page.waitForFunction(() => window.cleanupCalls.length === 4);
      assert.equal(
        await page.evaluate(
          () => document.activeElement === document.querySelector(".add input"),
        ),
        true,
      );
      await page.evaluate(() => {
        window.cleanupFails = false;
        window.cleanupReleases.splice(0).forEach((resolve) => resolve());
      });
      await page.waitForFunction(
        () =>
          document.querySelector(".photo-cleanup").textContent ===
          "Photo cleanup complete.",
      );
      assert.equal(
        await page.evaluate(() => window.cleanupJournal.load().length),
        0,
      );
      assert.equal(await page.evaluate(() => window.photos.records.size), 0);
      await page.screenshot({ path: prefix + "-success.png" });
      // Sample the exit frames: successful cleanup must not flash the pink action.
      if (width !== 390)
        await page.evaluate(() => {
          window.clearExitSamples = [];
          const sample = () => {
            const slot = document.querySelector(".clear-slot"),
              button = slot.querySelector("button");
            window.clearExitSamples.push({
              opacity: Number(getComputedStyle(slot).opacity),
              clearHidden: button.hidden,
            });
            if (getComputedStyle(slot).visibility !== "hidden")
              requestAnimationFrame(sample);
          };
          requestAnimationFrame(sample);
        });
      await page.waitForFunction(
        () =>
          document.querySelector(".photo-cleanup-feedback").dataset.active ===
          "false",
      );
      if (width === 390) {
        assert.equal(
          await page.locator(".clear-inner > button").isVisible(),
          true,
        );
        assert.equal(
          await page.locator(".clear-inner .checked-count").textContent(),
          "1 of 1 checked",
        );
        await page.getByRole("checkbox").uncheck();
      }
      await page.waitForFunction(
        () =>
          getComputedStyle(document.querySelector(".clear-slot")).opacity ===
          "0",
      );
      assert.equal(
        await page.locator(".clear-slot").evaluate((el) => el.inert),
        true,
      );
      assert.equal(
        await page.locator(".bottom .checked-count").textContent(),
        "0 of 1 checked",
      );
      assert.equal(await input.inputValue(), "Keep this unsubmitted draft");
      const final = await page.evaluate(() => ({
        overflow: document.documentElement.scrollWidth > innerWidth,
        slotHeight: document
          .querySelector(".clear-slot")
          .getBoundingClientRect().height,
        bottomPadding: parseFloat(
          getComputedStyle(document.querySelector(".bottom")).paddingBottom,
        ),
      }));
      assert.equal(final.overflow, false);
      assert.ok(final.slotHeight < 1);
      assert.ok(final.bottomPadding >= 20);
      await page.screenshot({ path: prefix + "-settled.png" });
      if (width !== 390) {
        const frames = await page.evaluate(() => window.clearExitSamples);
        assert.ok(frames.length > 0);
        assert.ok(frames.every((frame) => frame.clearHidden));
        if (reducedMotion !== "reduce")
          assert.ok(
            frames.some((frame) => frame.opacity > 0 && frame.opacity < 1),
          );
      }
      const calls = await page.evaluate(() => window.cleanupCalls);
      assert.deepEqual(calls.slice(0, 2), calls.slice(2));
      let journalFailureAtShortHeight = false;
      if (width === 320 && reducedMotion === "reduce") {
        await page.evaluate(async () => {
          window.photoUI.close();
          window.journalFails = true;
          const { installPhotoUI } = await import("/src/photo/ui.ts");
          window.photoUI = installPhotoUI(
            document.querySelector("#app"),
            window.photos,
            {
              minimal: true,
              cleanupJournal: {
                load() {
                  if (window.journalFails)
                    throw new Error("Synthetic journal failure");
                  return window.cleanupJournal.load();
                },
                add: (intent) => window.cleanupJournal.add(intent),
                remove: (intent) => window.cleanupJournal.remove(intent),
              },
            },
          );
        });
        await page.setViewportSize({ width, height: 420 });
        await retry.waitFor();
        await retry.scrollIntoViewIfNeeded();
        assert.match(
          await page.locator(".photo-cleanup").textContent(),
          /retry data could not be saved or restored/,
        );
        assert.equal(
          await page.evaluate(
            () => document.documentElement.scrollWidth > innerWidth,
          ),
          false,
        );
        const box = await retry.boundingBox();
        assert.ok(box.y >= 0 && box.y + box.height <= 420);
        await page.screenshot({ path: prefix + "-journal-warning-short.png" });
        await page.evaluate(() => {
          window.journalFails = false;
        });
        await retry.click();
        await page.waitForFunction(
          () =>
            document.querySelector(".photo-cleanup").textContent ===
            "Photo cleanup complete.",
        );
        assert.equal(await page.evaluate(() => window.cleanupCalls.length), 4);
        journalFailureAtShortHeight = true;
      }
      results.scenarios.push({
        width,
        journalFailureAtShortHeight,
        reducedMotion,
        geometry,
        palette,
        final,
        removals: calls.length,
        draftPreserved: true,
        retryDeduplicated: true,
        durableQueueClearedAfterSuccess: true,
      });
      await context.close();
    }
  }
  assert.equal(results.externalRequests, 0);
  await writeFile(
    `${out}/checked-cleanup.json`,
    JSON.stringify(results, null, 2),
  );
  console.log(
    JSON.stringify({
      passed: true,
      scenarios: results.scenarios.length,
      externalRequests: results.externalRequests,
    }),
  );
} finally {
  await browser.close();
}
