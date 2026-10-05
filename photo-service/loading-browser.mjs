// Real UI module, controlled local-store boundary, fresh profiles and loopback only.
import assert from "node:assert/strict";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
const { chromium } = await import(pathToFileURL(process.argv[2]));
const out = process.argv[3];
await mkdir(out, { recursive: true });
const base = "http://127.0.0.1:4187";
const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
const storeFixture = `
window.sessions=[];
export async function reserveLocalList(){if(window.delayReservation) await new Promise(resolve=>(window.claims??=[]).push(resolve));return true;}
export class LocalStore {
 constructor(id){this.id=id;}
 subscribe(fn,connection,error){this.fn=fn;this.error=error;this.connection=connection;window.sessions.push(this);connection(true);return()=>{this.stopped=true;};}
 async apply(){throw new Error('Unexpected fixture write');}
 close(){this.closed=true;}
}`;
const browser = await chromium.launch({ channel: "chrome", headless: true });
const results = { externalRequests: 0, scenarios: [] };
const snapshot = (name) => ({
  title: `${name} title`,
  items: [
    { key: "a", ID: "a", name: `${name} item`, checked: false, priority: 1 },
  ],
});
try {
  for (const reducedMotion of ["no-preference", "reduce"])
    for (const width of [320, 390, 1024]) {
      const context = await browser.newContext({
        viewport: { width, height: 844 },
        reducedMotion,
      });
      await context.route("**/*", (route) => {
        const u = new URL(route.request().url());
        if (u.origin !== base) {
          results.externalRequests++;
          return route.abort();
        }
        if (u.pathname === "/src/local-store.ts")
          return route.fulfill({
            contentType: "application/javascript",
            body: storeFixture,
          });
        if (route.request().resourceType() === "document")
          return route.fulfill({ contentType: "text/html", body: html });
        return route.continue();
      });
      const page = await context.newPage();
      page.setDefaultTimeout(5000);
      await page.goto(base + "/Existing");
      await page.waitForFunction(() => window.sessions?.length === 1);
      assert.equal(await page.locator(".empty").isVisible(), false);
      assert.equal(await page.locator(".list-loading").isVisible(), true);
      assert.equal(
        await page.locator(".list-area").getAttribute("aria-busy"),
        "true",
      );
      assert.equal(
        await page
          .getByRole("status", { name: "Loading list", exact: true })
          .count(),
        1,
      );
      assert.equal(await page.locator(".add button").isDisabled(), true);
      const geometry = await page.locator(".sticky-top").boundingBox();
      await page.waitForTimeout(700);
      assert.equal(await page.locator(".empty").isVisible(), false);
      if (reducedMotion === "reduce")
        assert.equal(
          await page
            .locator(".list-spinner")
            .evaluate((el) => getComputedStyle(el).animationName),
          "none",
        );
      const prefix = `${out}/${width}-${reducedMotion}`;
      await page.screenshot({ path: prefix + "-slow.png" });
      await page.locator(".add input").fill("Draft typed while loading");
      await page.evaluate(
        (value) => window.sessions[0].fn(value),
        snapshot("Existing"),
      );
      await page
        .getByRole("textbox", { name: "Edit Existing item", exact: true })
        .waitFor();
      assert.equal(await page.locator(".empty").isVisible(), false);
      assert.equal(await page.locator(".list-loading").isVisible(), false);
      assert.equal(
        await page.locator(".list-area").getAttribute("aria-busy"),
        "false",
      );
      assert.equal(
        await page.locator(".add input").inputValue(),
        "Draft typed while loading",
      );
      assert.deepEqual(
        await page.locator(".sticky-top").boundingBox(),
        geometry,
      );
      if (reducedMotion === "reduce")
        assert.equal(
          await page
            .locator(".list")
            .evaluate((el) => getComputedStyle(el).animationName),
          "none",
        );
      await page.waitForFunction(
        () => getComputedStyle(document.querySelector(".list")).opacity === "1",
      );
      await page.screenshot({ path: prefix + "-loaded.png" });
      await page.locator(".add input").fill("");
      await page.goto(base + "/Failure");
      await page.waitForFunction(() => window.sessions?.length === 1);
      await page.locator(".add input").fill("Retry keeps this draft");
      await page.evaluate(() =>
        window.sessions[0].error(
          new Error("Synthetic permission failure. Retry loading this list."),
        ),
      );
      await page
        .getByRole("button", { name: "Retry loading list", exact: true })
        .waitFor();
      assert.equal(await page.locator(".list-loading").isVisible(), false);
      assert.equal(await page.locator(".empty").isVisible(), false);
      assert.equal(
        await page.evaluate(
          () => window.sessions[0].stopped && window.sessions[0].closed,
        ),
        true,
      );
      await page.screenshot({ path: prefix + "-failure.png" });
      await page
        .getByRole("button", { name: "Retry loading list", exact: true })
        .click();
      await page.waitForFunction(() => window.sessions.length === 2);
      await page.evaluate((value) => {
        window.sessions[0].fn(value);
        window.sessions[0].error(new Error("Stale failure"));
      }, snapshot("Stale"));
      assert.equal(await page.locator(".item").count(), 0);
      assert.equal(await page.locator(".list-loading").isVisible(), true);
      await page.evaluate(
        (value) => window.sessions[1].fn(value),
        snapshot("Recovered"),
      );
      await page
        .getByRole("textbox", { name: "Edit Recovered item", exact: true })
        .waitFor();
      assert.equal(
        await page.locator(".add input").inputValue(),
        "Retry keeps this draft",
      );
      await page.locator(".add input").fill("");
      for (const path of ["/Empty", "/Missing"]) {
        await page.goto(base + path);
        await page.waitForFunction(() => window.sessions?.length === 1);
        assert.equal(await page.locator(".empty").isVisible(), false);
        await page.evaluate(() =>
          window.sessions[0].fn({ title: "", items: [] }),
        );
        assert.equal(await page.locator(".empty").isVisible(), true);
        assert.equal(await page.locator(".add button").isDisabled(), false);
      }
      await page.goto(base + "/Earlier");
      await page.waitForFunction(() => window.sessions?.length === 1);
      await page.goto(base + "/Newer");
      await page.waitForFunction(() => window.sessions?.length === 1);
      assert.equal(await page.locator(".empty").isVisible(), false);
      assert.equal(await page.locator(".item").count(), 0);
      await page.evaluate(
        (value) => window.sessions[0].fn(value),
        snapshot("Newer"),
      );
      await page.goBack();
      await page.waitForFunction(() => window.sessions?.length === 1);
      assert.ok(page.url().endsWith("/Earlier"));
      await page.evaluate(
        (value) => window.sessions[0].fn(value),
        snapshot("Earlier"),
      );
      assert.equal(
        await page.locator(".item .name").inputValue(),
        "Earlier item",
      );
      await page.goForward();
      await page.waitForFunction(() => window.sessions?.length === 1);
      await page.evaluate(
        (value) => window.sessions[0].fn(value),
        snapshot("Newer"),
      );
      assert.equal(
        await page.locator(".item .name").inputValue(),
        "Newer item",
      );
      await page.goto(base + "/");
      await page.waitForFunction(() => window.sessions?.length === 1);
      assert.equal(await page.locator(".list-loading").isVisible(), true);
      assert.equal(await page.locator(".empty").isVisible(), false);
      await page.evaluate(
        (value) => window.sessions[0].fn(value),
        snapshot("Remembered"),
      );
      await context.clearCookies();
      for (const path of ["/", "/new"]) {
        await page.goto(base + path);
        await page.waitForFunction(() => window.sessions?.length === 1);
        assert.equal(await page.locator(".empty").isVisible(), true);
        assert.equal(await page.locator(".list-loading").isVisible(), false);
        await page.evaluate(() =>
          window.sessions[0].fn({ title: "", items: [] }),
        );
      }
      await page.clock.install();
      await page.goto(base + "/Timeout");
      await page.waitForFunction(() => window.sessions?.length === 1);
      await page.clock.fastForward(16000);
      await page
        .getByRole("button", { name: "Retry loading list", exact: true })
        .waitFor();
      assert.match(
        await page.locator(".list-load-error").textContent(),
        /longer than expected/,
      );
      assert.equal(await page.locator(".list-loading").isVisible(), false);
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth > innerWidth,
        ),
        false,
      );
      let delayedReservationRetry = false;
      if (width === 390 && reducedMotion === "reduce") {
        await page.addInitScript(() => {
          window.delayReservation = true;
        });
        await page.goto(base + "/SlowReservation");
        await page.waitForFunction(() => window.claims?.length === 1);
        assert.equal(await page.locator(".list-loading").isVisible(), true);
        await page.clock.fastForward(16000);
        await page
          .getByRole("button", { name: "Retry loading list", exact: true })
          .waitFor();
        await page.evaluate(() => {
          window.delayReservation = false;
        });
        await page
          .getByRole("button", { name: "Retry loading list", exact: true })
          .click();
        await page.waitForFunction(() => window.sessions.length === 1);
        await page.evaluate(() => window.claims[0]());
        await page.waitForTimeout(50);
        assert.equal(await page.evaluate(() => window.sessions.length), 1);
        await page.evaluate(
          (value) => window.sessions[0].fn(value),
          snapshot("Latest attempt"),
        );
        assert.equal(
          await page.locator(".item .name").inputValue(),
          "Latest attempt item",
        );
        assert.ok(page.url().endsWith("/SlowReservation"));
        delayedReservationRetry = true;
      }
      results.scenarios.push({
        width,
        delayedReservationRetry,
        reducedMotion,
        slowNoLandingFlash: true,
        snapshotReveal: true,
        failureRetryDraftAndStaleCallback: true,
        emptyAndMissing: true,
        nativeBackForward: true,
        rapidNewDocumentNavigation: true,
        rootAndNewLanding: true,
        timeoutOffersRetry: true,
      });
      await context.close();
    }
  assert.equal(results.externalRequests, 0);
  await writeFile(`${out}/loading.json`, JSON.stringify(results, null, 2));
  console.log(
    JSON.stringify({ passed: true, scenarios: results.scenarios.length }),
  );
} finally {
  await browser.close();
}
