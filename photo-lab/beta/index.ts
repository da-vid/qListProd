// REVIEW ARTIFACT ONLY. Deliberately disabled in source and database.
import { createAdminClient } from "@supabase/server/core";
import { createBetaHandler } from "./handler.ts";
import { BetaEngine } from "./engine.ts";
import { sdkPorts } from "./sdk.ts";
import { firebaseTextAuthority } from "./text-authority.ts";
import { initialize } from "../storage-trial/phase-b/codec.js";
const RUNTIME_ENABLED = false;
let processor: ReturnType<typeof initialize> | undefined;
export default {
  fetch: createBetaHandler({
    enabled: RUNTIME_ENABLED,
    origins: [
      "https://qlist.cc",
      "https://www.qlist.cc",
      "https://qlist.netlify.app",
    ],
    connect: async (signal: AbortSignal) => {
      // Existing server environment only. Never read, copy, mint or send a service key to a client.
      if (
        Deno.env.get("SUPABASE_URL") !==
        "https://qmpdinzendwpkqhtqskz.supabase.co"
      )
        throw new Error("Wrong project");
      const ports = sdkPorts(
        createAdminClient({
          auth: { keyName: "default" },
          supabaseOptions: {
            global: {
              fetch: (input, init) =>
                fetch(input, {
                  ...init,
                  signal: AbortSignal.any([signal, AbortSignal.timeout(6500)]),
                }),
            },
          },
        }),
      );
      let ready: Promise<void> | undefined;
      const storage = Object.fromEntries(
        Object.entries(ports.storage).map(([name, fn]) => [
          name,
          async (...args: unknown[]) => {
            ready ??= ports.checkBucket();
            await ready;
            return (fn as (...values: unknown[]) => Promise<unknown>)(...args);
          },
        ]),
      ) as unknown as typeof ports.storage;
      // Lazy processor initialization after a normalized upload has been admitted.
      return new BetaEngine({
        ...ports,
        storage,
        text: firebaseTextAuthority(),
        process: async (bytes) => {
          processor ??= initialize();
          return (await processor)(bytes);
        },
      });
    },
  }),
};
