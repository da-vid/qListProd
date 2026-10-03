import test from "node:test";
import assert from "node:assert/strict";
import { createClient } from "@supabase/supabase-js";
import { adapters } from "./sdk.ts";
import { createHandler } from "./handler.ts";
import { BUCKET } from "./engine.ts";
function sdk(fetcher: typeof fetch) {
  return adapters(
    createClient("https://synthetic.invalid", "fake-local-only", {
      global: { fetch: fetcher },
      auth: { persistSession: false, autoRefreshToken: false },
    }),
  );
}
test("continuation readiness uses only existing-bucket metadata and empty listing; never creates a bucket", async () => {
  const calls: string[] = [];
  const { storage } = sdk(async (input, init) => {
    const url = String(input);
    calls.push(url);
    if (url.endsWith("/object/list/" + BUCKET)) {
      assert.equal(init?.method, "POST");
      assert.equal(JSON.parse(String(init?.body)).limit, 1);
      return Response.json([]);
    }
    assert.equal(init?.method, "GET");
    assert(url.endsWith("/bucket/" + BUCKET));
    return Response.json({
      public: false,
      file_size_limit: 393216,
      allowed_mime_types: ["image/jpeg"],
    });
  });
  await storage.checkEmpty();
  assert.equal(calls.length, 2);
  for (const [status, body] of [
    [400, { code: "NoSuchBucket", statusCode: "404" }],
    [404, { code: "NoSuchBucket" }],
    [403, { code: "AccessDenied" }],
    [500, { code: "InternalError" }],
  ] as const) {
    let requests = 0;
    const missing = sdk(async (_input, init) => {
      requests++;
      assert.equal(init?.method, "GET");
      return Response.json(body, { status });
    });
    await assert.rejects(() => missing.storage.checkEmpty());
    assert.equal(requests, 1);
  }
});
test("continuation readiness rejects configuration drift, occupied listing and malformed listing envelopes", async () => {
  for (const bucket of [
    {
      public: true,
      file_size_limit: 393216,
      allowed_mime_types: ["image/jpeg"],
    },
    {
      public: false,
      file_size_limit: 999999,
      allowed_mime_types: ["image/jpeg"],
    },
    {
      public: false,
      file_size_limit: 393216,
      allowed_mime_types: ["image/png"],
    },
  ]) {
    await assert.rejects(
      () => sdk(async () => Response.json(bucket)).storage.checkEmpty(),
      /configuration_mismatch/,
    );
  }
  for (const listing of [[{ name: "phase-b", id: null }], {}, null]) {
    await assert.rejects(
      () =>
        sdk(async (input) =>
          Response.json(
            String(input).includes("/object/list/")
              ? listing
              : {
                  public: false,
                  file_size_limit: 393216,
                  allowed_mime_types: ["image/jpeg"],
                },
          ),
        ).storage.checkEmpty(),
      /bucket_not_empty/,
    );
  }
});
test("PostgREST failure envelopes preserve SQL fence errors without treating them as success", async () => {
  for (const message of [
    "writer_unsettled",
    "item_fenced",
    "continuation_already_claimed",
    "UPDATE requires a WHERE clause",
  ]) {
    const client = sdk(async () =>
      Response.json(
        { code: "P0001", details: null, hint: null, message },
        { status: 400 },
      ),
    );
    await assert.rejects(
      () => client.rpc("cleanup_begin", {}, new AbortController().signal),
      new RegExp(message),
    );
  }
});
test("continuation HTTP command is auth/expiry gated, rejects arbitrary fields and never auto-retries a lost claim", async () => {
  let authorized = false,
    connected = 0,
    claims = 0,
    closed = 0;
  const d = {
    authorize: async () => authorized,
    connect: () => {
      connected++;
      return {
        rpc: async (a: string) => {
          if (a === "continuation_claim") {
            claims++;
            throw Error("claim_response_lost");
          }
          closed++;
          throw Error("unexpected");
        },
        storage: {} as any,
      };
    },
    initialize: async () => {
      throw Error("codec_forbidden");
    },
    fixtures: {},
    expiresAt: 100,
    now: () => 0,
  };
  const h = createHandler(d);
  const req = (body: unknown) =>
    new Request("https://synthetic.invalid", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  assert.equal((await h(req({ command: "continuation" }))).status, 401);
  assert.equal(connected, 0);
  authorized = true;
  for (const extra of [
    { path: "any" },
    { owner: "chosen" },
    { reset: true },
    { fixture: "external" },
    { reason: "fake" },
  ]) {
    assert.equal(
      (await h(req({ command: "continuation", ...extra }))).status,
      409,
    );
  }
  assert.equal(connected, 0);
  assert.equal(
    (
      await createHandler({ ...d, now: () => 100 })(
        req({ command: "continuation" }),
      )
    ).status,
    410,
  );
  assert.equal(connected, 0);
  assert.equal((await h(req({ command: "continuation" }))).status, 409);
  assert.equal(claims, 1);
  assert.equal(closed, 0);
});
