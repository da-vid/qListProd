// New production endpoint. Database controls default off until hosted acceptance.
import { createAdminClient } from "@supabase/server/core";
import { createBetaHandler } from "../photo-lab/beta/handler.ts";
import { BetaEngine } from "../photo-lab/beta/engine.ts";
import { sdkPorts } from "../photo-lab/beta/sdk.ts";
import { firebaseTextAuthority } from "../photo-lab/beta/text-authority.ts";
import { initialize } from "../photo-lab/storage-trial/phase-b/codec.js";
const RUNTIME_ENABLED = true;
const MAINTENANCE_ENABLED = true;
let processor: ReturnType<typeof initialize> | undefined;
export default {
  fetch: createBetaHandler({
    enabled: RUNTIME_ENABLED,
    maintenanceEnabled: MAINTENANCE_ENABLED,
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
        true,
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
