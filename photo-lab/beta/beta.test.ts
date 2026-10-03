import test from "node:test";
import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";
import { fixture, signal, upload } from "./test-support.ts";
import { MemoryLedger, RESERVATION, PROJECT, transact } from "./ledger.ts";
import { createBetaHandler } from "./handler.ts";
import { firebaseTextAuthority } from "./text-authority.ts";
import { HttpPhotoGateway } from "../../src/photo/http-gateway.ts";
const req = (
  action: string,
  list = "PhotoDemo",
  item = "item",
  id = "",
  body?: Blob,
) =>
  new Request(
    "http://127.0.0.1/photo?" + new URLSearchParams({ action, list, item, id }),
    {
      method: "POST",
      body,
      headers: body ? { "content-type": "image/jpeg" } : {},
    },
  );
test("disabled defaults deny before connection; no credential or public client policy", async () => {
  let connections = 0;
  const handler = createBetaHandler({
    enabled: false,
    origins: [],
    connect: async () => {
      connections++;
      throw Error("unexpected");
    },
  });
  assert.equal((await handler(req("get"))).status, 503);
  assert.equal(connections, 0);
  const f = await fixture();
  (f.ledger as MemoryLedger).value.control.enabled = false;
  assert.equal((await f.handler(req("get"))).status, 200);
  assert.equal(f.reads, 0);
});
test("anonymous same-link request verifies authoritative text and protects scope for all routes", async () => {
  const f = await fixture();
  for (const list of ["Missing", "PhotoDemo/other", "new", "__proto__"])
    assert.notEqual((await f.handler(req("get", list))).status, 200);
  for (const item of ["missing", "../item", "a/b", "__proto__"])
    assert.notEqual(
      (
        await f.handler(
          req("put", "PhotoDemo", item, crypto.randomUUID() + ":0", f.jpeg),
        )
      ).status,
      200,
    );
  assert.equal(f.puts, 0);
  const request = upload(f.jpeg),
    record = await f.client.put("item", null, request, signal());
  assert(record.full.size > 0);
  assert.equal(f.puts, 1);
  const stranger = new HttpPhotoGateway(
    "http://127.0.0.1:4175/photo",
    "PhotoDemo",
    async (input, init) => f.handler(new Request(String(input), init)),
  );
  assert.equal((await stranger.get("item", signal()))?.version, record.version);
  assert.equal(
    await (
      await f.handler(req("status", "PhotoDemo", "other", request.operationId))
    ).json(),
    null,
  );
  await stranger.remove("item", record.version, signal());
  assert.equal(f.paths.size, 0);
  const readded = await stranger.put("item", null, upload(f.jpeg), signal());
  assert(readded.version > record.version);
});
test("empty, malformed, progressive, oversize and metadata inputs fail before physical storage", async () => {
  const f = await fixture();
  for (const blob of [
    new Blob([], { type: "image/jpeg" }),
    new Blob(
      [
        await readFile(
          new URL("../fixtures/browser/progressive.jpg", import.meta.url),
        ),
      ],
      { type: "image/jpeg" },
    ),
    new Blob(
      [
        await readFile(
          new URL("../fixtures/browser/orientation-6.jpg", import.meta.url),
        ),
      ],
      { type: "image/jpeg" },
    ),
    new Blob(["fake"], { type: "image/jpeg" }),
    new Blob([new Uint8Array(524289)], { type: "image/jpeg" }),
    new Blob(["png"], { type: "image/png" }),
  ]) {
    const response = await f.handler(
      req("put", "PhotoDemo", "item", crypto.randomUUID() + ":0", blob),
    );
    assert(response.status >= 400);
  }
  assert.equal(f.puts, 0);
  assert(
    Object.values((await f.ledger.load(signal())).state.ops).every(
      (o) => o.state === "released",
    ),
  );
});
test("same operation replay and changed fingerprint cannot upload twice or restore superseded current photo", async () => {
  const f = await fixture(),
    u = upload(f.jpeg),
    a = await f.client.put("item", null, u, signal());
  await f.client.put("item", null, u, signal());
  assert.equal(f.puts, 1);
  const b = await f.client.put("item", a.version, upload(f.jpeg), signal());
  await f.client.put("item", null, u, signal());
  assert.equal((await f.client.get("item", signal()))?.version, b.version);
  assert.equal(f.puts, 2);
  await assert.rejects(
    () => f.client.put("other", null, u, signal()),
    /changed/,
  );
});
test("deletion while PUT acknowledgment is withheld fences later commits and retains unknown charge", async () => {
  const f = await fixture();
  let release!: () => void, started!: () => void;
  const ready = new Promise<void>((r) => (started = r));
  f.putHook = async () => {
    started();
    await new Promise<void>((r) => (release = r));
  };
  const u = upload(f.jpeg);
  const pending = f.client.put("item", null, u, signal()).then(
    () => false,
    () => true,
  );
  await ready;
  f.textItems.delete("item");
  await f.client.deleteItem("item", signal());
  let op = (await f.ledger.load(signal())).state.ops[u.operationId];
  assert.equal(op.state, "cleanup");
  assert.equal(op.writes[0], "writing");
  release();
  assert(await pending);
  assert.equal(f.paths.size, 0);
  op = (await f.ledger.load(signal())).state.ops[u.operationId];
  assert.equal(op.state, "released");
  assert.equal(
    (await f.ledger.load(signal())).state.items['["PhotoDemo","item"]'].current,
    undefined,
  );
});
test("failed PUT remains unknown across snapshot restoration; status retry never refunds or reuploads", async () => {
  const f = await fixture();
  f.putHook = async () => {
    throw Error("lost acknowledgment");
  };
  const u = upload(f.jpeg);
  await assert.rejects(() => f.client.put("item", null, u, signal()));
  const saved = await f.ledger.load(signal());
  const restored = new MemoryLedger(JSON.parse(JSON.stringify(saved)));
  const g = await fixture(restored);
  await g.engine.status("PhotoDemo", "item", u.operationId, signal());
  const op = (await restored.load(signal())).state.ops[u.operationId];
  assert.equal(op.writes[0], "writing");
  assert.equal(op.state, "cleanup");
  assert.equal(g.puts, 0);
});
test("cleanup failure retains both replacement charges; explicit retry and service restoration preserve current bytes", async () => {
  const f = await fixture(),
    a = await f.client.put("item", null, upload(f.jpeg), signal());
  f.cleanupFails = true;
  const b = await f.client.put("item", a.version, upload(f.jpeg), signal());
  assert.equal(f.paths.size, 2);
  assert.equal(
    Object.values((await f.ledger.load(signal())).state.ops).filter(
      (o) => o.state !== "released",
    ).length,
    2,
  );
  f.textAvailable = false;
  await assert.rejects(() => f.client.get("item", signal()));
  f.textAvailable = true;
  f.cleanupFails = false;
  await f.engine.cleanup("PhotoDemo", "item", signal());
  assert.equal(f.paths.size, 1);
  assert.equal((await f.client.get("item", signal()))?.version, b.version);
  await assert.rejects(
    () => f.client.remove("item", a.version, signal()),
    /changed/,
  );
});
test("global storage cap refuses new uploads without blocking reads or removal; upload rate is separate", async () => {
  const f = await fixture(),
    l = f.ledger as MemoryLedger;
  l.value.legacy.bytes = PROJECT.bytes - RESERVATION;
  const result = await Promise.allSettled(
    ["item", "other"].map((key) =>
      f.client.put(key, null, upload(f.jpeg), signal()),
    ),
  );
  assert.equal(result.filter((r) => r.status === "fulfilled").length, 1);
  assert.equal(f.puts, 1);
  const key = Object.values(l.value.state.items).find((i) => i.current)!.item;
  l.value.state.readBytes = 2 ** 30;
  l.value.state.reads = 10000;
  l.value.state.requests = 10000;
  assert(await f.client.get(key, signal()));
  l.value.state.minute = Math.floor(Date.now() / 60000);
  l.value.state.minuteRequests = 59;
  const rates = await Promise.allSettled([
    f.engine.admit("PhotoDemo", key, signal()),
    f.engine.admit("PhotoDemo", key, signal()),
  ]);
  assert.equal(rates.filter((r) => r.status === "fulfilled").length, 1);
  const photo = await f.client.get(key, signal());
  await f.client.remove(key, photo!.version, signal());
  assert.equal(f.paths.size, 0);
});
test("text disappears after processing; no commit and no stale read, kill switch keeps existing photos", async () => {
  const f = await fixture();
  const original = f.engine.process;
  const engine = f.engine;
  Object.defineProperty(engine, "process", {
    value: async (bytes: Uint8Array) => {
      const result = await original(bytes);
      f.textItems.delete("item");
      return result;
    },
  });
  await assert.rejects(() =>
    f.client.put("item", null, upload(f.jpeg), signal()),
  );
  assert.equal(f.paths.size, 0);
  const g = await fixture();
  await g.client.put("item", null, upload(g.jpeg), signal());
  (g.ledger as MemoryLedger).value.control.enabled = false;
  assert.equal((await g.handler(req("get"))).status, 200);
  assert.equal(g.paths.size, 1);
});
test("Firebase verifier is pinned, read-only, bounded and refuses malformed text without trusting caller claims", async () => {
  const urls: string[] = [];
  let value: any = { ID: "item", name: "Synthetic apples", checked: false };
  const verify = firebaseTextAuthority(async (input, init) => {
    urls.push(String(input));
    assert.equal(init?.method, "GET");
    assert.equal(init?.credentials, "omit");
    return Response.json(String(input).includes("listClaims") ? true : value);
  });
  assert.deepEqual(await verify("Synthetic list", "item", signal()), {
    listExists: true,
    itemExists: true,
    itemAbsent: false,
  });
  assert(
    urls.every((u) => u.startsWith("https://qwiklist.firebaseio.com/v2/")),
  );
  assert(urls[0].includes("Synthetic%20list"));
  for (value of [
    null,
    {},
    { ID: "item", name: " ", checked: false },
    { ID: "item", name: "x", checked: "false" },
    { ID: "item", name: "x", checked: false, photo: "forged" },
  ])
    assert.equal(
      (await verify("PhotoDemo", "item", signal())).itemExists,
      false,
    );
  await assert.rejects(() => verify("PhotoDemo", "../item", signal()));
});

test("unknown writes stay charged without permanently occupying encoding slots; expired never-written saves are fenced", async () => {
  const f = await fixture();
  f.putHook = async () => {
    throw Error("unknown write");
  };
  for (const key of ["item", "other"])
    await assert.rejects(() =>
      f.client.put(key, null, upload(f.jpeg), signal()),
    );
  f.textItems.add("third");
  f.putHook = undefined;
  await f.client.put("third", null, upload(f.jpeg), signal());
  assert.equal(
    Object.values((await f.ledger.load(signal())).state.ops).filter((o) =>
      o.writes.includes("writing"),
    ).length,
    2,
  );
  assert.equal(f.puts, 3);
  const g = await fixture();
  let now = Date.now();
  Object.defineProperty(g.engine, "now", { value: () => now });
  const id = crypto.randomUUID();
  const controller = new AbortController();
  let release!: () => void, started!: () => void;
  const ready = new Promise<void>((r) => (started = r));
  const process = g.engine.process;
  Object.defineProperty(g.engine, "process", {
    value: async (bytes: Uint8Array) => {
      started();
      await new Promise<void>((r) => (release = r));
      return process(bytes);
    },
  });
  const pending = g.client
    .put("item", null, { operationId: id, jpeg: g.jpeg }, controller.signal)
    .then(
      () => false,
      () => true,
    );
  await ready;
  now += 31000;
  await g.engine.reconcile("PhotoDemo", signal());
  release();
  assert(await pending);
  assert.equal(g.puts, 0);
  assert.equal((await g.ledger.load(signal())).state.ops[id].state, "released");
});
