import { inspectJpeg, PhotoError } from "./jpeg.ts";
import { FULL_LIMIT, THUMB_LIMIT, type PreparedPhoto } from "./adapter.ts";
import { encodeJpeg } from "./normalize.ts";

// Browser-only stand-in for server processing. Hosted codec remains authoritative;
// browser canvas encoders are not claimed byte-identical to the tested server codec.
export async function processMockUpload(
  bytes: Uint8Array,
  signal: AbortSignal,
): Promise<PreparedPhoto> {
  const header = inspectJpeg(bytes);
  const bitmap = await createImageBitmap(
    new Blob([Uint8Array.from(header.sanitized)], { type: "image/jpeg" }),
  );
  const fullCanvas = document.createElement("canvas"),
    thumbCanvas = document.createElement("canvas");
  try {
    signal.throwIfAborted();
    fullCanvas.width = header.width;
    fullCanvas.height = header.height;
    const ctx = fullCanvas.getContext("2d"),
      thumb = thumbCanvas.getContext("2d");
    if (!ctx || !thumb)
      throw new PhotoError("Photo preparation is unavailable.");
    ctx.drawImage(bitmap, 0, 0);
    const full = await encodeJpeg(fullCanvas, 0.78, FULL_LIMIT, signal);
    const scale = Math.min(1, 192 / Math.max(header.width, header.height));
    thumbCanvas.width = Math.max(1, Math.round(header.width * scale));
    thumbCanvas.height = Math.max(1, Math.round(header.height * scale));
    thumb.drawImage(bitmap, 0, 0, thumbCanvas.width, thumbCanvas.height);
    const thumbnail = await encodeJpeg(thumbCanvas, 0.65, THUMB_LIMIT, signal);
    if (!full || !thumbnail)
      throw new PhotoError(
        "This photo is too detailed to save. Choose a smaller JPEG copy.",
      );
    return { full, thumbnail };
  } finally {
    bitmap.close();
    fullCanvas.width =
      fullCanvas.height =
      thumbCanvas.width =
      thumbCanvas.height =
        1;
  }
}
