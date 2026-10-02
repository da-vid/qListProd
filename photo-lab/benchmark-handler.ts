// Synthetic-only handler. Existing admin credential; never logged or returned.
type Result = {
  full: Uint8Array;
  thumbnail: Uint8Array;
  width: number;
  height: number;
};
type Dependencies = {
  authorize: (req: Request) => Promise<boolean>;
  initialize: () => Promise<(bytes: Uint8Array) => Promise<Result>>;
  fixtures: Record<string, string>;
  expiresAt: number;
  memory: () => unknown;
};
export function createBenchmarkHandler(deps: Dependencies) {
  let busy = false,
    requests = 0,
    processor: Awaited<ReturnType<Dependencies["initialize"]>> | undefined;
  const response = (status: number, data: unknown) =>
    Response.json(data, { status, headers: { "Cache-Control": "no-store" } });
  return async (req: Request) => {
    let authorized = false;
    try {
      authorized = await deps.authorize(req);
    } catch {}
    if (!authorized) return response(401, { error: "Unauthorized" });
    if (req.method !== "POST") return response(405, { error: "POST required" });
    if (Date.now() > deps.expiresAt)
      return response(410, { error: "Synthetic benchmark has expired" });
    if (busy || requests >= 12)
      return response(429, { error: "Worker benchmark limit reached" });
    const reader = req.body?.getReader();
    if (!reader) return response(400, { error: "JSON body required" });
    let body = new Uint8Array(0);
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (body.length + value.length > 128) {
          await reader.cancel();
          return response(413, { error: "Body too large" });
        }
        const next = new Uint8Array(body.length + value.length);
        next.set(body);
        next.set(value, body.length);
        body = next;
      }
    } finally {
      reader.releaseLock();
    }
    let fixture: string;
    try {
      const data = JSON.parse(new TextDecoder().decode(body));
      if (
        !data ||
        Object.keys(data).length !== 1 ||
        typeof data.fixture !== "string" ||
        !Object.hasOwn(deps.fixtures, data.fixture)
      )
        throw new Error();
      fixture = data.fixture;
    } catch {
      return response(400, { error: "Choose a bundled synthetic fixture" });
    }
    if (busy || requests >= 12)
      return response(429, { error: "Worker benchmark limit reached" });
    busy = true;
    requests++;
    const cold = !processor,
      start = performance.now(),
      before = deps.memory();
    try {
      processor ??= await deps.initialize();
      const bytes = Uint8Array.from(atob(deps.fixtures[fixture]), (c) =>
        c.charCodeAt(0),
      );
      const result = await processor(bytes);
      return response(200, {
        fixture,
        cold,
        status: "passed",
        fullBytes: result.full.length,
        thumbnailBytes: result.thumbnail.length,
        width: result.width,
        height: result.height,
        wallMs: performance.now() - start,
        memoryBefore: before,
        memoryAfter: deps.memory(),
        cpuMs: null,
        peakMemory: null,
      });
    } catch {
      return response(422, {
        fixture,
        cold,
        status: "rejected",
        wallMs: performance.now() - start,
        memoryBefore: before,
        memoryAfter: deps.memory(),
        cpuMs: null,
        peakMemory: null,
      });
    } finally {
      busy = false;
    }
  };
}
