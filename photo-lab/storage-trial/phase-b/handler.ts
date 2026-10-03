import {
  bounded,
  PhysicalTrial,
  type Rpc,
  type Store,
  type Pair,
} from "./engine.ts";
type Dependencies = {
  authorize: (r: Request) => Promise<boolean>;
  connect: (s: AbortSignal) => { rpc: Rpc; storage: Store };
  initialize: () => Promise<(b: Uint8Array) => Promise<Pair>>;
  fixtures: Record<string, string>;
  expiresAt: number;
  now?: () => number;
  timeoutMs?: number;
};
const reply = (x: unknown, status = 200) =>
  Response.json(x, { status, headers: { "Cache-Control": "no-store" } });
export function createHandler(d: Dependencies) {
  return async (req: Request) => {
    try {
      if (!(await d.authorize(req)))
        return reply({ error: "unauthorized" }, 401);
    } catch {
      return reply({ error: "unauthorized" }, 401);
    }
    if (req.method !== "POST") return reply({ error: "post_required" }, 405);
    if ((d.now ?? Date.now)() >= d.expiresAt)
      return reply({ error: "trial_expired" }, 410);
    if (
      req.headers.get("content-type")?.split(";")[0].trim() !==
        "application/json" ||
      req.headers.has("content-encoding")
    )
      return reply({ error: "json_required" }, 400);
    const control = new AbortController(),
      timer = setTimeout(() => control.abort(), d.timeoutMs ?? 90000);
    try {
      const reader = req.body?.getReader();
      if (!reader) throw new Error("invalid_body");
      let text = "",
        bytes = 0,
        chunks = 0;
      try {
        while (true) {
          const n = await bounded(reader.read(), control.signal, 1000);
          if (n.done) break;
          if (
            !n.value.length ||
            ++chunks > 16 ||
            (bytes += n.value.length) > 128
          )
            throw new Error("invalid_body");
          text += new TextDecoder("utf-8", { fatal: true }).decode(n.value);
        }
      } finally {
        void reader.cancel().catch(() => {});
        reader.releaseLock();
      }
      const declared = req.headers.get("content-length");
      if (
        declared !== null &&
        (!/^\d+$/.test(declared) || Number(declared) !== bytes)
      )
        throw new Error("invalid_body");
      const input = JSON.parse(text);
      if (
        !input ||
        typeof input !== "object" ||
        Object.keys(input).length !== 1 ||
        !["run", "status", "reconcile", "cleanup"].includes(input.command)
      )
        throw new Error("invalid_command");
      const { rpc, storage } = d.connect(control.signal);
      let processor: ((b: Uint8Array) => Promise<Pair>) | undefined;
      const fixtures = Object.fromEntries(
        Object.entries(d.fixtures).map(([k, v]) => [
          k,
          Uint8Array.from(atob(v), (c) => c.charCodeAt(0)),
        ]),
      );
      const trial = new PhysicalTrial(
        rpc,
        storage,
        async (bytes) => {
          processor ??= await d.initialize();
          return processor(bytes);
        },
        fixtures,
        control.signal,
      );
      const work =
        input.command === "run"
          ? trial.run()
          : input.command === "cleanup"
            ? trial.finishCleanup()
          : input.command === "reconcile"
            ? trial.reconcile()
            : trial.status();
      return reply({
        phase: "B",
        synthetic_only: true,
        ...(await bounded(work, control.signal, 90000)),
      });
    } catch (e) {
      return reply(
        {
          error: control.signal.aborted
            ? "batch_timeout"
            : /invalid_|JSON/.test(String(e))
              ? "invalid_request"
              : "batch_blocked",
          action:
            "Inspect durable ledger; reconcile only settled writers. Never reset or refund unknown uploads.",
        },
        control.signal.aborted ? 504 : 409,
      );
    } finally {
      control.abort();
      clearTimeout(timer);
    }
  };
}
