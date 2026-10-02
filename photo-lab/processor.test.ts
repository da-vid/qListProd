import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { inspectJpeg, MAX_UPLOAD_BYTES } from "../src/photo/jpeg.ts";
import { processPhoto } from "./processor.ts";
const original = new Uint8Array(
  await readFile(new URL("./fixtures/gradient.jpg", import.meta.url)),
);
function segment(marker: number, text: string) {
  const body = new TextEncoder().encode(text),
    s = new Uint8Array(body.length + 4);
  s.set([255, marker, (body.length + 2) >> 8, (body.length + 2) & 255]);
  s.set(body, 4);
  return s;
}
function inject(...parts: Uint8Array[]) {
  return Uint8Array.from([
    255,
    216,
    ...parts.flatMap((p) => [...p]),
    ...original.subarray(2),
  ]);
}
test("server strips metadata and generates bounded independent JPEG outputs", async () => {
  const input = inject(
    segment(225, "Exif\0\0SYNTHETIC-GPS-PRIVATE"),
    segment(225, "http://ns.adobe.com/xap/1.0/\0SYNTHETIC-XMP"),
    segment(226, "ICC_PROFILE\0SYNTHETIC"),
    segment(254, "SYNTHETIC-COMMENT"),
  );
  const result = await processPhoto(input);
  assert.deepEqual([result.width, result.height], [1280, 960]);
  for (const bytes of [result.full, result.thumbnail]) {
    const raw = Buffer.from(bytes).toString("latin1");
    assert(!/SYNTHETIC|Exif|ICC_PROFILE|adobe.com/.test(raw));
    inspectJpeg(bytes);
  }
  const thumb = inspectJpeg(result.thumbnail);
  assert(thumb.width <= 192 && thumb.height <= 192);
  assert(result.full.length <= 384 * 1024);
  assert(result.thumbnail.length <= 32 * 1024);
});
test("rejects wrong format, oversized, truncated, trailing and malformed segments before decode", async () => {
  const malformed = inject(Uint8Array.of(255, 225, 255, 255));
  for (const bytes of [
    new Uint8Array(),
    new TextEncoder().encode('<svg onload="bad"/>'),
    new Uint8Array(MAX_UPLOAD_BYTES + 1),
    original.subarray(0, -2),
    Uint8Array.from([...original, 0]),
    malformed,
  ])
    await assert.rejects(processPhoto(bytes));
});
test("rejects decompression-bomb dimensions and unsupported components before decoder", () => {
  const start = original.findIndex(
    (v, i) => v === 255 && original[i + 1] === 192,
  );
  assert(start > 0);
  for (const [offset, value] of [
    [5, 255],
    [7, 255],
    [9, 4],
  ] as const) {
    const bytes = original.slice();
    bytes[start + offset] = value;
    assert.throws(() => inspectJpeg(bytes));
  }
});
test("rejects corrupted entropy even if valid-size headers and EOI remain", async () => {
  const start = original.findIndex(
    (v, i) => v === 255 && original[i + 1] === 218,
  );
  assert(start > 0);
  const end = start + 2 + ((original[start + 2] << 8) | original[start + 3]);
  const corrupt = Uint8Array.from([
    ...original.subarray(0, end),
    1,
    2,
    3,
    255,
    217,
  ]);
  await assert.rejects(processPhoto(corrupt));
});
test("complex noisy input fails closed instead of exceeding storage allowance", async () => {
  const noise = new Uint8Array(
    await readFile(new URL("./fixtures/noise.jpg", import.meta.url)),
  );
  await assert.rejects(processPhoto(noise), /too complex/);
});
test("JPEG parser terminates on bounded deterministic malformed inputs", () => {
  let seed = 12;
  for (let n = 0; n < 300; n++) {
    const bytes = new Uint8Array(20 + n);
    for (let i = 0; i < bytes.length; i++) {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      bytes[i] = seed & 255;
    }
    bytes[0] = 255;
    bytes[1] = 216;
    assert.throws(() => inspectJpeg(bytes));
  }
});
