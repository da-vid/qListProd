import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  MockPhotos,
  FULL_LIMIT,
  THUMB_LIMIT,
  bounded,
  type PreparedPhoto,
} from "../src/photo/adapter.ts";
const photo: PreparedPhoto = {
  full: new Blob([
    await readFile(new URL("./fixtures/clean-full.jpg", import.meta.url)),
  ]),
  thumbnail: new Blob([
    await readFile(new URL("./fixtures/clean-thumbnail.jpg", import.meta.url)),
  ]),
};
const bytes = photo.full.size + photo.thumbnail.size;
const signal = () => new AbortController().signal;
test("concurrent reservations cannot spend the same remaining capacity", async () => {
  const mock = new MockPhotos(bytes);
  const results = await Promise.allSettled([
    mock.put("one", null, photo, signal()),
    mock.put("two", null, photo, signal()),
  ]);
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
  assert.equal(mock.used, bytes);
  assert.equal(mock.reserved, 0);
  assert.equal(mock.records.size, 1);
});
test("replacement keeps the old photo until success; failed cleanup keeps bytes counted", async () => {
  const mock = new MockPhotos(bytes * 3);
  const old = await mock.put("item", null, photo, signal());
  mock.fault = "offline";
  await assert.rejects(
    mock.put("item", old.version, photo, signal()),
    /offline/,
  );
  assert.equal(mock.records.get("item"), old);
  mock.fault = "healthy";
  mock.cleanupFails = true;
  const replacement = await mock.put("item", old.version, photo, signal());
  assert.notEqual(replacement.version, old.version);
  assert.equal(mock.used, bytes * 2);
  await mock.remove("item", replacement.version, signal());
  assert.equal(mock.used, bytes * 2);
  mock.cleanupFails = false;
  mock.cleanup();
  assert.equal(mock.used, 0);
});
test("compare-and-swap rejects stale replacement/removal without losing the current photo", async () => {
  const mock = new MockPhotos();
  const old = await mock.put("item", null, photo, signal());
  const current = await mock.put("item", old.version, photo, signal());
  await assert.rejects(
    mock.put("item", old.version, photo, signal()),
    /changed/,
  );
  await assert.rejects(mock.remove("item", old.version, signal()), /changed/);
  assert.equal(mock.records.get("item"), current);
  assert.equal(mock.used, bytes);
  assert.equal(mock.reserved, 0);
});
test("invalid image and cancellation release reservations without committing", async () => {
  const mock = new MockPhotos();
  await assert.rejects(
    mock.put("item", null, { ...photo, full: new Blob(["invalid"]) }, signal()),
  );
  const controller = new AbortController();
  const pending = mock.put("item", null, photo, controller.signal);
  controller.abort();
  await assert.rejects(pending);
  assert.equal(mock.reserved, 0);
  assert.equal(mock.used, 0);
  assert.equal(mock.records.size, 0);
});
test("list allowlist, quota, paused service, rate and timeout fail closed", async () => {
  await assert.rejects(
    new MockPhotos(bytes, "AnotherList").put("item", null, photo, signal()),
    /disabled/,
  );
  await assert.rejects(
    new MockPhotos(bytes - 1).put("item", null, photo, signal()),
    /full/,
  );
  for (const fault of [
    "offline",
    "paused",
    "quota",
    "rate",
    "forbidden",
    "server",
    "timeout",
  ] as const) {
    const mock = new MockPhotos();
    mock.fault = fault;
    await assert.rejects(bounded((s) => mock.put("item", null, photo, s), 15));
    assert.equal(mock.used, 0);
    assert.equal(mock.reserved, 0);
  }
});
test("timeout also bounds an adapter which ignores cancellation", async () => {
  await assert.rejects(
    bounded(() => new Promise(() => {}), 15),
    /timed out/,
  );
});
test("deletion fences an initial upload even when its caller never cancels", async () => {
  const mock = new MockPhotos();
  const raw = await photo.full.arrayBuffer();
  const full = new Blob([raw]);
  let release!: (data: ArrayBuffer) => void;
  Object.defineProperty(full, "arrayBuffer", {
    value: () =>
      new Promise<ArrayBuffer>((resolve) => {
        release = resolve;
      }),
  });
  const pending = mock.put("item", null, { ...photo, full }, signal());
  await new Promise((resolve) => setTimeout(resolve, 0));
  await mock.deleteItem("item", signal());
  release(raw);
  await assert.rejects(pending, /deleted/);
  await assert.rejects(mock.put("item", null, photo, signal()), /deleted/);
  await mock.deleteItem("item", signal());
  assert.equal(mock.records.size, 0);
  assert.equal(mock.used, 0);
  assert.equal(mock.reserved, 0);
});
test("full/thumbnail output limits reject before reading bytes and keep accounting unchanged", async () => {
  const mock = new MockPhotos();
  for (const [field, size] of [
    ["full", FULL_LIMIT + 1],
    ["thumbnail", THUMB_LIMIT + 1],
  ] as const) {
    const blob = new Blob([new Uint8Array(size)]);
    let read = false;
    Object.defineProperty(blob, "arrayBuffer", {
      value: async () => {
        read = true;
        return new ArrayBuffer(0);
      },
    });
    await assert.rejects(
      mock.put("item", null, { ...photo, [field]: blob }, signal()),
      /size limit/,
    );
    assert.equal(read, false);
  }
  assert.equal(mock.used, 0);
  assert.equal(mock.reserved, 0);
  for (const cap of [-1, NaN, Infinity, 1.5])
    assert.throws(() => new MockPhotos(cap), /capacity/);
});
test("returned photo metadata cannot be mutated to corrupt later cleanup accounting", async () => {
  const mock = new MockPhotos();
  const record = await mock.put("item", null, photo, signal());
  assert.throws(() => {
    record.full = new Blob(["different"]);
  }, TypeError);
  await mock.remove("item", record.version, signal());
  assert.equal(mock.used, 0);
});
