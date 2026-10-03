import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { createSmallProcessor } from "./small-codec.ts";
import { inspectJpeg } from "../src/photo/jpeg.ts";
const bytes = (p) => readFile(new URL(p, import.meta.url));
const processPhoto = await createSmallProcessor(
  await bytes("./node_modules/@jsquash/jpeg/codec/dec/mozjpeg_dec.wasm"),
  await bytes("./node_modules/@jsquash/jpeg/codec/enc/mozjpeg_enc.wasm"),
);
const cases = [];
for (const name of [
  "progressive.jpg",
  "phone-12mp.jpg",
  "portrait-24mp.jpg",
  "detail-1280.jpg",
]) {
  const input = await bytes("./results/browser/normalized-" + name),
    header = inspectJpeg(input);
  if (name === "detail-1280.jpg") {
    await assert.rejects(
      () => processPhoto(input),
      /too complex for the free photo limit/,
    );
    cases.push({
      name,
      input_bytes: input.length,
      input_sha256: createHash("sha256").update(input).digest("hex"),
      expected_rejection:
        "Server output cap exceeded; normalized input is within the upload contract",
    });
    continue;
  }
  const output = await processPhoto(input);
  assert.equal(output.width, header.width);
  assert.equal(output.height, header.height);
  assert(output.full.length <= 393216 && output.thumbnail.length <= 32768);
  for (const b of [output.full, output.thumbnail])
    assert.equal(inspectJpeg(b).sanitized.length, b.length);
  cases.push({
    name,
    input_bytes: input.length,
    input_sha256: createHash("sha256").update(input).digest("hex"),
    full_bytes: output.full.length,
    thumbnail_bytes: output.thumbnail.length,
    width: output.width,
    height: output.height,
    metadata_stripped: true,
  });
}
const result = {
  passed: true,
  runtime: process.version,
  scope:
    "Actual browser-normalized synthetic inputs processed locally with the unchanged hosted codec; no upload",
  cases,
};
await writeFile(
  new URL("./results/browser/codec-contract.json", import.meta.url),
  JSON.stringify(result, null, 2) + "\n",
);
console.log(JSON.stringify(result, null, 2));
