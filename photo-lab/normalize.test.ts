import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  inspectSource,
  HEIC_HELP,
  SOURCE_BYTES,
  normalizePhoto,
} from "../src/photo/normalize.ts";
const source = new Uint8Array(
  await readFile(
    new URL("./fixtures/browser/orientation-6.jpg", import.meta.url),
  ),
);
test("source JPEG accepts orientation metadata before decode and enforces actual header dimensions", () => {
  const parsed = inspectSource(source, "", "photo.jpg");
  assert.equal(parsed.width, 320);
  assert.equal(parsed.height, 240);
  assert(parsed.sanitized.length < source.length);
  const bomb = source.slice(),
    frame = bomb.findIndex((x, i) => x === 255 && bomb[i + 1] === 192);
  assert(frame > 0);
  bomb[frame + 5] = 0x20;
  bomb[frame + 6] = 0x01;
  assert.throws(() => inspectSource(bomb), /damaged or too large/);
});
test("HEIC hints and actual container header produce helpful rejection without claiming decode support", async () => {
  const header = new Uint8Array(
    await readFile(
      new URL("./fixtures/browser/unsupported.heic", import.meta.url),
    ),
  );
  for (const [bytes, type, name] of [
    [header, "", "unknown"],
    [new Uint8Array([1]), "image/heic", ""],
    [new Uint8Array([1]), "", "PHONE.HEIF"],
  ] as const) {
    assert.throws(
      () => inspectSource(bytes, type, name),
      (e) => e instanceof Error && e.message === HEIC_HELP,
    );
  }
  // File MIME/name never override actual valid JPEG bytes.
  assert.equal(inspectSource(source, "image/heic", "wrong.heic").width, 320);
  assert.throws(
    () => inspectSource(new Uint8Array([137, 80, 78, 71])),
    /Choose a JPEG/,
  );
});
test("oversized source and pre-aborted selection stop before browser allocation", async () => {
  await assert.rejects(
    () => normalizePhoto(new Blob([new Uint8Array(SOURCE_BYTES + 1)])),
    /smaller than 10 MiB/,
  );
  await assert.rejects(() =>
    normalizePhoto(new Blob([source]), AbortSignal.abort()),
  );
});
test("progressive source is accepted only by source validation; normalized wire contract remains baseline", async () => {
  const bytes = new Uint8Array(
    await readFile(
      new URL("./fixtures/browser/progressive.jpg", import.meta.url),
    ),
  );
  assert.equal(inspectSource(bytes).width, 320);
  const { inspectJpeg } = await import("../src/photo/jpeg.ts");
  assert.throws(() => inspectJpeg(bytes));
});
