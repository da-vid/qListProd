import { verifyAuth } from "@supabase/server/core";
export default {
  fetch: async (req: Request) => {
    try {
      const { data, error } = await verifyAuth(req, { auth: "secret:default" });
      if (error || data.authMode !== "secret")
        return new Response("Unauthorized", { status: 401 });
    } catch {
      return new Response("Unauthorized", { status: 401 });
    }
    return Response.json(
      { stopped: true, preserve_accounting: true },
      { status: 410, headers: { "Cache-Control": "no-store" } },
    );
  },
};
