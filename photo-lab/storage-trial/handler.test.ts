import test from "node:test";
import assert from "node:assert/strict";
import { createTrialHandler } from "./handler.ts";
const request = (
  body: unknown = { case: "status" },
  headers: Record<string, string> = { "content-type": "application/json" },
) =>
  new Request("https://trial.invalid", {
    method: "POST",
    headers,
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
const make = (overrides: Record<string, unknown> = {}) => {
  let calls = 0;
  let auth = 0;
  const handler = createTrialHandler({
    authorize: async () => {
      auth++;
      return true;
    },
    makeRpc: () => async () => {
      calls++;
      return { phase: "A" };
    },
    expiresAt: 100,
    now: () => 0,
    ...overrides,
  });
  return { handler, calls: () => calls, auth: () => auth };
};
test("authorization failure or error never creates an admin client", async () => {
  for (const authorize of [
    async () => false,
    async () => {
      throw Error("private auth detail");
    },
  ]) {
    const h = make({
      authorize,
      makeRpc: () => {
        throw Error("must not create");
      },
    });
    const r = await h.handler(request());
    assert.equal(r.status, 401);
    assert.equal(await r.text(), '{"error":"unauthorized"}');
  }
});
test("deadline and method fail before SQL access", async () => {
  const expired = make({ now: () => 100 });
  assert.equal((await expired.handler(request())).status, 410);
  assert.equal(expired.calls(), 0);
  const method = make();
  assert.equal(
    (await method.handler(new Request("https://trial.invalid"))).status,
    405,
  );
  assert.equal(method.calls(), 0);
});
test("only named synthetic cases, no IDs, lists, paths, booleans or reset", async () => {
  for (const body of [
    { case: "reset" },
    { case: "status", item_id: "real" },
    { case: "status", objectsAbsent: true },
    { case: "status", path: "x" },
    [],
    null,
    "bad json",
  ]) {
    const h = make();
    assert.notEqual((await h.handler(request(body))).status, 200);
    assert.equal(h.calls(), 0);
  }
});
test("body byte limit, content type, encoding and dishonest length", async () => {
  for (const req of [
    request("x".repeat(1025)),
    request({}, { "content-type": "text/plain" }),
    request(
      { case: "status" },
      { "content-type": "application/json", "content-encoding": "gzip" },
    ),
    request(
      { case: "status" },
      { "content-type": "application/json", "content-length": "3" },
    ),
  ]) {
    const h = make();
    assert.equal((await h.handler(req)).status, 400);
    assert.equal(h.calls(), 0);
  }
});
test("stalled body is canceled and cannot start SQL", async () => {
  let canceled = false;
  const body = new ReadableStream({
    pull() {
      return new Promise(() => {});
    },
    cancel() {
      canceled = true;
    },
  });
  const h = make();
  const req = new Request("https://trial.invalid", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body,
    duplex: "half",
  } as RequestInit);
  assert.equal((await h.handler(req)).status, 504);
  assert(canceled);
  assert.equal(h.calls(), 0);
});
test("status works with no-store and simulated phase label", async () => {
  const h = make();
  const r = await h.handler(request());
  assert.equal(r.status, 200);
  assert.equal(r.headers.get("cache-control"), "no-store");
  assert.equal((await r.json()).simulated_objects, true);
  assert.equal(h.calls(), 1);
});
test("SQL/SDK failures are sanitized, not echoed", async () => {
  const h = make({
    makeRpc: () => async () => {
      throw Error("FAKE_PRIVATE_TEST_VALUE");
    },
  });
  const r = await h.handler(request());
  assert.equal(r.status, 409);
  assert(!(await r.text()).includes("FAKE_PRIVATE_TEST_VALUE"));
});

test("a client that ignores abort cannot hang or trigger an unsafe refund", async () => {
  let calls = 0;
  const h = make({
    timeoutMs: 25,
    makeRpc: () => async () => {
      calls++;
      return new Promise(() => {});
    },
  });
  const r = await h.handler(request());
  assert.equal(r.status, 504);
  assert.equal(calls, 1);
});
