import decoderFactory from "@jsquash/jpeg/codec/dec/mozjpeg_dec.js";
import encoderFactory from "@jsquash/jpeg/codec/enc/mozjpeg_enc.js";
import { defaultOptions } from "@jsquash/jpeg/meta.js";
import { inspectJpeg, PhotoError } from "../src/photo/jpeg.ts";

type Pixels = { data: Uint8ClampedArray; width: number; height: number };
// Deno Edge has no browser canvas/ImageData. The decoder only needs this data container.
if (!(globalThis as any).ImageData)
  (globalThis as any).ImageData = class {
    data: Uint8ClampedArray;
    width: number;
    height: number;
    constructor(data: Uint8ClampedArray, width: number, height: number) {
      this.data = data;
      this.width = width;
      this.height = height;
    }
  };
export async function createSmallProcessor(
  decoderBytes: Uint8Array,
  encoderBytes: Uint8Array,
) {
  const [decoderModule, encoderModule] = await Promise.all([
    WebAssembly.compile(decoderBytes),
    WebAssembly.compile(encoderBytes),
  ]);
  let busy = false;
  const instantiate =
    (module: WebAssembly.Module) =>
    (
      imports: WebAssembly.Imports,
      done: (instance: WebAssembly.Instance) => void,
    ) => {
      const instance = new WebAssembly.Instance(module, imports);
      done(instance);
      return instance.exports;
    };
  return async function processSmall(bytes: Uint8Array) {
    const header = inspectJpeg(bytes);
    if (busy) throw new PhotoError("Photo processor is busy.");
    busy = true;
    try {
      let warning = false;
      // Fresh native heaps prevent a failed decoder call from poisoning later requests.
      const decoder = await decoderFactory({
        noInitialRun: true,
        instantiateWasm: instantiate(decoderModule),
        printErr: () => {
          warning = true;
        },
      });
      let pixels: Pixels;
      try {
        pixels = decoder.decode(header.sanitized, false);
      } catch {
        throw new PhotoError("The JPEG is damaged.");
      }
      if (
        warning ||
        !pixels ||
        pixels.width !== header.width ||
        pixels.height !== header.height ||
        pixels.data.length !== header.width * header.height * 4
      )
        throw new PhotoError("The JPEG is damaged.");
      const encoder = await encoderFactory({
        noInitialRun: true,
        instantiateWasm: instantiate(encoderModule),
        printErr: () => {
          warning = true;
        },
      });
      const encode = (p: Pixels, quality: number) =>
        Uint8Array.from(
          encoder.encode(p.data, p.width, p.height, {
            ...defaultOptions,
            quality,
            baseline: true,
            progressive: false,
            arithmetic: false,
          }),
        );
      const full = encode(pixels, 78);
      const scale = Math.min(1, 192 / pixels.width, 192 / pixels.height);
      const width = Math.max(1, Math.round(pixels.width * scale)),
        height = Math.max(1, Math.round(pixels.height * scale));
      const data = new Uint8ClampedArray(width * height * 4);
      // Area-average the bounded source; total source samples remain bounded by input pixels.
      for (let y = 0; y < height; y++)
        for (let x = 0; x < width; x++) {
          const x0 = Math.floor((x * pixels.width) / width),
            x1 = Math.floor(((x + 1) * pixels.width) / width);
          const y0 = Math.floor((y * pixels.height) / height),
            y1 = Math.floor(((y + 1) * pixels.height) / height);
          const n = (x1 - x0) * (y1 - y0),
            dst = (y * width + x) * 4;
          for (let c = 0; c < 3; c++) {
            let sum = 0;
            for (let sy = y0; sy < y1; sy++)
              for (let sx = x0; sx < x1; sx++)
                sum += pixels.data[(sy * pixels.width + sx) * 4 + c];
            data[dst + c] = Math.round(sum / n);
          }
          data[dst + 3] = 255;
        }
      const thumbnail = encode({ data, width, height }, 65);
      if (warning) throw new PhotoError("The JPEG is damaged.");
      if (full.length > 384 * 1024 || thumbnail.length > 32 * 1024)
        throw new PhotoError(
          "This image is too complex for the free photo limit.",
        );
      // Strip encoder-added APP/comment fields too; return only a fresh pixel encoding.
      return {
        full: inspectJpeg(full).sanitized,
        thumbnail: inspectJpeg(thumbnail, { maxBytes: 32 * 1024, maxEdge: 192 })
          .sanitized,
        width: pixels.width,
        height: pixels.height,
      };
    } finally {
      busy = false;
    }
  };
}
