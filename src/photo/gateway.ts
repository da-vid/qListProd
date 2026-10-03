import {
  MockPhotos,
  type Fault,
  type PreparedPhoto,
  type PhotoRecord,
} from "./adapter.ts";
import { inspectJpeg, MAX_UPLOAD_BYTES, PhotoError } from "./jpeg.ts";

export type PhotoUpload = { operationId: string; jpeg: Blob };
export type OperationStatus = {
  state: "pending" | "committed" | "failed";
  record?: PhotoRecord;
};
export interface PhotoGateway {
  get(key: string, signal: AbortSignal): Promise<PhotoRecord | undefined>;
  put(
    key: string,
    expected: number | null,
    upload: PhotoUpload,
    signal: AbortSignal,
  ): Promise<PhotoRecord>;
  status(
    operationId: string,
    signal: AbortSignal,
  ): Promise<OperationStatus | undefined>;
  remove(key: string, expected: number, signal: AbortSignal): Promise<void>;
  deleteItem(key: string, signal: AbortSignal): Promise<void>;
}
type Operation = OperationStatus & {
  key: string;
  expected: number | null;
  hash?: string;
};
const RESERVATION = 416 * 1024;
// In-memory transport/server simulation only. No fetch, auth, credential or hosted route.
// Real upload uncertainty must retain charges in the durable server ledger.
export class MockPhotoGateway implements PhotoGateway {
  private store: MockPhotos;
  private process: (
    bytes: Uint8Array,
    signal: AbortSignal,
  ) => Promise<PreparedPhoto>;
  private operations = new Map<string, Operation>();
  private pending = new Set<string>();
  private deleted = new Set<string>();
  constructor(
    process: (bytes: Uint8Array, signal: AbortSignal) => Promise<PreparedPhoto>,
    capacity = 2 * 1024 * 1024,
    list = "PhotoDemo",
  ) {
    this.store = new MockPhotos(capacity, list);
    this.process = process;
  }
  get records() {
    return this.store.records;
  }
  get used() {
    return this.store.used;
  }
  get reserved() {
    return this.pending.size * RESERVATION;
  }
  get fault() {
    return this.store.fault;
  }
  set fault(value: Fault) {
    this.store.fault = value;
  }
  get cleanupFails() {
    return this.store.cleanupFails;
  }
  set cleanupFails(value: boolean) {
    this.store.cleanupFails = value;
  }
  get(key: string, signal: AbortSignal) {
    return this.store.get(key, signal);
  }
  async status(id: string, signal: AbortSignal) {
    await this.store.get("status", signal);
    const op = this.operations.get(id);
    return op ? { state: op.state, record: op.record } : undefined;
  }
  async put(
    key: string,
    expected: number | null,
    upload: PhotoUpload,
    signal: AbortSignal,
  ) {
    await this.store.get(key, signal); // Existing local fault/list simulation before processing.
    if (
      !upload ||
      Object.keys(upload).sort().join(",") !== "jpeg,operationId" ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        upload.operationId,
      ) ||
      !key ||
      key.length > 128 ||
      (expected !== null &&
        (!Number.isSafeInteger(expected) || expected < 1)) ||
      !(upload.jpeg instanceof Blob) ||
      upload.jpeg.type !== "image/jpeg" ||
      !upload.jpeg.size ||
      upload.jpeg.size > MAX_UPLOAD_BYTES
    )
      throw new PhotoError("Invalid photo upload. Prepare the JPEG again.");
    const { operationId, jpeg } = upload;
    const old = this.operations.get(operationId);
    if (old?.state === "pending")
      throw new PhotoError(
        "This save is still being checked. Retry after its status is known.",
      );
    if (old && (old.key !== key || old.expected !== expected))
      throw new PhotoError(
        "This save request changed. Choose the photo again.",
      );
    if (old?.state === "failed")
      throw new PhotoError(
        "This save failed. Choose the photo again before retrying.",
      );
    if (!old) {
      if (this.deleted.has(key))
        throw new PhotoError("This text item was deleted.");
      if (
        this.operations.size >= 100 ||
        this.deleted.size >= 100 ||
        this.pending.size >= 2 ||
        this.used + this.reserved + RESERVATION > this.store.capacity
      )
        throw new PhotoError(
          "The local photo limit is full. Text edits still work.",
        );
      this.operations.set(operationId, { key, expected, state: "pending" });
      this.pending.add(operationId);
    }
    const op = this.operations.get(operationId)!;
    try {
      const bytes = new Uint8Array(await jpeg.arrayBuffer());
      signal.throwIfAborted();
      const parsed = inspectJpeg(bytes);
      if (parsed.sanitized.length !== bytes.length)
        throw new PhotoError("Prepare the photo again to remove its metadata.");
      const hash = Array.from(
        new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)),
      )
        .map((x) => x.toString(16).padStart(2, "0"))
        .join("");
      signal.throwIfAborted();
      if (old) {
        if (old.hash !== hash)
          throw new PhotoError(
            "This save request changed. Choose the photo again.",
          );
        return old.record!; // Historical replay never restores an old current record.
      }
      op.hash = hash;
      const pair = await this.process(Uint8Array.from(bytes), signal);
      signal.throwIfAborted();
      if (this.deleted.has(key))
        throw new PhotoError("This text item was deleted.");
      const record = await this.store.put(key, expected, pair, signal);
      op.state = "committed";
      op.record = record;
      return record;
    } catch (error) {
      if (!old) op.state = "failed";
      throw error;
    } finally {
      if (!old) this.pending.delete(operationId);
    }
  }
  remove(key: string, expected: number, signal: AbortSignal) {
    return this.store.remove(key, expected, signal);
  }
  async deleteItem(key: string, signal: AbortSignal) {
    await this.store.get(key, signal);
    if (!this.deleted.has(key) && this.deleted.size >= 100)
      throw new PhotoError("The local cleanup limit is full.");
    this.deleted.add(key);
    return this.store.deleteItem(key, signal);
  }
}
