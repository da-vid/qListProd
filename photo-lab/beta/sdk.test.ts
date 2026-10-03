import test from "node:test";
import assert from "node:assert/strict";
import { sdkPorts, BETA_BUCKET } from "./sdk.ts";
import { createBetaHandler } from "./handler.ts";
import { fixture, signal } from "./test-support.ts";
const key = "beta-v1/00000000-0000-0000-0000-000000000000/full.jpg";
test("Storage adapter rejects public/drifted bucket and uses immutable server-derived JPEG keys", async () => {
  let publicBucket = false,
    upload: any;
  const ports = sdkPorts({
    storage: {
      from: (bucket: string) => {
        assert.equal(bucket, BETA_BUCKET);
        return {
          upload: async (...args: any[]) => {
            upload = args;
            return { data: {} };
          },
        };
      },
      getBucket: async () => ({
        data: {
          public: publicBucket,
          file_size_limit: 393216,
          allowed_mime_types: ["image/jpeg"],
        },
      }),
    },
  });
  await ports.checkBucket();
  publicBucket = true;
  await assert.rejects(() => ports.checkBucket());
  await ports.storage.put(key, new Uint8Array([1]), signal());
  assert.equal(upload[2].upsert, false);
  assert.equal(upload[2].contentType, "image/jpeg");
  await assert.rejects(() =>
    ports.storage.put("../other", new Uint8Array([1]), signal()),
  );
});
test("absence proof requires exact NoSuchKey; ambiguous responses never release charges", async () => {
  let error: any;
  const ports = sdkPorts({
    storage: { from: () => ({ info: async () => ({ error }) }) },
  });
  for (error of [
    { code: "NoSuchKey", status: 404 },
    { code: "NoSuchKey", status: 400, statusCode: 404 },
  ])
    assert.equal(await ports.storage.exists(key, signal()), false);
  for (error of [
    { status: 404 },
    { code: "NoSuchBucket", status: 404 },
    { code: "AccessDenied", status: 403 },
    { code: "NoSuchKey", status: 500 },
  ])
    await assert.rejects(() => ports.storage.exists(key, signal()));
  error = undefined;
  assert.equal(await ports.storage.exists(key, signal()), true);
});
test("CORS is a browser boundary, no-origin link holders work, client secrets are rejected", async () => {
  const f = await fixture();
  const url = "http://127.0.0.1/photo?action=get&list=PhotoDemo&item=item&id=";
  assert.equal(
    (
      await f.handler(
        new Request(url, {
          method: "POST",
          headers: { origin: "https://wrong.invalid" },
        }),
      )
    ).status,
    403,
  );
  assert.equal(
    (await f.handler(new Request(url, { method: "POST" }))).status,
    200,
  );
  assert.equal(
    (
      await f.handler(
        new Request(url, {
          method: "POST",
          headers: { apikey: "synthetic-not-a-real-key" },
        }),
      )
    ).status,
    400,
  );
  assert.equal(
    (
      await f.handler(
        new Request(url, {
          method: "POST",
          headers: { origin: "http://127.0.0.1:4174" },
        }),
      )
    ).headers.get("access-control-allow-origin"),
    "http://127.0.0.1:4174",
  );
});
