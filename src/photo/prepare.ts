import { inspectJpeg, MAX_EDGE, PhotoError } from "./jpeg.ts";
import { FULL_LIMIT, THUMB_LIMIT, type PreparedPhoto } from "./adapter.ts";
function encode(canvas: HTMLCanvasElement, quality: number) {
  return new Promise<Blob>((resolve, reject) =>
    canvas.toBlob(
      (blob) =>
        blob
          ? resolve(blob)
          : reject(new PhotoError("This browser could not prepare the photo.")),
      "image/jpeg",
      quality,
    ),
  );
}
export async function preparePhoto(file: Blob): Promise<PreparedPhoto> {
  if (file.size > 10 * 1024 * 1024)
    throw new PhotoError("Choose a JPEG smaller than 10 MiB.");
  // Bound decoded dimensions before asking the browser to allocate pixels. Keep EXIF for orientation only here.
  inspectJpeg(new Uint8Array(await file.arrayBuffer()), {
    maxBytes: 10 * 1024 * 1024,
    maxEdge: 8192,
    maxPixels: 24_000_000,
    baselineOnly: false,
  });
  const bitmap = await createImageBitmap(file, {
    imageOrientation: "from-image",
  });
  try {
    const canvas = document.createElement("canvas"),
      ratio = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
    canvas.width = Math.max(1, Math.round(bitmap.width * ratio));
    canvas.height = Math.max(1, Math.round(bitmap.height * ratio));
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new PhotoError("Photo preparation is unavailable.");
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    let full = await encode(canvas, 0.78);
    for (const quality of [0.65, 0.5, 0.35]) {
      if (full.size <= FULL_LIMIT) break;
      full = await encode(canvas, quality);
    }
    if (full.size > FULL_LIMIT)
      throw new PhotoError(
        "This photo is too complex. Choose a smaller photo.",
      );
    const thumb = document.createElement("canvas"),
      scale = Math.min(1, 192 / Math.max(canvas.width, canvas.height));
    thumb.width = Math.max(1, Math.round(canvas.width * scale));
    thumb.height = Math.max(1, Math.round(canvas.height * scale));
    const thumbCtx = thumb.getContext("2d");
    if (!thumbCtx)
      throw new PhotoError("Thumbnail preparation is unavailable.");
    thumbCtx.drawImage(canvas, 0, 0, thumb.width, thumb.height);
    const thumbnail = await encode(thumb, 0.65);
    if (thumbnail.size > THUMB_LIMIT)
      throw new PhotoError("Thumbnail exceeds the free size limit.");
    return { full, thumbnail };
  } finally {
    bitmap.close();
  }
}
