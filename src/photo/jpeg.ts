export const MAX_UPLOAD_BYTES = 512 * 1024;
export const MAX_EDGE = 1280;
export class PhotoError extends Error {}
export function inspectJpeg(
  bytes: Uint8Array,
  options: {
    maxBytes?: number;
    maxEdge?: number;
    maxPixels?: number;
    baselineOnly?: boolean;
  } = {},
) {
  const {
    maxBytes = MAX_UPLOAD_BYTES,
    maxEdge = MAX_EDGE,
    maxPixels = MAX_EDGE * MAX_EDGE,
    baselineOnly = true,
  } = options;
  const fail = () => {
    throw new PhotoError("Use a valid JPEG within the photo limits.");
  };
  if (
    bytes.length < 4 ||
    bytes.length > maxBytes ||
    bytes[0] !== 255 ||
    bytes[1] !== 216
  )
    fail();
  let pos = 2,
    width = 0,
    height = 0,
    scans = 0,
    markers = 0,
    ended = false;
  const parts: Uint8Array[] = [bytes.subarray(0, 2)];
  while (pos < bytes.length) {
    if (++markers > 256 || bytes[pos] !== 255) fail();
    const begin = pos++;
    while (bytes[pos] === 255) pos++;
    const marker = bytes[pos++];
    if (marker === 217) {
      if (pos !== bytes.length || !width || !scans) fail();
      parts.push(bytes.subarray(begin, pos));
      ended = true;
      break;
    }
    if (
      ![192, 194, 196, 219, 221, 218, 254].includes(marker) &&
      !(marker >= 224 && marker <= 239)
    )
      fail();
    if (pos + 2 > bytes.length) fail();
    const length = (bytes[pos] << 8) | bytes[pos + 1],
      end = pos + length;
    if (length < 2 || end > bytes.length) fail();
    if (marker === 192 || marker === 194) {
      if (
        width ||
        (baselineOnly && marker !== 192) ||
        length < 8 ||
        bytes[pos + 2] !== 8
      )
        fail();
      height = (bytes[pos + 3] << 8) | bytes[pos + 4];
      width = (bytes[pos + 5] << 8) | bytes[pos + 6];
      const components = bytes[pos + 7];
      if (
        ![1, 3].includes(components) ||
        length !== 8 + components * 3 ||
        !width ||
        !height ||
        width > maxEdge ||
        height > maxEdge ||
        width * height > maxPixels
      )
        fail();
    }
    // Remove every APP/COM segment before native decoding, including EXIF/GPS/XMP/ICC.
    if (marker < 224 || marker > 239) {
      if (marker !== 254) parts.push(bytes.subarray(begin, end));
    }
    pos = end;
    if (marker === 218) {
      if (!width || ++scans > (baselineOnly ? 1 : 16)) fail();
      const scanStart = pos;
      while (pos < bytes.length) {
        if (bytes[pos] !== 255) {
          pos++;
          continue;
        }
        const next = bytes[pos + 1];
        if (next === 0 || (next >= 208 && next <= 215)) {
          pos += 2;
          continue;
        }
        break;
      }
      if (pos === scanStart) fail();
      parts.push(bytes.subarray(scanStart, pos));
    }
  }
  if (!ended) fail();
  const sanitized = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  for (const part of parts) {
    sanitized.set(part, offset);
    offset += part.length;
  }
  return { width, height, sanitized };
}
