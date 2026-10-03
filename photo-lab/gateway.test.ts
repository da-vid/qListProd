import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { MockPhotoGateway, type PhotoUpload } from "../src/photo/gateway.ts";
import { inspectJpeg } from "../src/photo/jpeg.ts";
const bytes = Buffer.from(
  inspectJpeg(
    new Uint8Array(
      await readFile(new URL("./fixtures/clean-full.jpg", import.meta.url)),
    ),
  ).sanitized,
);
const pair = {
  full: new Blob([bytes]),
  thumbnail: new Blob([
    await readFile(new URL("./fixtures/clean-thumbnail.jpg", import.meta.url)),
  ]),
};
const request = (): PhotoUpload => ({
  operationId: crypto.randomUUID(),
  jpeg: new Blob([bytes], { type: "image/jpeg" }),
});
const signal = () => new AbortController().signal;
test("single-image gateway reserves before processor, creates own outputs and replays without another decode", async () => {
  let calls = 0;
  const gateway = new MockPhotoGateway(async (input) => {
    calls++;
    assert.equal(gateway.reserved, 425984);
    assert.deepEqual(input, new Uint8Array(bytes));
    return pair;
  });
  const upload = request(),
    first = await gateway.put("item", null, upload, signal());
  assert.equal(
    (await gateway.status(upload.operationId, signal()))?.state,
    "committed",
  );
  assert.equal(await gateway.put("item", null, upload, signal()), first);
  assert.equal(calls, 1);
  assert.equal(gateway.reserved, 0);
  const next = await gateway.put("item", first.version, request(), signal());
  await gateway.put("item", null, upload, signal());
  assert.equal((await gateway.get("item", signal()))?.version, next.version);
});
test("invalid envelope, metadata, oversized and nonbaseline JPEG never reach the mock processor", async () => {
  let calls = 0;
  const gateway = new MockPhotoGateway(async () => {
    calls++;
    return pair;
  });
  const metadata = await readFile(
    new URL("./fixtures/browser/orientation-1.jpg", import.meta.url),
  );
  const progressive = await readFile(
    new URL("./fixtures/browser/progressive.jpg", import.meta.url),
  );
  const bad = [
    { ...request(), jpeg: new Blob([progressive], { type: "image/jpeg" }) },
    { ...request(), thumbnail: pair.thumbnail },
    {
      ...request(),
      jpeg: new Blob([new Uint8Array(524289)], { type: "image/jpeg" }),
    },
    { ...request(), jpeg: new Blob([bytes], { type: "image/png" }) },
    { ...request(), jpeg: new Blob([metadata], { type: "image/jpeg" }) },
  ];
  for (const upload of bad)
    await assert.rejects(() => gateway.put("item", null, upload, signal()));
  assert.equal(calls, 0);
  assert.equal(gateway.used, 0);
  assert.equal(gateway.reserved, 0);
});
test("changed request fingerprint, wrong list and stale version are rejected without losing the current photo", async () => {
  const gateway = new MockPhotoGateway(async () => pair),
    upload = request();
  const old = await gateway.put("item", null, upload, signal());
  await assert.rejects(
    () => gateway.put("other", null, upload, signal()),
    /request changed/,
  );
  const otherBytes = new Uint8Array(bytes);
  otherBytes[100] ^= 1;
  await assert.rejects(() =>
    gateway.put(
      "item",
      null,
      { ...upload, jpeg: new Blob([otherBytes], { type: "image/jpeg" }) },
      signal(),
    ),
  );
  await assert.rejects(
    () => gateway.put("item", null, request(), signal()),
    /changed/,
  );
  assert.equal(gateway.records.get("item"), old);
  await assert.rejects(
    () =>
      new MockPhotoGateway(async () => pair, 2 * 1024 * 1024, "Unapproved").put(
        "item",
        null,
        request(),
        signal(),
      ),
    /disabled/,
  );
});
test("concurrent last-capacity admissions and deletion during processing remain bounded", async () => {
  let release!: (value: typeof pair) => void;
  const gateway = new MockPhotoGateway(
      () => new Promise((r) => (release = r)),
      425984,
    ),
    upload = request();
  const pending = gateway.put("item", null, upload, signal());
  for (let n = 0; !release && n < 100; n++)
    await new Promise((r) => setTimeout(r, 1));
  assert(release, "processor was reached");
  await assert.rejects(
    () => gateway.put("other", null, request(), signal()),
    /full/,
  );
  await assert.rejects(
    () => gateway.put("item", null, upload, signal()),
    /still being checked/,
  );
  await gateway.deleteItem("item", signal());
  release(pair);
  await assert.rejects(() => pending, /deleted/);
  assert.equal(gateway.records.size, 0);
  assert.equal(gateway.reserved, 0);
  assert.equal(
    (await gateway.status(upload.operationId, signal()))?.state,
    "failed",
  );
});
