import { bounded } from "../../src/photo/adapter.ts";
import { BetaEngine } from "./engine.ts";
import { BetaError, demand } from "./ledger.ts";
const encode = (b: Uint8Array) => {
  let s = "";
  for (const n of b) s += String.fromCharCode(n);
  return btoa(s);
};
export function createBetaHandler(options: {
  enabled: boolean;
  origins: string[];
  connect: (signal: AbortSignal) => Promise<BetaEngine>;
}) {
  const handle = async (request: Request): Promise<Response> => {
    const origin = request.headers.get("origin");
    const headers: Record<string, string> = {
      "Cache-Control": "no-store",
      "Referrer-Policy": "no-referrer",
      "X-Content-Type-Options": "nosniff",
      Vary: "Origin",
    };
    if (origin && options.origins.includes(origin)) {
      headers["Access-Control-Allow-Origin"] = origin;
      headers["Access-Control-Allow-Methods"] = "POST, OPTIONS";
      headers["Access-Control-Allow-Headers"] = "Content-Type";
    }
    const json = (body: unknown, status = 200) =>
      Response.json(body, { status, headers });
    if (!options.enabled)
      return json({ error: "Photos are paused. Text edits still work." }, 503);
    if (origin && !options.origins.includes(origin))
      return json({ error: "Photo origin is unavailable." }, 403);
    if (request.method === "OPTIONS")
      return new Response(null, { status: 204, headers });
    if (request.method !== "POST")
      return json({ error: "Unsupported photo method." }, 405);
    const signal = AbortSignal.any([request.signal, AbortSignal.timeout(8000)]);
    try {
      const url = new URL(request.url),
        params = url.searchParams;
      demand(
        [...params.keys()].length === 4 &&
          new Set(params.keys()).size === 4 &&
          [...params.keys()].every((k) =>
            ["action", "list", "item", "id"].includes(k),
          ),
        "Invalid photo route.",
        400,
      );
      const action = params.get("action")!,
        list = params.get("list")!,
        item = params.get("item")!,
        id = params.get("id")!;
      demand(
        ["get", "put", "status", "remove", "delete"].includes(action),
        "Invalid photo action.",
        400,
      );
      demand(
        !request.headers.has("authorization") && !request.headers.has("apikey"),
        "Client credentials are not used here.",
        400,
      );
      const engine = await options.connect(signal);
      await engine.admit(list, item, signal);
      if (action === "put") {
        const parts = id.split(":");
        demand(
          parts.length === 2 && /^\d{1,12}$/.test(parts[1]),
          "Invalid save version.",
          400,
        );
        return json(
          await engine.put(
            list,
            item,
            parts[0],
            Number(parts[1]),
            new Request(request, { signal }),
            signal,
          ),
        );
      }
      demand(!request.body, "This photo action takes no body.", 400);
      if (action === "get") {
        demand(id === "", "Invalid photo read.", 400);
        const p = await engine.get(list, item, signal);
        return json(
          p
            ? {
                version: p.version,
                full: encode(p.full),
                thumbnail: encode(p.thumbnail),
              }
            : null,
        );
      }
      if (action === "status") {
        demand(/^[0-9a-f-]{36}$/.test(id), "Invalid operation.", 400);
        return json((await engine.status(list, item, id, signal)) ?? null);
      }
      demand(
        action === "delete" ? id === "" : /^\d{1,12}$/.test(id),
        "Invalid removal.",
        400,
      );
      await engine.remove(
        list,
        item,
        action === "delete" ? undefined : Number(id),
        action === "delete",
        signal,
      );
      return json({ ok: true });
    } catch (e) {
      return json(
        {
          error:
            e instanceof BetaError
              ? e.message
              : "Photos are unavailable. Text edits still work.",
        },
        e instanceof BetaError ? e.status : 503,
      );
    }
  };
  return (request: Request) =>
    bounded(
      (signal) => handle(new Request(request, { signal })),
      8000,
      request.signal,
    ).catch(() =>
      Response.json(
        { error: "Photos timed out. Text edits still work." },
        { status: 503, headers: { "Cache-Control": "no-store" } },
      ),
    );
}
