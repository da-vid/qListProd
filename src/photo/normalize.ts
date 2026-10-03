import { inspectJpeg, MAX_EDGE, MAX_UPLOAD_BYTES, PhotoError } from "./jpeg.ts";

export type NormalizedPhoto = { jpeg: Blob; width: number; height: number };
export const SOURCE_BYTES = 10 * 1024 * 1024;
export const HEIC_HELP =
  "HEIC/HEIF isn’t supported here. Export or share a JPEG copy, then choose it here. Your text list is unchanged.";
let preparing = false;

export function inspectSource(bytes: Uint8Array, type = "", name = "") {
  const jpeg = bytes[0] === 255 && bytes[1] === 216;
  const header = new TextDecoder("latin1").decode(bytes.subarray(0, 64));
  if (
    !jpeg &&
    (/image\/hei[cf]/i.test(type) ||
      /\.hei[cf]$/i.test(name) ||
      (header.includes("ftyp") &&
        /heic|heix|hevc|hevx|heim|heis|mif1|msf1/.test(header)))
  )
    throw new PhotoError(HEIC_HELP);
  if (!jpeg)
    throw new PhotoError(
      "Choose a JPEG photo. Other image formats aren’t supported here.",
    );
  try {
    return inspectJpeg(bytes, {
      maxBytes: SOURCE_BYTES,
      maxEdge: 8192,
      maxPixels: 24_000_000,
      baselineOnly: false,
    });
  } catch {
    throw new PhotoError(
      "This JPEG is damaged or too large. Choose a copy under 10 MiB and 24 megapixels (maximum edge 8192). Your text list is unchanged.",
    );
  }
}

export async function encodeJpeg(
  canvas: HTMLCanvasElement,
  quality: number,
  limit: number,
  signal: AbortSignal,
) {
  signal.throwIfAborted();
  const blob = await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob(
      (value) =>
        value
          ? resolve(value)
          : reject(
              new PhotoError(
                "This browser could not prepare the photo. Try another JPEG.",
              ),
            ),
      "image/jpeg",
      quality,
    ),
  );
  signal.throwIfAborted();
  if (blob.type !== "image/jpeg")
    throw new PhotoError(
      "This browser cannot create JPEG photos. Try another browser.",
    );
  if (blob.size > limit) return undefined;
  const parsed = inspectJpeg(new Uint8Array(await blob.arrayBuffer()), {
    maxBytes: limit,
  });
  signal.throwIfAborted();
  if (parsed.width !== canvas.width || parsed.height !== canvas.height)
    throw new PhotoError("Photo dimensions changed during preparation.");
  // Canvas output still may contain APP/COM fields. Strip and validate the actual bytes.
  return new Blob([Uint8Array.from(parsed.sanitized)], { type: "image/jpeg" });
}

export async function normalizePhoto(
  file: Blob,
  signal = new AbortController().signal,
): Promise<NormalizedPhoto> {
  signal.throwIfAborted();
  if (!file.size || file.size > SOURCE_BYTES)
    throw new PhotoError(
      "Choose a JPEG smaller than 10 MiB. Your text list is unchanged.",
    );
  if (preparing)
    throw new PhotoError(
      "A photo is still being prepared. Try again in a moment.",
    );
  let bitmap: ImageBitmap | undefined;
  const canvas = document.createElement("canvas");
  preparing = true;
  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    signal.throwIfAborted();
    inspectSource(bytes, file.type, "name" in file ? String(file.name) : "");
    // Keep original EXIF until browser orientation is applied; never send this original.
    try {
      bitmap = await createImageBitmap(file, {
        imageOrientation: "from-image",
      });
    } catch {
      throw new PhotoError(
        "This browser could not open the JPEG. Export a new JPEG copy and try again.",
      );
    }
    signal.throwIfAborted();
    if (
      !bitmap.width ||
      !bitmap.height ||
      bitmap.width * bitmap.height > 24_000_000 ||
      Math.max(bitmap.width, bitmap.height) > 8192
    )
      throw new PhotoError(
        "This photo is too large to prepare safely. Choose a smaller JPEG copy.",
      );
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new PhotoError("Photo preparation is unavailable.");
    // Bounded work: one decode, at most twelve encodes, never upscale.
    for (const edge of [MAX_EDGE, 1024, 800]) {
      signal.throwIfAborted();
      const ratio = Math.min(1, edge / Math.max(bitmap.width, bitmap.height));
      canvas.width = Math.max(1, Math.round(bitmap.width * ratio));
      canvas.height = Math.max(1, Math.round(bitmap.height * ratio));
      ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      for (const quality of [0.85, 0.72, 0.58, 0.44]) {
        const jpeg = await encodeJpeg(
          canvas,
          quality,
          MAX_UPLOAD_BYTES,
          signal,
        );
        if (jpeg) return { jpeg, width: canvas.width, height: canvas.height };
      }
    }
    throw new PhotoError(
      "This photo is too detailed to fit. Choose a smaller JPEG copy.",
    );
  } finally {
    bitmap?.close();
    canvas.width = canvas.height = 1;
    preparing = false;
  }
}
