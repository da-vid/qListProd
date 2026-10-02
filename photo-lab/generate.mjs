import { readFile, writeFile, mkdir } from "node:fs/promises";
import {
  ImageMagick,
  initializeImageMagick,
  MagickFormat,
} from "@imagemagick/magick-wasm";
await initializeImageMagick(
  await readFile(
    new URL(import.meta.resolve("@imagemagick/magick-wasm/magick.wasm")),
  ),
);
await mkdir("photo-lab/fixtures", { recursive: true });
for (const [name, width, height, noisy] of [
  ["gradient", 1280, 960, false],
  ["noise", 1280, 1280, true],
  ["portrait", 720, 1280, false],
]) {
  const ppm = new Uint8Array(width * height * 3);
  let rng = 123456789;
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 3;
      rng = (Math.imul(rng, 1664525) + 1013904223) >>> 0;
      ppm[i] = noisy ? rng & 255 : Math.round((x / width) * 255);
      ppm[i + 1] = noisy ? (rng >>> 8) & 255 : Math.round((y / height) * 255);
      ppm[i + 2] = noisy ? (rng >>> 16) & 255 : 100;
    }
  const head = new TextEncoder().encode(`P6\n${width} ${height}\n255\n`),
    raw = new Uint8Array(head.length + ppm.length);
  raw.set(head);
  raw.set(ppm, head.length);
  const jpg = ImageMagick.read(raw, MagickFormat.Ppm, (img) => {
    img.quality = noisy ? 30 : 80;
    img.strip();
    return img.write(MagickFormat.Jpeg, (b) => Uint8Array.from(b));
  });
  await writeFile(`photo-lab/fixtures/${name}.jpg`, jpg);
  console.log(
    JSON.stringify({ synthetic: name, width, height, bytes: jpg.length }),
  );
}
