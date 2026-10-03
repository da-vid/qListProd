import type { Ledger, Snapshot, State } from "./ledger.ts";
import type { StoragePort } from "./engine.ts";
export const BETA_BUCKET = "qlist-photo-beta-v1";
export function sdkPorts(admin: any): {
  ledger: Ledger;
  storage: StoragePort;
  checkBucket: () => Promise<void>;
} {
  const check = (r: any) => {
    if (r.error) throw new Error("Photo service unavailable");
    return r.data;
  };
  const bucket = admin.storage.from(BETA_BUCKET);
  const key = (value: string) => {
    if (!/^beta-v1\/[0-9a-f-]{36}\/full\.jpg$/.test(value))
      throw new Error("Invalid storage key");
    return value;
  };
  return {
    ledger: {
      load: async (signal) => {
        const value = check(
          await admin.rpc("qlist_photo_beta_load").abortSignal(signal),
        );
        if (!value) throw new Error("Missing budget");
        return value as Snapshot;
      },
      swap: async (before: Snapshot, state: State, signal: AbortSignal) =>
        check(
          await admin
            .rpc("qlist_photo_beta_swap", {
              expected_revision: before.revision,
              expected_control: before.control,
              legacy_token: before.legacyToken,
              next_state: state,
            })
            .abortSignal(signal),
        ) === true,
    },
    checkBucket: async () => {
      const b = check(await admin.storage.getBucket(BETA_BUCKET));
      if (
        b.public !== false ||
        Number(b.file_size_limit) !== 393216 ||
        JSON.stringify(b.allowed_mime_types) !== '["image/jpeg"]'
      )
        throw new Error("Bucket configuration mismatch");
    },
    storage: {
      put: async (path, bytes) => {
        check(
          await bucket.upload(key(path), bytes, {
            contentType: "image/jpeg",
            cacheControl: "0",
            upsert: false,
          }),
        );
      },
      read: async (path, signal) => {
        const stream = check(
          await bucket
            .download(key(path), {}, { cache: "no-store" })
            .asStream(),
        ) as ReadableStream<Uint8Array>;
        const reader = stream.getReader(),
          chunks: Uint8Array[] = [];
        let size = 0;
        try {
          while (true) {
            signal.throwIfAborted();
            const { value, done } = await reader.read();
            if (done) break;
            size += value.length;
            if (size > 393216) throw new Error("Object too large");
            chunks.push(value);
          }
        } finally {
          await reader.cancel().catch(() => {});
          reader.releaseLock();
        }
        const out = new Uint8Array(size);
        let at = 0;
        for (const c of chunks) {
          out.set(c, at);
          at += c.length;
        }
        return out;
      },
      remove: async (paths) => {
        if (paths.length) check(await bucket.remove(paths.map(key)));
      },
      exists: async (path) => {
        const r = await bucket.info(key(path));
        if (!r.error) return true;
        if (
          r.error.code === "NoSuchKey" &&
          (Number(r.error.status) === 404 ||
            (Number(r.error.status) === 400 &&
              Number(r.error.statusCode) === 404))
        )
          return false;
        throw new Error("Object absence unverified");
      },
    },
  };
}
