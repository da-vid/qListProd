import { readFile } from "node:fs/promises";
import {
  ImageMagick,
  initializeImageMagick,
  MagickFormat,
  MagickColors,
  MagickReadSettings,
  ResourceLimits,
  ColorSpace,
} from "@imagemagick/magick-wasm";
import { inspectJpeg, PhotoError } from "../src/photo/jpeg.ts";
let ready: Promise<void> | undefined;
export function initialize() {
  return (ready ??= (async () => {
    await initializeImageMagick(
      await readFile(
        new URL(import.meta.resolve("@imagemagick/magick-wasm/magick.wasm")),
      ),
    );
    ResourceLimits.memory = 96n * 1024n * 1024n;
    ResourceLimits.disk = 0n;
    ResourceLimits.width = 1280n;
    ResourceLimits.height = 1280n;
    ResourceLimits.area = 2097152n;
    ResourceLimits.listLength = 4n;
    ResourceLimits.maxMemoryRequest = 64n * 1024n * 1024n;
    ResourceLimits.maxProfileSize = 65536n;
  })());
}
export async function processPhoto(bytes: Uint8Array) {
  const header = inspectJpeg(bytes); // Before WASM initialization/decode; never trust file type or client dimensions.
  await initialize();
  return ImageMagick.read(MagickColors.White, 1, 1, (image) => {
    image.onWarning = () => {
      throw new PhotoError("The JPEG is damaged. Choose a different image.");
    };
    image.read(
      header.sanitized,
      new MagickReadSettings({ format: MagickFormat.Jpeg }),
    );
    if (image.width !== header.width || image.height !== header.height)
      throw new PhotoError("Invalid image dimensions.");
    image.strip();
    image.colorSpace = ColorSpace.sRGB;
    image.quality = 78;
    const full = image.write(MagickFormat.Jpeg, (data) =>
      Uint8Array.from(data),
    );
    const scale = Math.min(1, 192 / image.width, 192 / image.height);
    image.resize(
      Math.max(1, Math.round(image.width * scale)),
      Math.max(1, Math.round(image.height * scale)),
    );
    image.strip();
    image.quality = 65;
    const thumbnail = image.write(MagickFormat.Jpeg, (data) =>
      Uint8Array.from(data),
    );
    if (full.length > 384 * 1024 || thumbnail.length > 32 * 1024)
      throw new PhotoError(
        "This image is too complex for the free photo limit. Choose a smaller image.",
      );
    inspectJpeg(full);
    inspectJpeg(thumbnail, { maxEdge: 192, maxPixels: 192 * 192 });
    return { full, thumbnail, width: header.width, height: header.height };
  });
}
