import { inspectJpeg } from "../../../src/photo/jpeg.ts";
import { readJpegUpload } from "../../upload-boundary.ts";
export const BUCKET = "qlist-photo-trial-v1";
export type Kind = "full" | "thumb";
export type Pair = {
  full: Uint8Array;
  thumbnail: Uint8Array;
  width: number;
  height: number;
};
export type Rpc = (
  action: string,
  payload: Record<string, unknown>,
  signal: AbortSignal,
) => Promise<any>;
export type Store = {
  setup: () => Promise<void>;
  put: (key: string, bytes: Uint8Array) => Promise<void>;
  read: (key: string) => Promise<ReadableStream<Uint8Array>>;
  remove: (keys: string[]) => Promise<unknown>;
  exists: (key: string) => Promise<boolean>;
};
export const digest = async (bytes: Uint8Array) =>
  Array.from(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", Uint8Array.from(bytes)),
    ),
  )
    .map((x) => x.toString(16).padStart(2, "0"))
    .join("");
const demand = (ok: unknown, message: string) => {
  if (!ok) throw new Error(message);
};
export async function bounded<T>(
  work: Promise<T>,
  signal: AbortSignal,
  ms = 7000,
): Promise<T> {
  signal.throwIfAborted();
  let stop!: () => void;
  let timer: ReturnType<typeof setTimeout>;
  const end = new Promise<never>((_, reject) => {
    stop = () => reject(new Error("aborted"));
    signal.addEventListener("abort", stop, { once: true });
    timer = setTimeout(() => reject(new Error("operation_timeout")), ms);
  });
  try {
    return await Promise.race([work, end]);
  } finally {
    clearTimeout(timer!);
    signal.removeEventListener("abort", stop);
  }
}
export class PhysicalTrial {
  owner = crypto.randomUUID();
  readonly evidence: Record<string, unknown>[] = [];
  private cache = new Map<string, Pair>();
  rpc: Rpc;
  storage: Store;
  process: (bytes: Uint8Array) => Promise<Pair>;
  fixtures: Record<string, Uint8Array>;
  signal: AbortSignal;
  timeoutMs: number;
  constructor(
    rpc: Rpc,
    storage: Store,
    process: (bytes: Uint8Array) => Promise<Pair>,
    fixtures: Record<string, Uint8Array>,
    signal: AbortSignal,
    timeoutMs = 7000,
  ) {
    this.rpc = rpc;
    this.storage = storage;
    this.process = process;
    this.fixtures = fixtures;
    this.signal = signal;
    this.timeoutMs = timeoutMs;
  }
  async call(action: string, payload: Record<string, unknown> = {}) {
    this.signal.throwIfAborted();
    const r = await bounded(
      this.rpc(action, { owner: this.owner, ...payload }, this.signal),
      this.signal,
      this.timeoutMs,
    );
    this.evidence.push({
      action,
      operation: payload.operation_id,
      phase: r.operation?.phase,
      claimed: r.claimed,
    });
    return r;
  }
  async status(id?: string) {
    return this.call("status", id ? { operation_id: id } : {});
  }
  async reserve(id: string, item: string, fixture: string, expected = 0) {
    return this.call("reserve", {
      operation_id: id,
      item_id: item,
      fixture,
      expected_version: expected,
    });
  }
  async prepare(id: string, item: string, fixture: string, expected = 0) {
    const admission = await this.reserve(id, item, fixture, expected);
    demand(admission.operation.phase === "reserved", "operation_not_fresh");
    const source = this.fixtures[fixture];
    demand(source, "unknown_fixture");
    // The reservation exists before the internal JPEG upload boundary or decoder runs.
    const request = new Request("https://synthetic.invalid", {
      method: "POST",
      headers: {
        "content-type": "image/jpeg",
        "content-length": String(source.length),
      },
      body: Uint8Array.from(source),
      signal: this.signal,
    });
    const input = await readJpegUpload(request);
    let pair = this.cache.get(fixture);
    if (!pair) {
      pair = await this.process(input);
      this.cache.set(fixture, pair);
    }
    const full = inspectJpeg(pair.full, { maxBytes: 384 * 1024 });
    const thumb = inspectJpeg(pair.thumbnail, {
      maxBytes: 32 * 1024,
      maxEdge: 192,
    });
    demand(
      full.sanitized.length === pair.full.length &&
        thumb.sanitized.length === pair.thumbnail.length,
      "metadata_not_stripped",
    );
    demand(
      full.width === pair.width && full.height === pair.height,
      "dimension_mismatch",
    );
    await this.call("plan", {
      operation_id: id,
      objects: {
        full: { bytes: pair.full.length, digest: await digest(pair.full) },
        thumb: {
          bytes: pair.thumbnail.length,
          digest: await digest(pair.thumbnail),
        },
      },
    });
    return pair;
  }
  object(state: any, kind: Kind) {
    const obj = state.objects.find((o: any) => o.kind === kind);
    demand(
      obj &&
        /^phase-b\/PhotoDemo\/phaseb-[a-z0-9-]{1,64}\/(full|thumb)\.jpg$/.test(
          obj.physical_key,
        ),
      "unsafe_storage_key",
    );
    return obj;
  }
  async write(id: string, kind: Kind, bytes: Uint8Array) {
    const before = await this.status(id),
      obj = this.object(before, kind);
    demand(
      obj.size_bytes === bytes.length && obj.digest === (await digest(bytes)),
      "write_plan_mismatch",
    );
    // Immutable key, one ever-granted write attempt. A duplicate/lost claim is not a PUT retry.
    const ticket = crypto.randomUUID();
    const claim = await this.call("write_claim", {
      operation_id: id,
      kind,
      ticket,
    });
    demand(claim.claimed, "write_already_claimed");
    try {
      await bounded(
        this.storage.put(obj.physical_key, bytes),
        this.signal,
        this.timeoutMs,
      );
    } catch (e) {
      try {
        await this.call("write_uncertain", { operation_id: id, kind, ticket });
      } catch {}
      throw e;
    }
    // Only a fulfilled upload response records settled completion. A lost DB ack stays charged.
    await this.call("write_ack", { operation_id: id, kind, ticket });
  }
  async verify(id: string, kind: Kind) {
    const ticket = crypto.randomUUID();
    const state = await this.call("read_claim", {
        operation_id: id,
        kind,
        ticket,
      }),
      obj = this.object(state, kind);
    const stream = await bounded(
        this.storage.read(obj.physical_key),
        this.signal,
        this.timeoutMs,
      ),
      reader = stream.getReader();
    const bytes = new Uint8Array(393216);
    let length = 0,
      chunks = 0;
    try {
      while (true) {
        const next = await bounded(reader.read(), this.signal, this.timeoutMs);
        if (next.done) break;
        if (
          !next.value.length ||
          ++chunks > 2048 ||
          length + next.value.length > bytes.length
        )
          throw new Error("download_limit");
        bytes.set(next.value, length);
        length += next.value.length;
      }
    } finally {
      void reader.cancel().catch(() => {});
      reader.releaseLock();
    }
    const data = bytes.slice(0, length),
      hash = await digest(data);
    demand(
      length === obj.size_bytes && hash === obj.digest,
      "stored_bytes_mismatch",
    );
    const parsed = inspectJpeg(data, {
      maxBytes: kind === "full" ? 393216 : 32768,
      maxEdge: kind === "full" ? 1280 : 192,
    });
    demand(parsed.sanitized.length === data.length, "stored_metadata");
    await this.call("verify_ack", {
      operation_id: id,
      kind,
      ticket,
      digest: hash,
    });
  }
  async upload(id: string, pair: Pair) {
    for (const [kind, bytes] of [
      ["full", pair.full],
      ["thumb", pair.thumbnail],
    ] as const) {
      await this.write(id, kind, bytes);
      await this.verify(id, kind);
    }
  }
  async commit(id: string) {
    return this.call("commit", { operation_id: id });
  }
  async cancel(id: string) {
    return this.call("cancel", { operation_id: id });
  }
  async cleanup(id: string) {
    const state = await this.call("cleanup_begin", {
      operation_id: id,
      ticket: crypto.randomUUID(),
    });
    if (state.operation.phase === "released") return state;
    const objects = state.objects;
    demand(objects.length === 2, "missing_object_records");
    demand(
      objects.every((o: any) =>
        ["unstarted", "stored"].includes(o.writer_state),
      ),
      "writer_unsettled",
    );
    const keys = objects.map(
      (o: any) => this.object(state, o.kind).physical_key,
    );
    // Storage API deletes physical objects, unlike deleting SQL metadata.
    const receipt = await bounded(
      this.storage.remove(keys),
      this.signal,
      this.timeoutMs,
    );
    for (const key of keys)
      demand(
        !(await bounded(this.storage.exists(key), this.signal, this.timeoutMs)),
        "object_still_present",
      );
    const proof = await digest(
      new TextEncoder().encode(JSON.stringify({ keys, receipt, absent: true })),
    );
    return this.call("cleanup_ack", {
      operation_id: id,
      ticket: objects[0].delete_nonce,
      receipt: proof,
    });
  }
  async reconcile() {
    const state = await this.status();
    const retained = [];
    // No new admissions, writes, upserts, key generation or cleanup of current photos.
    for (const op of state.physical_operations) {
      if (op.phase === "released") continue;
      try {
        if (["reserved", "staged"].includes(op.phase))
          await this.cancel(op.operation_id);
        await this.cleanup(op.operation_id);
      } catch {
        retained.push(op.operation_id);
      }
    }
    return { retained, state: await this.status() };
  }
  async finishCleanup() {
    const ids = ["phaseb-batch-base", "phaseb-batch-replacement"];
    const state = await this.status();
    demand(
      state.budgets.length === 2 &&
        state.budgets.every((b: any) => b.batch_state === "blocked") &&
        state.physical_operations.length === 2 &&
        state.physical_operations.every((o: any) => ids.includes(o.operation_id)),
      "cleanup_scope_mismatch",
    );
    const states = [];
    for (const [index, id] of ids.entries()) {
      const s = await this.status(id);
      demand(
        s.operation.operation_id === id &&
          s.operation.item_id === "trial-physical-replace" &&
          s.operation.fixture === (index === 0 ? "gradient" : "portrait") &&
          s.operation.was_committed &&
          s.operation.committed_version === index + 1 &&
          (index === 0 ? ["cleanup", "released"] : ["committed", "cleanup", "released"]).includes(s.operation.phase) &&
          s.objects.length === 2 &&
          s.objects.every((o: any) => ["stored", "absent"].includes(o.writer_state)),
        "cleanup_state_mismatch",
      );
      for (const kind of ["full", "thumb"] as const) this.object(s, kind);
      states.push(s);
    }
    // Fence only the exact known synthetic current version. No new admission,
    // write, batch ownership, quota reset, or optimistic physical refund.
    if (states[1].operation.phase === "committed")
      await this.call("remove", {
        item_id: "trial-physical-replace",
        expected_version: 2,
      });
    for (const id of ids) await this.cleanup(id);
    const final = await this.status();
    demand(
      final.budgets.every((b: any) =>
        b.batch_state === "blocked" && b.used_bytes === 0 &&
        b.reserved_bytes === 0 && b.pending_count === 0 && b.photo_count === 0),
      "cleanup_incomplete",
    );
    return {
      cleanup_complete: true,
      trial_complete: false,
      untested: ["partial_upload", "deletion_during_upload", "noise_rejection"],
      state: final,
    };
  }
  async run() {
    await this.call("batch_claim");
    try {
      await bounded(this.storage.setup(), this.signal, this.timeoutMs);
      const base = "phaseb-batch-base",
        replacement = "phaseb-batch-replacement",
        partial = "phaseb-batch-partial",
        deleted = "phaseb-batch-deleted",
        noise = "phaseb-batch-noise";
      const pair = await this.prepare(
        base,
        "trial-physical-replace",
        "gradient",
      );
      await this.upload(base, pair);
      const first = await this.commit(base);
      const retry = await this.commit(base);
      demand(
        first.operation.committed_version === retry.operation.committed_version,
        "commit_replay",
      );
      const next = await this.prepare(
        replacement,
        "trial-physical-replace",
        "portrait",
        first.operation.committed_version,
      );
      await this.upload(replacement, next);
      await this.commit(replacement);
      const before = await this.status();
      demand(
        before.budgets.every(
          (b: any) =>
            b.used_bytes ===
            pair.full.length +
              pair.thumbnail.length +
              next.full.length +
              next.thumbnail.length,
        ),
        "old_bytes_not_retained",
      );
      await this.cleanup(base);
      await this.cleanup(base);
      // Verified full upload, then intentional failure BEFORE any thumbnail write claim.
      const half = await this.prepare(
        partial,
        "trial-physical-partial",
        "gradient",
      );
      await this.write(partial, "full", half.full);
      await this.verify(partial, "full");
      await this.cancel(partial);
      await this.cleanup(partial);
      // Real full object, deletion fence before thumbnail; late writer must be denied.
      const late = await this.prepare(
        deleted,
        "trial-physical-deleted",
        "gradient",
      );
      await this.write(deleted, "full", late.full);
      await this.call("delete_item", { item_id: "trial-physical-deleted" });
      let denied = false;
      try {
        await this.write(deleted, "thumb", late.thumbnail);
      } catch (e) {
        denied = String(e).includes("item_fenced");
      }
      demand(denied, "late_write_not_denied");
      await this.cleanup(deleted);
      let rejected = false;
      try {
        await this.prepare(noise, "trial-physical-noise", "noise");
      } catch (e) {
        rejected = String(e).includes("too complex");
      }
      demand(rejected, "noise_not_rejected");
      await this.cancel(noise);
      await this.cleanup(noise);
      const current = await this.status(replacement);
      await this.call("remove", {
        item_id: "trial-physical-replace",
        expected_version: current.operation.committed_version,
      });
      await this.cleanup(replacement);
      const final = await this.status();
      demand(
        final.budgets.every(
          (b: any) =>
            b.used_bytes === 0 &&
            b.reserved_bytes === 0 &&
            b.pending_count === 0 &&
            b.photo_count === 0,
        ),
        "residual_accounting",
      );
      await this.call("batch_close", { result: "complete" });
      return {
        complete: true,
        state: await this.status(),
        evidence: this.evidence,
      };
    } catch (e) {
      try {
        await this.call("batch_close", { result: "blocked" });
      } catch {}
      throw e;
    }
  }
}
