import { verifyAuth, createAdminClient } from "@supabase/server/core";
import { createTrialHandler } from "./handler.ts";

// Preserve the reviewed v4 gate; no manual key reads/comparison, no new keys.
export default {
  fetch: createTrialHandler({
    expiresAt: Date.parse("2026-10-04T00:00:00Z"),
    authorize: async (req: Request) => {
      const { data, error } = await verifyAuth(req, { auth: "secret:default" });
      if (error) {
        console.warn("trial_auth_rejected", error.code);
        return false;
      }
      return data.authMode === "secret";
    },
    makeRpc: () => {
      const admin = createAdminClient({ auth: { keyName: "default" } });
      return async (action, payload, signal) => {
        const { data, error } = await admin
          .rpc("qlist_photo_trial_rpc", { action, payload })
          .abortSignal(signal);
        if (error) throw new Error(error.message);
        return data;
      };
    },
  }),
};
