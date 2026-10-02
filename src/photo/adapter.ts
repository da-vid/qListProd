import { inspectJpeg, PhotoError } from "./jpeg.ts";
export const FULL_LIMIT = 384 * 1024,
  THUMB_LIMIT = 32 * 1024;
export type PreparedPhoto = { full: Blob; thumbnail: Blob };
export type PhotoRecord = PreparedPhoto & { version: number };
export interface PhotoAdapter {
  get(key: string, signal: AbortSignal): Promise<PhotoRecord | undefined>;
  put(
    key: string,
    expected: number | null,
    photo: PreparedPhoto,
    signal: AbortSignal,
  ): Promise<PhotoRecord>;
  remove(key: string, expected: number, signal: AbortSignal): Promise<void>;
  // Permanent fence for a deleted text-item key, including uploads not committed yet.
  deleteItem(key: string, signal: AbortSignal): Promise<void>;
}
export type Fault =
  | "healthy"
  | "offline"
  | "paused"
  | "quota"
  | "rate"
  | "forbidden"
  | "server"
  | "timeout";
// Executable local model only. Real quota enforcement must be a database transaction.
export class MockPhotos implements PhotoAdapter {
  fault: Fault = "healthy";
  cleanupFails = false;
  used = 0;
  reserved = 0;
  garbage: PreparedPhoto[] = [];
  records = new Map<string, PhotoRecord>();
  private revision = 0;
  private active = new Set<string>();
  private deletedItems = new Set<string>();
  readonly capacity: number;
  readonly list: string;
  constructor(capacity = 2 * 1024 * 1024, list = "PhotoDemo") {
    if (!Number.isSafeInteger(capacity) || capacity < 0)
      throw new PhotoError("Invalid photo capacity.");
    this.capacity = capacity;
    this.list = list;
  }
  private async gate(signal: AbortSignal) {
    signal.throwIfAborted();
    if (this.list !== "PhotoDemo")
      throw new PhotoError("Photos are disabled for this list.");
    if (this.fault === "timeout")
      await new Promise<void>((_, reject) => {
        signal.addEventListener("abort", () => reject(signal.reason), {
          once: true,
        });
      });
    if (this.fault !== "healthy")
      throw new PhotoError(
        {
          offline: "Photos are offline.",
          paused: "The free photo service is paused.",
          quota: "The free photo limit is full.",
          rate: "Too many photo requests. Try later.",
          forbidden: "The photo service rejected this request (403).",
          server: "The photo service is unavailable (503).",
          timeout: "Photos timed out.",
        }[this.fault],
      );
  }
  async get(key: string, signal: AbortSignal) {
    await this.gate(signal);
    signal.throwIfAborted();
    return this.records.get(key);
  }
  async put(
    key: string,
    expected: number | null,
    photo: PreparedPhoto,
    signal: AbortSignal,
  ) {
    await this.gate(signal);
    signal.throwIfAborted();
    if (this.deletedItems.has(key))
      throw new PhotoError("This text item was deleted.");
    if (this.active.has(key))
      throw new PhotoError("A photo save is already in progress.");
    const bytes = photo.full.size + photo.thumbnail.size;
    if (
      !photo.full.size ||
      !photo.thumbnail.size ||
      photo.full.size > FULL_LIMIT ||
      photo.thumbnail.size > THUMB_LIMIT
    )
      throw new PhotoError("Photo exceeds the free size limit.");
    // Reservation precedes asynchronous validation; old objects continue to count during replacement.
    if (this.used + this.reserved + bytes > this.capacity)
      throw new PhotoError("The free photo limit is full.");
    this.active.add(key);
    this.reserved += bytes;
    try {
      inspectJpeg(new Uint8Array(await photo.full.arrayBuffer()), {
        maxBytes: FULL_LIMIT,
      });
      inspectJpeg(new Uint8Array(await photo.thumbnail.arrayBuffer()), {
        maxBytes: THUMB_LIMIT,
        maxEdge: 192,
      });
      signal.throwIfAborted();
      if (this.deletedItems.has(key))
        throw new PhotoError("This text item was deleted.");
      const old = this.records.get(key);
      if ((old?.version ?? null) !== expected)
        throw new PhotoError("This photo changed. Reopen it before saving.");
      const record = Object.freeze({ ...photo, version: ++this.revision });
      this.records.set(key, record);
      this.used += bytes;
      if (old) this.garbage.push(old);
      this.cleanup();
      return record;
    } finally {
      this.reserved -= bytes;
      this.active.delete(key);
    }
  }
  async remove(key: string, expected: number, signal: AbortSignal) {
    await this.gate(signal);
    signal.throwIfAborted();
    const old = this.records.get(key);
    if (!old) return;
    if (old.version !== expected)
      throw new PhotoError("This photo changed. Reopen it before removing.");
    this.records.delete(key);
    this.garbage.push(old);
    this.cleanup();
  }
  async deleteItem(key: string, signal: AbortSignal) {
    await this.gate(signal);
    signal.throwIfAborted();
    this.deletedItems.add(key);
    const old = this.records.get(key);
    if (old) {
      this.records.delete(key);
      this.garbage.push(old);
    }
    this.cleanup();
  }
  cleanup() {
    if (this.cleanupFails) return;
    for (const p of this.garbage) this.used -= p.full.size + p.thumbnail.size;
    this.garbage = [];
  }
}
export async function bounded<T>(
  action: (signal: AbortSignal) => Promise<T>,
  timeout = 5000,
  parent?: AbortSignal,
): Promise<T> {
  const controller = new AbortController();
  const abort = () =>
    controller.abort(
      parent?.reason ?? new PhotoError("Photo operation cancelled."),
    );
  parent?.addEventListener("abort", abort, { once: true });
  if (parent?.aborted) abort();
  const timer = setTimeout(
    () =>
      controller.abort(
        new PhotoError("Photos timed out. Text edits still work."),
      ),
    timeout,
  );
  let rejectAbort: (() => void) | undefined;
  try {
    return await Promise.race([
      action(controller.signal),
      new Promise<never>((_, reject) => {
        rejectAbort = () => reject(controller.signal.reason);
        controller.signal.addEventListener("abort", rejectAbort, {
          once: true,
        });
        if (controller.signal.aborted) rejectAbort();
      }),
    ]);
  } finally {
    clearTimeout(timer);
    parent?.removeEventListener("abort", abort);
    if (rejectAbort)
      controller.signal.removeEventListener("abort", rejectAbort);
  }
}
