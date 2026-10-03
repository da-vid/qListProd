// Phase A only: database transactions and simulated object identities, no codec/storage API.
export type Rpc = (
  action: string,
  payload: Record<string, unknown>,
  signal: AbortSignal,
) => Promise<any>;
type Dependencies = {
  authorize: (req: Request) => Promise<boolean>;
  makeRpc: () => Rpc;
  expiresAt: number;
  now?: () => number;
  timeoutMs?: number;
};
const CASES = [
  "status",
  "smoke",
  "replacement-race",
  "delete-during-stage",
  "partial-cleanup",
] as const;
const json = (body: unknown, status = 200) =>
  Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
async function readCase(req: Request, signal: AbortSignal): Promise<string> {
  if (
    req.headers.get("content-type")?.split(";")[0].trim() !== "application/json"
  )
    throw new Error("content_type");
  if (req.headers.has("content-encoding")) throw new Error("content_encoding");
  const declared = req.headers.get("content-length");
  if (declared !== null && (!/^\d+$/.test(declared) || Number(declared) > 1024))
    throw new Error("body_limit");
  const reader = req.body?.getReader();
  if (!reader) throw new Error("body_required");
  let bytes = 0,
    chunks = 0;
  const parts: Uint8Array[] = [];
  const abort = () => {
    void reader.cancel().catch(() => {});
  };
  signal.addEventListener("abort", abort, { once: true });
  try {
    while (true) {
      if (signal.aborted) throw new Error("timeout");
      const next = await reader.read();
      if (signal.aborted) throw new Error("timeout");
      if (next.done) break;
      bytes += next.value.byteLength;
      if (bytes > 1024 || ++chunks > 64) throw new Error("body_limit");
      parts.push(next.value);
    }
    if (declared !== null && Number(declared) !== bytes)
      throw new Error("body_length");
    const all = new Uint8Array(bytes);
    let offset = 0;
    for (const p of parts) {
      all.set(p, offset);
      offset += p.length;
    }
    const value = JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(all),
    );
    if (
      !value ||
      Array.isArray(value) ||
      typeof value !== "object" ||
      Object.keys(value).length !== 1 ||
      !CASES.includes(value.case)
    )
      throw new Error("invalid_case");
    return value.case;
  } finally {
    signal.removeEventListener("abort", abort);
    void reader.cancel().catch(() => {});
  }
}
export async function runCase(name: string, rpc: Rpc, signal: AbortSignal) {
  const evidence: any[] = [];
  const call = async (
    action: string,
    payload: Record<string, unknown> = {},
  ) => {
    if (signal.aborted) throw new Error("timeout");
    const r = await rpc(action, payload, signal);
    evidence.push({ action, result: r });
    return r;
  };
  const reserve = (id: string, item: string, expected = 0) =>
    call("reserve", {
      operation_id: id,
      item_id: item,
      expected_version: expected,
      fixture: "gradient",
    });
  const op = (action: string, id: string) => call(action, { operation_id: id });
  const require = (ok: boolean, message: string) => {
    if (!ok) throw new Error("assertion:" + message);
  };
  if (name === "status")
    return {
      evidence: [{ action: "status", result: await rpc("status", {}, signal) }],
    };
  const prefix = "phasea-hosted-" + name;
  const item = "trial-hosted-" + name;
  if (name === "smoke") {
    const a = await reserve(prefix, item);
    const duplicate = await reserve(prefix, item);
    require(a.operation.request_digest ===
      duplicate.operation.request_digest, "duplicate_digest");
    if (!a.operation.was_committed) {
      await op("stage", prefix);
      await op("commit", prefix);
    }
    const replay = await op("commit", prefix);
    require(replay.operation.was_committed, "commit_replay");
  } else if (name === "replacement-race") {
    const base = await reserve(prefix + "-base", item);
    if (base.operation.was_committed)
      return {
        already_run: true,
        evidence,
        notice: "Inspect status/evidence; this bounded scenario is not reset.",
      };
    await op("stage", prefix + "-base");
    const initial = await op("commit", prefix + "-base");
    await Promise.all([
      reserve(prefix + "-a", item, initial.operation.committed_version),
      reserve(prefix + "-b", item, initial.operation.committed_version),
    ]);
    await Promise.all([op("stage", prefix + "-a"), op("stage", prefix + "-b")]);
    const race = await Promise.allSettled([
      op("commit", prefix + "-a"),
      op("commit", prefix + "-b"),
    ]);
    require(race.filter((x) => x.status === "fulfilled").length ===
      1, "exactly_one_commit");
    const loser = race.findIndex((x) => x.status === "rejected");
    require(race[loser].status === "rejected" &&
      String((race[loser] as PromiseRejectedResult).reason).includes(
        "version_conflict",
      ), "conflict_reason");
    await op("cancel", prefix + (loser === 0 ? "-a" : "-b"));
    await op("cleanup", prefix + (loser === 0 ? "-a" : "-b"));
    await op("cleanup", prefix + "-base");
    await op("cleanup", prefix + "-base");
  } else if (name === "delete-during-stage") {
    const a = await reserve(prefix, item);
    if (a.operation.phase === "released")
      return { already_run: true, evidence };
    await op("stage_partial", prefix);
    await call("delete_item", { item_id: item });
    try {
      await op("stage", prefix);
      throw new Error("unexpected_stage_success");
    } catch (e) {
      require(String(e).includes("item_fenced"), "deleted_item_fence");
    }
    await op("cleanup", prefix);
    await op("cleanup", prefix);
  } else if (name === "partial-cleanup") {
    const a = await reserve(prefix, item);
    if (a.operation.phase === "released")
      return { already_run: true, evidence };
    await op("stage_partial", prefix);
    const canceled = await op("cancel", prefix);
    require(canceled.operation.reserved_bytes ===
      425984, "retained_reservation");
    await op("cleanup", prefix);
    const again = await op("cleanup", prefix);
    require(again.operation.phase === "released" &&
      again.objects.every(
        (x: any) => x.state === "simulated-absent",
      ), "cleanup_proof");
  } else throw new Error("invalid_case");
  return { evidence };
}
export function createTrialHandler(deps: Dependencies) {
  return async (req: Request) => {
    try {
      if (!(await deps.authorize(req)))
        return json({ error: "unauthorized" }, 401);
    } catch {
      return json({ error: "unauthorized" }, 401);
    }
    if (req.method !== "POST") return json({ error: "method" }, 405);
    if ((deps.now ?? Date.now)() >= deps.expiresAt)
      return json({ error: "trial_expired" }, 410);
    const control = new AbortController();
    const timer = setTimeout(() => control.abort(), deps.timeoutMs ?? 20000);
    let bodyTimer: ReturnType<typeof setTimeout> | undefined;
    try {
      bodyTimer = setTimeout(() => control.abort(), 1000);
      const name = await readCase(req, control.signal);
      clearTimeout(bodyTimer);
      const rpc = deps.makeRpc();
      const abort = new Promise<never>((_, reject) =>
        control.signal.addEventListener(
          "abort",
          () => reject(new Error("timeout")),
          { once: true },
        ),
      );
      const result = await Promise.race([
        runCase(name, rpc, control.signal),
        abort,
      ]);
      return json({
        phase: "A",
        simulated_objects: true,
        case: name,
        ...result,
      });
    } catch (e) {
      const message = String(e);
      const known = [
        "invalid_case",
        "content_type",
        "content_encoding",
        "body_limit",
        "body_length",
        "body_required",
      ];
      const invalid =
        e instanceof SyntaxError
          ? "invalid_json"
          : known.find((x) => message.includes(x));
      // Do not return SDK responses, key material, headers, environment or arbitrary errors.
      return json(
        {
          error: control.signal.aborted
            ? "timeout"
            : (invalid ?? "trial_failed"),
          recover: "Inspect durable operation status; do not reset accounting.",
        },
        control.signal.aborted ? 504 : invalid ? 400 : 409,
      );
    } finally {
      clearTimeout(timer);
      clearTimeout(bodyTimer);
    }
  };
}
