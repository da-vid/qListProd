import type { PhotoGateway, PhotoUpload, OperationStatus } from "./gateway.ts";
import type { PhotoRecord } from "./adapter.ts";
import { inspectJpeg, PhotoError } from "./jpeg.ts";
// Used only by the isolated beta harness. No public client import or runtime URL override.
export class HttpPhotoGateway implements PhotoGateway {
  private operations = new Map<string, string>();
  readonly endpoint: string;
  readonly list: string;
  readonly fetcher: typeof fetch;
  constructor(endpoint: string, list: string, fetcher: typeof fetch = fetch) {
    const url = new URL(endpoint);
    if (
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      !(
        url.origin === "https://qmpdinzendwpkqhtqskz.supabase.co" ||
        (url.protocol === "http:" && url.hostname === "127.0.0.1")
      )
    )
      throw new PhotoError("Invalid photo service.");
    this.endpoint = endpoint;
    this.list = list;
    this.fetcher = (input, init) => fetcher(input, init);
  }
  private async call(
    action: string,
    item: string,
    id: string,
    signal: AbortSignal,
    jpeg?: Blob,
  ): Promise<any> {
    const url = new URL(this.endpoint);
    url.search = new URLSearchParams({
      action,
      list: this.list,
      item,
      id,
    }).toString();
    const response = await this.fetcher(url, {
      method: "POST",
      credentials: "omit",
      cache: "no-store",
      redirect: "error",
      headers: jpeg ? { "Content-Type": "image/jpeg" } : {},
      body: jpeg,
      signal,
    });
    if (!response.body) throw new PhotoError("Photo response missing.");
    const reader = response.body.getReader();
    let size = 0;
    const chunks: Uint8Array[] = [];
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        size += value.length;
        if (size > 600000) throw new PhotoError("Photo response too large.");
        chunks.push(value);
      }
    } finally {
      await reader.cancel().catch(() => {});
      reader.releaseLock();
    }
    const data = new Uint8Array(size);
    let at = 0;
    for (const c of chunks) {
      data.set(c, at);
      at += c.length;
    }
    const result = JSON.parse(new TextDecoder().decode(data));
    if (!response.ok)
      throw new PhotoError(
        typeof result?.error === "string"
          ? result.error
          : "Photo service unavailable.",
      );
    return result;
  }
  async get(
    key: string,
    signal: AbortSignal,
  ): Promise<PhotoRecord | undefined> {
    const value = await this.call("get", key, "", signal);
    if (value === null) return undefined;
    if (!Number.isSafeInteger(value.version) || value.version < 1)
      throw new PhotoError("Invalid photo version.");
    const bytes = Uint8Array.from(atob(value.full), (c) => c.charCodeAt(0));
    const p = inspectJpeg(bytes, { maxBytes: 393216, maxEdge: 1280 });
    if (p.sanitized.length !== bytes.length)
      throw new PhotoError("Photo metadata validation failed.");
    const full = new Blob([bytes], { type: "image/jpeg" });
    // One stored/delivered JPEG is reused by the existing preview and expanded view.
    return { version: value.version, full, thumbnail: full };
  }

  async put(
    key: string,
    expected: number | null,
    upload: PhotoUpload,
    signal: AbortSignal,
  ) {
    this.operations.set(upload.operationId, key);
    await this.call(
      "put",
      key,
      upload.operationId + ":" + (expected ?? 0),
      signal,
      upload.jpeg,
    );
    const record = await this.get(key, signal);
    if (!record) throw new PhotoError("Photo changed after saving.");
    return record;
  }
  async status(
    id: string,
    signal: AbortSignal,
  ): Promise<OperationStatus | undefined> {
    const key = this.operations.get(id);
    if (!key) return undefined;
    const result = await this.call("status", key, id, signal);
    return result ?? undefined;
  }
  async remove(key: string, expected: number, signal: AbortSignal) {
    await this.call("remove", key, String(expected), signal);
  }
  async deleteItem(key: string, signal: AbortSignal) {
    await this.call("delete", key, "", signal);
  }
}
