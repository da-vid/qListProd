import { BUCKET, type Store, type Rpc } from "./engine.ts";
// Receives the already-authorized, official SDK admin client; never handles raw keys.
export function adapters(admin: any): { storage: Store; rpc: Rpc } {
  const checked = (response: any) => {
    if (response.error)
      throw new Error(response.error.message ?? "service_error");
    return response.data;
  };
  const bucket = admin.storage.from(BUCKET);
  const key = (path: string) => {
    if (
      !/^phase-b\/PhotoDemo\/phaseb-[a-z0-9-]{1,64}\/(full|thumb)\.jpg$/.test(
        path,
      )
    )
      throw new Error("unsafe_storage_key");
    return path;
  };
  return {
    rpc: async (action, payload, signal) =>
      checked(
        await admin
          .rpc("qlist_photo_trial_b_rpc", { action, payload })
          .abortSignal(signal),
      ),
    storage: {
      setup: async () => {
        let got = await admin.storage.getBucket(BUCKET);
        if (got.error) {
          if (got.error.code !== "NoSuchBucket")
            throw new Error("bucket_lookup_failed");
          checked(
            await admin.storage.createBucket(BUCKET, {
              public: false,
              fileSizeLimit: 393216,
              allowedMimeTypes: ["image/jpeg"],
            }),
          );
          got = await admin.storage.getBucket(BUCKET);
        }
        const b = checked(got);
        if (
          b.public !== false ||
          Number(b.file_size_limit) !== 393216 ||
          JSON.stringify(b.allowed_mime_types) !== '["image/jpeg"]'
        )
          throw new Error("bucket_configuration_mismatch");
        const listing = checked(await bucket.list("", { limit: 1 }));
        if (!Array.isArray(listing) || listing.length !== 0)
          throw new Error("bucket_not_empty");
      },
      put: async (path, bytes) => {
        checked(
          await bucket.upload(key(path), bytes, {
            contentType: "image/jpeg",
            cacheControl: "0",
            upsert: false,
          }),
        );
      },
      read: async (path) =>
        checked(
          await bucket
            .download(key(path), {}, { cache: "no-store" })
            .asStream(),
        ),
      remove: async (paths) => checked(await bucket.remove(paths.map(key))),
      exists: async (path) => {
        const r = await bucket.info(key(path));
        if (!r.error) return true;
        // StorageBackendError renders semantic statusCode=404 with a legacy
        // transport status of 400. Require the exact service code as well;
        // a generic 400/404, auth failure, or message text is never proof.
        if (
          r.error.code === "NoSuchKey" &&
          (Number(r.error.status) === 404 ||
            (Number(r.error.status) === 400 &&
              Number(r.error.statusCode) === 404))
        )
          return false;
        throw new Error("object_absence_unverified");
      },
    },
  };
}
