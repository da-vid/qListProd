import {
  MAX_UPLOAD_BYTES,
  inspectJpeg,
  PhotoError,
} from "../src/photo/jpeg.ts";
// Future gateway boundary: call only after atomic quota/admission reservation.
export async function readJpegUpload(request: Request, timeoutMs = 5000) {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0)
    throw new PhotoError("Invalid upload timeout.");
  if (
    request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !==
    "image/jpeg"
  )
    throw new PhotoError("JPEG content type required.");
  const encoding = request.headers.get("content-encoding");
  if (encoding && encoding.toLowerCase() !== "identity")
    throw new PhotoError("Compressed upload bodies are unsupported.");
  const length = request.headers.get("content-length");
  if (
    length !== null &&
    (!/^\d+$/.test(length) ||
      !Number.isSafeInteger(Number(length)) ||
      Number(length) <= 0 ||
      Number(length) > MAX_UPLOAD_BYTES)
  )
    throw new PhotoError(
      "Upload exceeds the photo limit or has an invalid length.",
    );
  if (!request.body) throw new PhotoError("JPEG body required.");
  request.signal.throwIfAborted();
  const reader = request.body.getReader(),
    buffer = new Uint8Array(MAX_UPLOAD_BYTES);
  let size = 0,
    chunks = 0,
    complete = false,
    rejectStop!: (reason: unknown) => void;
  const stopped = new Promise<never>((_, reject) => {
    rejectStop = reject;
  });
  const stop = (reason: unknown) => {
    rejectStop(reason);
    void reader.cancel().catch(() => {});
  };
  const abort = () => stop(new PhotoError("Upload cancelled."));
  const timer = setTimeout(
    () => stop(new PhotoError("Upload timed out.")),
    timeoutMs,
  );
  request.signal.addEventListener("abort", abort, { once: true });
  try {
    while (true) {
      const { value, done } = await Promise.race([reader.read(), stopped]);
      if (done) {
        complete = true;
        break;
      }
      if (!value.byteLength || ++chunks > 2048)
        throw new PhotoError("Upload has too many or empty chunks.");
      if (size + value.byteLength > MAX_UPLOAD_BYTES)
        throw new PhotoError("Upload exceeds the photo limit.");
      buffer.set(value, size);
      size += value.byteLength;
    }
    if (length !== null && Number(length) !== size)
      throw new PhotoError("Upload length does not match its body.");
    const bytes = buffer.slice(0, size);
    inspectJpeg(bytes);
    return bytes;
  } finally {
    clearTimeout(timer);
    request.signal.removeEventListener("abort", abort);
    if (!complete) void reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
