import { readFile, writeFile, mkdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import {
  ImageMagick,
  initializeImageMagick,
  MagickFormat,
  Interlace,
} from "@imagemagick/magick-wasm";
await initializeImageMagick(
  await readFile(
    new URL(import.meta.resolve("@imagemagick/magick-wasm/magick.wasm")),
  ),
);
const dir = new URL("./fixtures/browser/", import.meta.url);
await mkdir(dir, { recursive: true });
const entries = [];
async function save(name, bytes, detail) {
  await writeFile(new URL(name, dir), bytes);
  entries.push({
    name,
    bytes: bytes.length,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    ...detail,
  });
}
function jpeg(width, height, textured = false, noise = false) {
  const head = Buffer.from(`P6\n${width} ${height}\n255\n`);
  const raw = Buffer.alloc(head.length + width * height * 3);
  head.copy(raw);
  const colors = [
    [220, 40, 30],
    [20, 200, 60],
    [30, 80, 230],
    [230, 210, 30],
  ];
  let random = 12345;
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const color =
        colors[(y >= height / 2 ? 2 : 0) + (x >= width / 2 ? 1 : 0)];
      random = (Math.imul(random, 1664525) + 1013904223) >>> 0;
      for (let c = 0; c < 3; c++)
        raw[head.length + (y * width + x) * 3 + c] = Math.max(
          0,
          Math.min(
            255,
            noise
              ? (random >>> (c * 8)) & 255
              : noise
                ? (random >>> (c * 8)) & 255
                : color[c] + (textured ? ((random >>> (c * 8)) & 63) - 31 : 0),
          ),
        );
    }
  return ImageMagick.read(raw, MagickFormat.Ppm, (img) => {
    img.quality = noise ? 98 : textured ? 78 : 92;
    img.strip();
    return img.write(MagickFormat.Jpeg, (b) => Uint8Array.from(b));
  });
}
function segment(marker, body) {
  const b = Buffer.alloc(body.length + 4);
  b.set([255, marker, (body.length + 2) >> 8, (body.length + 2) & 255]);
  b.set(body, 4);
  return b;
}
const base = jpeg(320, 240);
const progressive = ImageMagick.read(base, (img) => {
  img.settings.interlace = Interlace.Jpeg;
  return img.write(MagickFormat.Jpeg, (b) => Uint8Array.from(b));
});
await save("progressive.jpg", progressive, {
  synthetic: true,
  width: 320,
  height: 240,
  description: "Progressive JPEG source; normalization must emit baseline",
});
for (let orientation = 1; orientation <= 8; orientation++) {
  const exif = Buffer.alloc(32);
  exif.write("Exif\0\0", 0, "binary");
  exif.write("II", 6);
  exif.writeUInt16LE(42, 8);
  exif.writeUInt32LE(8, 10);
  exif.writeUInt16LE(1, 14);
  exif.writeUInt16LE(0x112, 16);
  exif.writeUInt16LE(3, 18);
  exif.writeUInt32LE(1, 20);
  exif.writeUInt16LE(orientation, 24);
  const bytes = Buffer.concat([
    Buffer.from([255, 216]),
    segment(225, exif),
    segment(254, Buffer.from("SYNTHETIC-PRIVATE-METADATA")),
    base.subarray(2),
  ]);
  await save(`orientation-${orientation}.jpg`, bytes, {
    synthetic: true,
    width: 320,
    height: 240,
    exif_orientation: orientation,
  });
}
await save("phone-12mp.jpg", jpeg(4032, 3024, true), {
  synthetic: true,
  width: 4032,
  height: 3024,
  description:
    "Deterministic textured quadrants, phone-sized source; no real photo",
});
await save("portrait-24mp.jpg", jpeg(4000, 6000, true), {
  synthetic: true,
  width: 4000,
  height: 6000,
  description:
    "Deterministic textured portrait at the source pixel ceiling; no real photo",
});
await save("detail-1280.jpg", jpeg(1280, 1280, false, true), {
  synthetic: true,
  width: 1280,
  height: 1280,
  description:
    "Deterministic full-range noise to exercise JPEG quality fallback",
});
const heic = Buffer.alloc(24);
heic.writeUInt32BE(24);
heic.write("ftypheic", 4);
heic.write("heicmif1", 16);
await save("unsupported.heic", heic, {
  synthetic: true,
  description:
    "Header-only HEIC type-detection fixture; not a decodable HEIC image",
});
await writeFile(
  new URL("manifest.json", dir),
  JSON.stringify(
    {
      generator: "generate-browser-fixtures.mjs",
      real_user_images: false,
      entries,
    },
    null,
    2,
  ) + "\n",
);
console.log(
  JSON.stringify(
    entries.map(({ name, bytes }) => ({ name, bytes })),
    null,
    2,
  ),
);
