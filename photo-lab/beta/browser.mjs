import assert from "node:assert/strict";
import { createServer } from "node:http";
import { Readable } from "node:stream";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { fixture } from "./test-support.ts";
const { chromium } = await import(pathToFileURL(process.argv[2]));
const f = await fixture();
const serverEvents = [];
const server = createServer(async (req, res) => {
  const controller = new AbortController();
  res.on("close", () => {
    if (!res.writableEnded) controller.abort();
  });
  try {
    const request = new Request("http://127.0.0.1" + req.url, {
      method: req.method,
      headers: req.headers,
      body:
        req.method === "POST" && req.headers["content-type"]
          ? Readable.toWeb(req)
          : undefined,
      duplex: "half",
      signal: controller.signal,
    });
    const response = await f.handler(request);
    serverEvents.push({
      method: req.method,
      status: response.status,
      origin: req.headers.origin,
    });
    res.writeHead(response.status, Object.fromEntries(response.headers));
    res.end(Buffer.from(await response.arrayBuffer()));
  } catch (error) {
    serverEvents.push({ error: String(error) });
    res.writeHead(503);
    res.end("Synthetic request failed");
  }
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const endpoint = `http://127.0.0.1:${server.address().port}/photo`,
  base = "http://127.0.0.1:4174";
const browser = await chromium.launch({ channel: "chrome", headless: true });
const context = await browser.newContext({
  viewport: { width: 390, height: 844 },
  isMobile: true,
  hasTouch: true,
});
await context.grantPermissions(["local-network-access"], { origin: base });
const requests = [],
  errors = [];
const textEntry = await readFile(
  new URL("../../index.html", import.meta.url),
  "utf8",
);
await context.route("**/*", (route) => {
  const url = new URL(route.request().url());
  // The existing main.ts canonicalizes to /PhotoDemo. Keep reloads on the text entry,
  // so the separate in-memory demo never installs a second photo UI.
  if (route.request().resourceType() === "document" && url.origin === base)
    return route.fulfill({
      status: 200,
      contentType: "text/html",
      body: textEntry,
    });
  return url.hostname === "127.0.0.1" &&
    [new URL(base).port, new URL(endpoint).port].includes(url.port)
    ? route.continue()
    : route.abort();
});
const results = {
  mode: "headless Chrome phone-sized touch emulation; no physical device",
  browser: browser.version(),
  local_only: true,
  isolated_context_loopback_permission: true,
};
async function attach(page) {
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => {
    if (m.type() === "error") serverEvents.push({ browserError: m.text() });
  });
  page.on("requestfailed", (r) =>
    serverEvents.push({ requestFailure: r.failure() }),
  );
  page.on("request", (r) =>
    requests.push({ url: r.url(), method: r.method() }),
  );
  await page.goto(base + "/index.html", { waitUntil: "networkidle" });
  await page.evaluate(async (endpoint) => {
    await import("/src/photo/photo.css");
    const { cleanupJournal } = await import("/src/photo/cleanup-journal.ts");
    const { installPhotoUI } = await import("/src/photo/ui.ts"),
      { HttpPhotoGateway } = await import("/src/photo/http-gateway.ts");
    window.betaUI = installPhotoUI(
      document.querySelector("#app"),
      new HttpPhotoGateway(endpoint, "PhotoDemo"),
      {
        storage: "gateway",
        cleanupJournal: cleanupJournal(localStorage, "PhotoDemo"),
      },
    );
  }, endpoint);
}
const out = new URL("./results/", import.meta.url);
await mkdir(out, { recursive: true });
try {
  const page = await context.newPage();
  page.setDefaultTimeout(7000);
  await attach(page);
  await page.locator(".add input").fill("Synthetic beta list item");
  await page.locator(".add input").press("Enter");
  const key = await page.locator(".item").getAttribute("data-key");
  f.textItems.add(key);
  await page.getByRole("button", { name: "Add photo", exact: true }).click();
  await page
    .locator('dialog input[type="file"]')
    .last()
    .setInputFiles(
      new URL("../fixtures/browser/phone-12mp.jpg", import.meta.url).pathname,
    );
  await page.waitForFunction(() =>
    [...document.querySelectorAll("dialog button")].some(
      (b) => b.textContent === "Save photo" && !b.disabled,
    ),
  );
  await page.getByRole("button", { name: "Save photo", exact: true }).click();
  await page.locator(".photo-thumbnail").waitFor();
  await page.screenshot({
    path: new URL("http-beta-saved.png", out).pathname,
    fullPage: true,
  });
  assert.equal(f.puts, 1);
  const second = await context.newPage();
  await attach(second);
  await second.locator(".photo-thumbnail").waitFor();
  results.second_client_reads_same_photo = true;
  await page.reload({ waitUntil: "networkidle" });
  await page.evaluate(async (endpoint) => {
    await import("/src/photo/photo.css");
    const { cleanupJournal } = await import("/src/photo/cleanup-journal.ts");
    const { installPhotoUI } = await import("/src/photo/ui.ts"),
      { HttpPhotoGateway } = await import("/src/photo/http-gateway.ts");
    window.betaUI = installPhotoUI(
      document.querySelector("#app"),
      new HttpPhotoGateway(endpoint, "PhotoDemo"),
      {
        storage: "gateway",
        cleanupJournal: cleanupJournal(localStorage, "PhotoDemo"),
      },
    );
  }, endpoint);
  await page.locator(".photo-thumbnail").waitFor();
  results.reload_restores_photo = true;
  f.ledger.value.control.enabled = false;
  await page.getByRole("button", { name: "Change photo", exact: true }).click();
  // Viewing/removal remain available with uploads paused.
  await page
    .getByRole("button", { name: "Remove photo", exact: true })
    .waitFor();
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await page.locator(".item .name").fill("Text still saves with beta paused");
  await page.locator(".item .name").press("Tab");
  assert.equal(
    await page.locator(".item .name").inputValue(),
    "Text still saves with beta paused",
  );
  results.text_survives_kill_switch = true;
  await page.screenshot({
    path: new URL("http-beta-paused-text.png", out).pathname,
    fullPage: true,
  });
  f.cleanupFails = true;
  f.textItems.delete(key);
  await page.locator('.item input[type="checkbox"]').check();
  await page.locator(".delete-item").click();
  await page.getByText(/cleanup is waiting/).waitFor();
  assert.equal(f.paths.size, 1);
  // Restore the UI after text deletion while the backend remains paused.
  await attach(page);
  await page.getByText(/cleanup is waiting/).waitFor();
  results.cleanup_intent_survives_reload = true;
  f.cleanupFails = false;
  await page.evaluate(() => window.betaUI.retry());
  await page.waitForFunction(
    () => !document.querySelector(".photo-cleanup").textContent,
  );
  assert.equal(f.paths.size, 0);
  results.cleanup_retry_with_uploads_still_paused = true;
  assert.equal(await page.locator(".item").count(), 0);
  assert.deepEqual(errors, []);
  assert(requests.every((r) => new URL(r.url).hostname === "127.0.0.1"));
  results.loopback_photo_requests = requests.filter((r) =>
    r.url.startsWith(endpoint),
  ).length;
  results.external_requests = 0;
  results.hosted_uploads = 0;
  results.passed = true;
} catch (error) {
  results.failure = String(error);
  results.serverEvents = serverEvents;
  results.pages = await Promise.all(
    context.pages().map((p) => p.locator("body").innerText()),
  );
  results.state = (await f.ledger.load(new AbortController().signal)).state;
  throw error;
} finally {
  await writeFile(
    new URL("browser.json", out),
    JSON.stringify(results, null, 2) + "\n",
  );
  await browser.close();
  await new Promise((r) => server.close(r));
}
console.log(JSON.stringify(results, null, 2));
