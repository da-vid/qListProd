import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createSmallProcessor } from "./small-codec.ts";
import { inspectJpeg } from "../src/photo/jpeg.ts";
const bytes = (path: string) => readFile(new URL(path, import.meta.url));
const processPhoto = await createSmallProcessor(
  await bytes("./node_modules/@jsquash/jpeg/codec/dec/mozjpeg_dec.wasm"),
  await bytes("./node_modules/@jsquash/jpeg/codec/enc/mozjpeg_enc.wasm"),
);
const original = await bytes("./fixtures/gradient.jpg");
test("small codec reencodes bounded pixels and strips every metadata marker", async () => {
  const text = Buffer.from("Exif\0\0SYNTHETIC-GPS-PRIVATE"),
    segment = Buffer.concat([
      Buffer.from([255, 225, 0, text.length + 2]),
      text,
    ]);
  const p = await processPhoto(
    Buffer.concat([original.subarray(0, 2), segment, original.subarray(2)]),
  );
  assert.deepEqual([p.width, p.height], [1280, 960]);
  for (const data of [p.full, p.thumbnail]) {
    inspectJpeg(data);
    assert.doesNotMatch(
      Buffer.from(data).toString("latin1"),
      /Exif|SYNTHETIC|ICC_PROFILE/,
    );
  }
  assert.ok(p.full.length <= 384 * 1024);
  const thumbnail = inspectJpeg(p.thumbnail);
  assert.ok(thumbnail.width <= 192 && thumbnail.height <= 192);
});
test("small codec rejects truncated entropy and recovers on the next valid decode", async () => {
  const scan = original.findIndex(
      (v, i) => v === 255 && original[i + 1] === 218,
    ),
    end = scan + 2 + original.readUInt16BE(scan + 2);
  await assert.rejects(
    processPhoto(
      Buffer.concat([
        original.subarray(0, end),
        Buffer.from([1, 2, 3, 255, 217]),
      ]),
    ),
    /damaged/,
  );
  assert.equal((await processPhoto(original)).width, 1280);
});
test("small codec rejects bad format, length, dimensions and trailing data before decode", async () => {
  const frame = original.findIndex(
      (v, i) => v === 255 && original[i + 1] === 192,
    ),
    large = Buffer.from(original);
  large[frame + 5] = 255;
  for (const data of [
    Buffer.from("not an image"),
    Buffer.alloc(512 * 1024 + 1),
    original.subarray(0, -2),
    Buffer.concat([original, Buffer.from([0])]),
    large,
  ])
    await assert.rejects(processPhoto(data));
});
test("small codec rejects concurrent decoding rather than sharing mutable WASM state", async () => {
  const a = processPhoto(original),
    b = processPhoto(original);
  await assert.rejects(b, /busy/);
  await a;
});
