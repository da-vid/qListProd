import assert from "node:assert/strict";
import { writeFile, mkdir } from "node:fs/promises";
import { pathToFileURL } from "node:url";
// Existing supported Playwright package is supplied explicitly; no install or existing Chrome profile.
const { chromium } = await import(pathToFileURL(process.argv[2]));
const base = "http://127.0.0.1:4174";
const out = new URL("./results/browser/", import.meta.url);
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ channel: "chrome", headless: true });
const context = await browser.newContext({
  viewport: { width: 390, height: 844 },
  isMobile: true,
  hasTouch: true,
  deviceScaleFactor: 2,
});
// Block before sending: every request in this harness must remain loopback-only GET/HEAD.
await context.route("**/*", (route) => {
  const request = route.request();
  return request.url().startsWith(base + "/") &&
    ["GET", "HEAD"].includes(request.method())
    ? route.continue()
    : route.abort();
});
const page = await context.newPage();
page.setDefaultTimeout(10000);
const errors = [],
  requests = [];
page.on("pageerror", (e) => errors.push(String(e)));
page.on("request", (r) => requests.push({ url: r.url(), method: r.method() }));
const results = {
  browser: browser.version(),
  mode: "Chromium phone-sized touch emulation; not iPhone Safari or physical device",
  orientations: [],
  network_uploads: 0,
  screenshots: [],
};
try {
  await page.goto(base + "/photos.html", { waitUntil: "networkidle" });
  const expected = [
    [0, 1, 2, 3],
    [1, 0, 3, 2],
    [3, 2, 1, 0],
    [2, 3, 0, 1],
    [0, 2, 1, 3],
    [2, 0, 3, 1],
    [3, 1, 2, 0],
    [1, 3, 0, 2],
  ];
  for (let n = 1; n <= 8; n++) {
    const image = await page.evaluate(async (n) => {
      const { normalizePhoto } = await import("/src/photo/normalize.ts");
      const { inspectJpeg } = await import("/src/photo/jpeg.ts");
      const source = await fetch(
        `/photo-lab/fixtures/browser/orientation-${n}.jpg`,
      ).then((r) => r.blob());
      const normalized = await normalizePhoto(source);
      const bytes = new Uint8Array(await normalized.jpeg.arrayBuffer()),
        parsed = inspectJpeg(bytes);
      const bitmap = await createImageBitmap(normalized.jpeg),
        canvas = document.createElement("canvas");
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(bitmap, 0, 0);
      const colors = [
        [220, 40, 30],
        [20, 200, 60],
        [30, 80, 230],
        [230, 210, 30],
      ];
      const pixels = [
        [0.2, 0.2],
        [0.8, 0.2],
        [0.2, 0.8],
        [0.8, 0.8],
      ].map(([x, y]) =>
        Array.from(
          ctx.getImageData(
            Math.floor(x * canvas.width),
            Math.floor(y * canvas.height),
            1,
            1,
          ).data,
        ).slice(0, 3),
      );
      const labels = pixels.map((p) =>
        colors
          .map((c) => c.reduce((s, v, i) => s + (v - p[i]) ** 2, 0))
          .reduce((best, v, i, a) => (v < a[best] ? i : best), 0),
      );
      bitmap.close();
      return {
        orientation: n,
        width: parsed.width,
        height: parsed.height,
        bytes: bytes.length,
        metadata_stripped: parsed.sanitized.length === bytes.length,
        labels,
        pixels,
      };
    }, n);
    assert.deepEqual(image.labels, expected[n - 1]);
    assert.deepEqual(
      [image.width, image.height],
      n < 5 ? [320, 240] : [240, 320],
    );
    assert(image.metadata_stripped);
    assert(image.bytes <= 524288);
    results.orientations.push(image);
  }
  results.phoneSource = await page.evaluate(async () => {
    const { normalizePhoto } = await import("/src/photo/normalize.ts"),
      { inspectJpeg } = await import("/src/photo/jpeg.ts");
    const source = await fetch(
      "/photo-lab/fixtures/browser/phone-12mp.jpg",
    ).then((r) => r.blob());
    const start = performance.now(),
      n = await normalizePhoto(source),
      bytes = new Uint8Array(await n.jpeg.arrayBuffer()),
      p = inspectJpeg(bytes);
    return {
      source_bytes: source.size,
      output_bytes: bytes.length,
      width: p.width,
      height: p.height,
      metadata_stripped: p.sanitized.length === bytes.length,
      elapsed_ms: performance.now() - start,
    };
  });
  assert(results.phoneSource.source_bytes > 524288);
  assert(results.phoneSource.output_bytes <= 524288);
  assert(
    Math.max(results.phoneSource.width, results.phoneSource.height) <= 1280,
  );
  assert(results.phoneSource.metadata_stripped);
  const transport = await page.evaluate(async () => {
    const { normalizePhoto } = await import("/src/photo/normalize.ts"),
      { inspectJpeg } = await import("/src/photo/jpeg.ts");
    const results = [];
    for (const name of [
      "progressive.jpg",
      "phone-12mp.jpg",
      "portrait-24mp.jpg",
      "detail-1280.jpg",
    ]) {
      const original = await fetch("/photo-lab/fixtures/browser/" + name).then(
        (r) => r.blob(),
      );
      const attempts = [];
      const nativeToBlob = HTMLCanvasElement.prototype.toBlob;
      HTMLCanvasElement.prototype.toBlob = function (callback, type, quality) {
        return nativeToBlob.call(
          this,
          (blob) => {
            attempts.push({ quality, bytes: blob?.size });
            callback(blob);
          },
          type,
          quality,
        );
      };
      try {
        const n = await normalizePhoto(original),
          bytes = new Uint8Array(await n.jpeg.arrayBuffer());
        const parsed = inspectJpeg(bytes);
        if (parsed.sanitized.length !== bytes.length)
          throw Error("Metadata remains");
        results.push({
          name,
          source_bytes: original.size,
          width: n.width,
          height: n.height,
          attempts,
          bytes: Array.from(bytes),
        });
      } finally {
        HTMLCanvasElement.prototype.toBlob = nativeToBlob;
      }
    }
    const input = await fetch(
      "/photo-lab/fixtures/browser/orientation-1.jpg",
    ).then((r) => r.blob());
    const data = await input.arrayBuffer(),
      slow = new Blob([data], { type: "image/jpeg" });
    let release;
    Object.defineProperty(slow, "arrayBuffer", {
      value: () => new Promise((r) => (release = r)),
    });
    const control = new AbortController(),
      pending = normalizePhoto(slow, control.signal).then(
        () => false,
        () => true,
      );
    control.abort();
    release(data);
    const canceled = await pending;
    const retry = await normalizePhoto(input);
    return { results, canceled, retry_bytes: retry.jpeg.size };
  });
  assert(transport.canceled && transport.retry_bytes > 0);
  results.normalized_cases = transport.results.map(({ bytes, ...item }) => ({
    ...item,
    output_bytes: bytes.length,
  }));
  for (const item of transport.results) {
    assert(item.bytes.length <= 524288);
    assert(Math.max(item.width, item.height) <= 1280);
    if (item.name === "detail-1280.jpg") assert(item.attempts.length > 1);
    if (item.name === "portrait-24mp.jpg")
      assert.deepEqual([item.width, item.height], [853, 1280]);
    await writeFile(
      new URL("normalized-" + item.name, out),
      Buffer.from(item.bytes),
    );
  }
  results.inputFailures = await page.evaluate(async () => {
    const { normalizePhoto } = await import("/src/photo/normalize.ts");
    const raw = await fetch(
      "/photo-lab/fixtures/browser/orientation-6.jpg",
    ).then((r) => r.arrayBuffer());
    const accepted = [];
    for (const type of ["", "image/png"]) {
      const n = await normalizePhoto(
        new File([raw], "mislabelled.jpg", { type }),
      );
      accepted.push({ type, width: n.width, height: n.height });
    }
    const rejected = [];
    for (const file of [
      new Blob([]),
      new Blob([new Uint8Array(10 * 1024 * 1024 + 1)]),
      new Blob([new Uint8Array([255, 216, 255, 217])]),
      new Blob(["fake JPEG"], { type: "image/jpeg" }),
    ]) {
      try {
        await normalizePhoto(file);
        throw Error("Unexpected success");
      } catch (error) {
        if (error.message === "Unexpected success") throw error;
        rejected.push(error.message);
      }
    }
    const retry = await normalizePhoto(new Blob([raw]));
    return { accepted, rejected, retry_bytes: retry.jpeg.size };
  });
  assert.equal(results.inputFailures.rejected.length, 4);
  assert.deepEqual(
    results.inputFailures.accepted.map((x) => [x.width, x.height]),
    [
      [240, 320],
      [240, 320],
    ],
  );
  results.encoderFailures = await page.evaluate(async () => {
    const { normalizePhoto } = await import("/src/photo/normalize.ts");
    const source = await fetch(
      "/photo-lab/fixtures/browser/orientation-1.jpg",
    ).then((r) => r.blob());
    const native = HTMLCanvasElement.prototype.toBlob,
      rejected = [];
    for (const output of [
      null,
      new Blob(["fallback"], { type: "image/png" }),
    ]) {
      HTMLCanvasElement.prototype.toBlob = function (callback) {
        callback(output);
      };
      try {
        await normalizePhoto(source);
        throw Error("Unexpected success");
      } catch (error) {
        if (error.message === "Unexpected success") throw error;
        rejected.push(error.message);
      } finally {
        HTMLCanvasElement.prototype.toBlob = native;
      }
    }
    const recovered = await normalizePhoto(source);
    return { rejected, retry_bytes: recovered.jpeg.size };
  });
  assert.equal(results.encoderFailures.rejected.length, 2);
  results.progressive_to_baseline = true;
  results.cancellation_recovered = true;
  await page.locator(".add input").fill("Synthetic weekend groceries");
  await page.locator(".add input").press("Enter");
  await page.getByRole("button", { name: "Add photo", exact: true }).click();
  await page
    .locator('dialog input[type="file"]')
    .last()
    .setInputFiles(
      new URL("./fixtures/browser/orientation-6.jpg", import.meta.url).pathname,
    );
  await page.getByRole("button", { name: "Save photo", exact: true }).waitFor();
  await page.waitForFunction(
    () =>
      !document.querySelector("dialog button")?.disabled &&
      document
        .querySelector('dialog [role="status"]')
        ?.textContent.includes("Preview only"),
  );
  await page.screenshot({
    path: new URL("mobile-oriented-preview.png", out).pathname,
    fullPage: true,
  });
  results.screenshots.push("mobile-oriented-preview.png");
  await page.getByRole("button", { name: "Save photo", exact: true }).click();
  await page.locator(".photo-thumbnail").waitFor();
  await page.screenshot({
    path: new URL("mobile-saved.png", out).pathname,
    fullPage: true,
  });
  results.screenshots.push("mobile-saved.png");
  await page.getByRole("button", { name: "Change photo", exact: true }).click();
  await page.waitForFunction(
    () => document.querySelector("dialog img")?.naturalWidth > 0,
  );
  results.saved_dimensions = await page
    .locator("dialog img")
    .evaluate((img) => ({
      natural: [img.naturalWidth, img.naturalHeight],
      rendered: [img.clientWidth, img.clientHeight],
    }));
  assert.deepEqual(results.saved_dimensions.natural, [240, 320]);
  await page
    .locator('dialog input[type="file"]')
    .last()
    .setInputFiles(
      new URL("./fixtures/browser/unsupported.heic", import.meta.url).pathname,
    );
  await page.getByText(/HEIC\/HEIF isn’t supported/).waitFor();
  assert(
    await page
      .getByRole("button", { name: "Save photo", exact: true })
      .isDisabled(),
  );
  await page.screenshot({
    path: new URL("mobile-heic-help.png", out).pathname,
    fullPage: true,
  });
  results.screenshots.push("mobile-heic-help.png");
  await page
    .locator('dialog input[type="file"]')
    .last()
    .setInputFiles(
      new URL("./fixtures/browser/orientation-6.jpg", import.meta.url).pathname,
    );
  await page.waitForFunction(() =>
    [...document.querySelectorAll("dialog button")].some(
      (b) => b.getAttribute("aria-label") === "Save photo" && !b.disabled,
    ),
  );
  results.reselection_after_heic = true;
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await page
    .locator(".item .name")
    .fill("Text still works after unsupported photo");
  await page.locator(".item .name").press("Tab");
  assert.equal(
    await page.locator(".item .name").inputValue(),
    "Text still works after unsupported photo",
  );
  await page.locator('.item input[type="checkbox"]').check();
  await page.locator(".delete-item").click();
  await page.waitForFunction(
    () => document.querySelectorAll(".item").length === 0,
  );
  assert(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  );
  const external = requests.filter(
    (r) =>
      !r.url.startsWith(base) &&
      !r.url.startsWith("data:") &&
      !r.url.startsWith("blob:"),
  );
  const uploads = requests.filter((r) => !["GET", "HEAD"].includes(r.method));
  assert.deepEqual(external, []);
  assert.deepEqual(uploads, []);
  assert.deepEqual(errors, []);
  results.request_count = requests.length;
  results.external_requests = 0;
  results.network_uploads = uploads.length;
  results.text_after_error = true;
  results.horizontal_overflow = false;
  results.passed = true;
} finally {
  await writeFile(
    new URL("results.json", out),
    JSON.stringify(results, null, 2) + "\n",
  );
  await browser.close();
}
console.log(JSON.stringify(results, null, 2));
