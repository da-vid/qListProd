import test from "node:test";
import assert from "node:assert/strict";
import { createClient } from "@supabase/supabase-js";
import { adapters } from "./sdk.ts";
import { createHandler } from "./handler.ts";
import { BUCKET } from "./engine.ts";
const key = "phase-b/PhotoDemo/phaseb-sdk/full.jpg";
const req = (
  body: unknown,
  headers: Record<string, string> = { "content-type": "application/json" },
) =>
  new Request("https://test.invalid", {
    method: "POST",
    headers,
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
const handler = (overrides: Record<string, unknown> = {}) => {
  let calls = 0;
  return {
    get calls() {
      return calls;
    },
    fetch: createHandler({
      authorize: async () => true,
      connect: () => {
        calls++;
        return {
          rpc: async () => ({ physical_operations: [], budgets: [] }),
          storage: {} as any,
        };
      },
      initialize: async () => {
        throw Error("codec_not_needed");
      },
      fixtures: {},
      expiresAt: 100,
      now: () => 0,
      ...overrides,
    }),
  };
};
test("unauthorized, expired and malformed requests never connect to privileged services", async () => {
  const unauthorized = handler({ authorize: async () => false });
  assert.equal((await unauthorized.fetch(req({ command: "run" }))).status, 401);
  assert.equal(unauthorized.calls, 0);
  const expired = handler({ now: () => 100 });
  assert.equal((await expired.fetch(req({ command: "run" }))).status, 410);
  assert.equal(expired.calls, 0);
  for (const body of [
    { command: "run", path: "x" },
    { command: "run", objectsAbsent: true },
    { command: "reset" },
    null,
    [],
    "bad json",
    "x".repeat(129),
  ]) {
    const h = handler();
    assert.notEqual((await h.fetch(req(body))).status, 200);
    assert.equal(h.calls, 0);
  }
});
test("wrong media type, encoding and dishonest body length fail before connecting", async () => {
  for (const headers of [
    { "content-type": "image/jpeg" },
    { "content-type": "application/json", "content-encoding": "gzip" },
    { "content-type": "application/json", "content-length": "999" },
  ]) {
    const h = handler();
    assert.notEqual(
      (await h.fetch(req({ command: "status" }, headers))).status,
      200,
    );
    assert.equal(h.calls, 0);
  }
});
test("status/reconcile do not initialize codec or create bucket; errors are sanitized", async () => {
  const h = handler();
  for (const command of ["status", "reconcile"]) {
    const r = await h.fetch(req({ command }));
    assert.equal(r.status, 200);
    assert.equal(r.headers.get("cache-control"), "no-store");
  }
  const failing = handler({
    connect: () => {
      throw Error("FAKE_PRIVATE_TEST_VALUE");
    },
  });
  const r = await failing.fetch(req({ command: "run" }));
  assert.equal(r.status, 409);
  assert(!(await r.text()).includes("FAKE_PRIVATE_TEST_VALUE"));
});
test("stalled body and uncooperative RPC have bounded lifetimes", async () => {
  let canceled = false;
  const stream = new ReadableStream({
    pull() {
      return new Promise(() => {});
    },
    cancel() {
      canceled = true;
    },
  });
  const h = handler({ timeoutMs: 25 });
  const r = await h.fetch(
    new Request("https://test.invalid", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: stream,
      duplex: "half",
    } as RequestInit),
  );
  assert.equal(r.status, 504);
  assert(canceled);
  assert.equal(h.calls, 0);
  const slow = handler({
    timeoutMs: 25,
    connect: () => ({ rpc: () => new Promise(() => {}), storage: {} }),
  });
  assert.equal((await slow.fetch(req({ command: "status" }))).status, 504);
});
function sdk(fetcher: typeof fetch) {
  return adapters(
    createClient(
      "https://synthetic.invalid",
      "not-a-valid-key-local-test-only",
      {
        global: { fetch: fetcher },
        auth: { persistSession: false, autoRefreshToken: false },
      },
    ),
  ).storage;
}
test("official SDK creates exactly the restricted bucket and refuses drift or ambiguous absence", async () => {
  let created = false,
    posts = 0;
  const client = sdk(async (input, init) => {
    const url = String(input);
    if (url.endsWith("/object/list/" + BUCKET)) {
      assert.equal(JSON.parse(String(init?.body)).limit, 1);
      return Response.json([]);
    }
    assert(url.endsWith("/bucket") || url.endsWith("/bucket/" + BUCKET));
    if (init?.method === "POST") {
      posts++;
      const body = JSON.parse(String(init.body));
      assert.equal(body.public, false);
      assert.equal(body.file_size_limit, 393216);
      assert.deepEqual(body.allowed_mime_types, ["image/jpeg"]);
      created = true;
      return Response.json({ name: BUCKET });
    }
    return created
      ? Response.json({
          public: false,
          file_size_limit: 393216,
          allowed_mime_types: ["image/jpeg"],
        })
      : Response.json(
          { code: "NoSuchBucket", message: "Missing" },
          { status: 404 },
        );
  });
  await client.setup();
  await client.setup();
  assert.equal(posts, 1);
  const drift = sdk(async () =>
    Response.json({
      public: true,
      file_size_limit: 393216,
      allowed_mime_types: ["image/jpeg"],
    }),
  );
  await assert.rejects(() => drift.setup(), /configuration_mismatch/);
  const denied = sdk(async () =>
    Response.json({ code: "TenantNotFound" }, { status: 404 }),
  );
  await assert.rejects(() => denied.setup(), /lookup_failed/);
  const occupied = sdk(async (input) =>
    String(input).includes("/object/list/")
      ? Response.json([{ name: "existing-folder" }])
      : Response.json({
          public: false,
          file_size_limit: 393216,
          allowed_mime_types: ["image/jpeg"],
        }),
  );
  await assert.rejects(() => occupied.setup(), /bucket_not_empty/);
});
test("official SDK upload uses JPEG bytes, no overwrite, and only reviewed immutable keys", async () => {
  let calls = 0;
  const bytes = new Uint8Array([255, 216, 255, 217]);
  const client = sdk(async (input, init) => {
    calls++;
    assert(String(input).endsWith("/object/" + BUCKET + "/" + key));
    assert.equal(init?.method, "POST");
    const headers = new Headers(init?.headers);
    assert.equal(headers.get("x-upsert"), "false");
    assert.equal(headers.get("content-type"), "image/jpeg");
    assert.deepEqual(init?.body, bytes);
    return Response.json({ Key: BUCKET + "/" + key, Id: "synthetic-id" });
  });
  await client.put(key, bytes);
  await assert.rejects(
    () => client.put("../arbitrary", bytes),
    /unsafe_storage_key/,
  );
  assert.equal(calls, 1);
});
test("official SDK stream download, physical remove, and strict NoSuchKey verification", async () => {
  let calls = 0;
  const client = sdk(async (input, init) => {
    calls++;
    const url = String(input);
    if (init?.method === "DELETE") {
      assert.deepEqual(JSON.parse(String(init.body)).prefixes, [key]);
      return Response.json([{ name: key }]);
    }
    if (url.includes("/object/info/"))
      return Response.json(
        { code: "NoSuchKey", message: "Missing" },
        { status: 404 },
      );
    return new Response(new Uint8Array([1, 2, 3]));
  });
  const reader = (await client.read(key)).getReader();
  assert.deepEqual((await reader.read()).value, new Uint8Array([1, 2, 3]));
  await reader.cancel();
  await client.remove([key]);
  assert.equal(await client.exists(key), false);
  assert.equal(calls, 3);
  for (const [status, code] of [
    [400, "InvalidRequest"],
    [403, "AccessDenied"],
    [404, "TenantNotFound"],
    [500, "InternalError"],
  ] as const) {
    const uncertain = sdk(async () => Response.json({ code }, { status }));
    await assert.rejects(() => uncertain.exists(key), /absence_unverified/);
  }
});
