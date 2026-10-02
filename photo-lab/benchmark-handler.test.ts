import { test } from "node:test";
import assert from "node:assert/strict";
import { createBenchmarkHandler } from "./benchmark-handler.ts";
const request = (
  body = '{"fixture":"gradient"}',
  auth = "Bearer local-test-only",
) =>
  new Request("http://local.test", {
    method: "POST",
    headers: { authorization: auth },
    body,
  });
test("benchmark denies missing/wrong admin authentication before initialization", async () => {
  let initialized = false;
  const handler = createBenchmarkHandler({
    adminKey: () => "local-test-only",
    initialize: async () => {
      initialized = true;
      throw new Error();
    },
    fixtures: { gradient: "AA==" },
    expiresAt: Date.now() + 10000,
    memory: () => null,
  });
  assert.equal(
    (await handler(request(undefined, "Bearer anonymous"))).status,
    401,
  );
  assert.equal(initialized, false);
  assert.equal((await handler(request('{"fixture":"other"}'))).status, 400);
  assert.equal((await handler(request("x".repeat(129)))).status, 413);
  assert.equal(initialized, false);
});
test("benchmark enforces expiry and per-worker request ceiling without accepting image uploads", async () => {
  const deps = {
    adminKey: () => "local-test-only",
    initialize: async () => async () => ({
      full: new Uint8Array(2),
      thumbnail: new Uint8Array(1),
      width: 1,
      height: 1,
    }),
    fixtures: { gradient: "AA==" },
    expiresAt: Date.now() + 10000,
    memory: () => null,
  };
  assert.equal(
    (await createBenchmarkHandler({ ...deps, expiresAt: 0 })(request())).status,
    410,
  );
  const handler = createBenchmarkHandler(deps);
  for (let i = 0; i < 12; i++)
    assert.equal((await handler(request())).status, 200);
  assert.equal((await handler(request())).status, 429);
});
