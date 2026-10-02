import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { readJpegUpload } from "./upload-boundary.ts";
import { MAX_UPLOAD_BYTES, inspectJpeg } from "../src/photo/jpeg.ts";
const jpeg = await readFile(
  new URL("./fixtures/gradient.jpg", import.meta.url),
);
function padded(size: number) {
  const parts = [jpeg.subarray(0, 2)];
  let left = size - jpeg.length;
  while (left) {
    let take = Math.min(65537, left);
    if (left - take > 0 && left - take < 4) take -= 4;
    assert(take >= 4);
    const part = Buffer.alloc(take);
    part.set([255, 254, (take - 2) >> 8, (take - 2) & 255]);
    parts.push(part);
    left -= take;
  }
  return Buffer.concat([...parts, jpeg.subarray(2)]);
}
const req = (body: BodyInit, headers: Record<string, string> = {}) =>
  new Request("http://local.test", {
    method: "POST",
    body,
    headers: { "content-type": "image/jpeg", ...headers },
    duplex: "half",
  } as RequestInit);
test("streamed JPEG boundary accepts limit-1 and limit, rejects limit+1 including understated length", async () => {
  for (const n of [MAX_UPLOAD_BYTES - 1, MAX_UPLOAD_BYTES])
    assert.equal((await readJpegUpload(req(padded(n)))).length, n);
  await assert.rejects(
    readJpegUpload(req(padded(MAX_UPLOAD_BYTES + 1))),
    /limit/,
  );
  await assert.rejects(
    readJpegUpload(
      req(padded(MAX_UPLOAD_BYTES + 1), { "content-length": "8" }),
    ),
    /limit/,
  );
  await assert.rejects(
    readJpegUpload(req(jpeg, { "content-length": String(jpeg.length + 1) })),
    /does not match/,
  );
});
test("unsupported encodings, MIME spoofing, empty bodies and malformed JPEG fail closed", async () => {
  for (const headers of [
    { "content-type": "image/png" },
    { "content-encoding": "gzip" },
    { "content-length": "-1" },
    { "content-length": "NaN" },
    { "content-length": String(MAX_UPLOAD_BYTES + 1) },
  ])
    await assert.rejects(readJpegUpload(req(jpeg, headers)));
  for (const body of ["", "<svg/>", jpeg.subarray(0, -2)])
    await assert.rejects(readJpegUpload(req(body)));
});
test("dimensions at the 1280 edge are allowed; larger decoded dimensions are rejected before codec", () => {
  const frame = jpeg.findIndex((v, i) => v === 255 && jpeg[i + 1] === 192);
  for (const width of [1279, 1280, 1281]) {
    const bytes = Buffer.from(jpeg);
    bytes.writeUInt16BE(width, frame + 7);
    if (width > 1280) assert.throws(() => inspectJpeg(bytes));
    else assert.equal(inspectJpeg(bytes).width, width);
  }
});
test("a stalled upload is cancelled at its deadline without an unbounded body read", async () => {
  let cancelled = false;
  const stream = new ReadableStream<Uint8Array>({
    pull() {
      return new Promise(() => {});
    },
    cancel() {
      cancelled = true;
    },
  });
  await assert.rejects(readJpegUpload(req(stream), 15), /timed out/);
  assert.equal(cancelled, true);
});

test("empty and excessive chunk streams terminate without waiting for the deadline", async () => {
  for (const chunkSize of [0, 1]) {
    let chunks = 0,
      cancelled = false;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        chunks++;
        controller.enqueue(new Uint8Array(chunkSize));
      },
      cancel() {
        cancelled = true;
      },
    });
    await assert.rejects(readJpegUpload(req(stream)), /chunks/);
    assert.ok(chunks <= 2050);
    assert.equal(cancelled, true);
  }
});
