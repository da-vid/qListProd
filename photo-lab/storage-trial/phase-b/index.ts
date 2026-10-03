import { verifyAuth, createAdminClient } from "@supabase/server/core";
import { createHandler } from "./handler.ts";
import { adapters } from "./sdk.ts";
import { initialize } from "./codec.js";
import { fixtures } from "./fixtures.js";
export default {
  fetch: createHandler({
    expiresAt: Date.parse("2026-10-04T00:00:00Z"),
    authorize: async (req: Request) => {
      const { data, error } = await verifyAuth(req, { auth: "secret:default" });
      if (error) {
        console.warn("physical_trial_auth_rejected", error.code);
        return false;
      }
      return data.authMode === "secret";
    },
    connect: (signal: AbortSignal) =>
      adapters(
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
      ),
    initialize,
    fixtures,
  }),
};
