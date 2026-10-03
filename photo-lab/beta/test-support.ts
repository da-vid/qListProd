import { mkdtemp, readFile, writeFile, unlink, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MemoryLedger, type Ledger } from "./ledger.ts";
import { BetaEngine, type StoragePort } from "./engine.ts";
import { createBetaHandler } from "./handler.ts";
import { initialize } from "../storage-trial/phase-b/codec.js";
import { HttpPhotoGateway } from "../../src/photo/http-gateway.ts";
export async function fixture(ledger: Ledger = new MemoryLedger()) {
  if (ledger instanceof MemoryLedger)
    ledger.value.control = {
      enabled: true,
      maintenance: true,
      lists: ["PhotoDemo"],
    };
  const directory = await mkdtemp(join(tmpdir(), "qlist-beta-files-"));
  const paths = new Set<string>();
  const textItems = new Set(["item", "other"]);
  let textAvailable = true,
    cleanupFails = false,
    puts = 0,
    reads = 0,
    putHook: ((key: string) => Promise<void>) | undefined;
  const localPath = (key: string) => {
    if (!/^beta-v1\/[0-9a-f-]{36}\/(full|thumb)\.jpg$/.test(key))
      throw Error("Invalid key");
    return join(directory, key.replaceAll("/", "_"));
  };
  const storage: StoragePort = {
    put: async (key, bytes, signal) => {
      signal.throwIfAborted();
      puts++;
      if (putHook) await putHook(key);
      await writeFile(localPath(key), bytes, { flag: "wx" });
      paths.add(key);
    },
    read: async (key, signal) => {
      signal.throwIfAborted();
      reads++;
      return new Uint8Array(await readFile(localPath(key)));
    },
    remove: async (keys, signal) => {
      signal.throwIfAborted();
      if (cleanupFails) throw Error("Synthetic cleanup failure");
      for (const key of keys) {
        await unlink(localPath(key)).catch((e) => {
          if (e.code !== "ENOENT") throw e;
        });
        paths.delete(key);
      }
    },
    exists: async (key, signal) => {
      signal.throwIfAborted();
      return stat(localPath(key)).then(
        () => true,
        (e) => {
          if (e.code === "ENOENT") return false;
          throw e;
        },
      );
    },
  };
  const process = await initialize();
  const engine = new BetaEngine({
    ledger,
    storage,
    process,
  });
  const handler = createBetaHandler({
    enabled: true,
    maintenanceEnabled: true,
    origins: ["http://127.0.0.1:4174"],
    connect: async () => engine,
  });
  const fetcher: typeof fetch = async (input, init) =>
    handler(
      new Request(input instanceof Request ? input : String(input), init),
    );
  const client = new HttpPhotoGateway(
    "http://127.0.0.1:4175/photo",
    "PhotoDemo",
    fetcher,
  );
  const jpeg = new Blob(
    [
      await readFile(
        new URL(
          "../results/browser/normalized-progressive.jpg",
          import.meta.url,
        ),
      ),
    ],
    { type: "image/jpeg" },
  );
  return {
    ledger,
    directory,
    paths,
    textItems,
    engine,
    handler,
    client,
    jpeg,
    storage,
    get puts() {
      return puts;
    },
    get reads() {
      return reads;
    },
    set textAvailable(v: boolean) {
      textAvailable = v;
    },
    set cleanupFails(v: boolean) {
      cleanupFails = v;
    },
    set putHook(v: typeof putHook) {
      putHook = v;
    },
  };
}
export const signal = () => new AbortController().signal;
export const upload = (jpeg: Blob) => ({
  operationId: crypto.randomUUID(),
  jpeg,
});
