import test from "node:test";
import assert from "node:assert/strict";
import { fixture, signal, upload } from "./test-support.ts";
import { BetaEngine } from "./engine.ts";
import { MemoryLedger, PROJECT, RESERVATION, scope } from "./ledger.ts";
import { createBetaHandler } from "./handler.ts";
import { firebaseTextAuthority } from "./text-authority.ts";

test("present or malformed text never authorizes item deletion; photo-only remove allows re-add", async () => {
  const f = await fixture();
  const photo = await f.client.put("item", null, upload(f.jpeg), signal());
  await assert.rejects(
    () => f.client.deleteItem("item", signal()),
    /not confirmed/,
  );
  assert.equal(f.paths.size, 1);
  assert.equal(
    (await f.ledger.load(signal())).state.items[scope("PhotoDemo", "item")]
      .deleted,
    false,
  );
  const original = f.engine.text;
  for (const value of [{}, { name: "bad" }, [], false, "", 0]) {
    const text = firebaseTextAuthority(async (url) =>
      Response.json(String(url).includes("listClaims") ? true : value),
    );
    const check = await text("PhotoDemo", "item", signal());
    assert.equal(check.itemAbsent, false);
    Object.defineProperty(f.engine, "text", {
      value: text,
      configurable: true,
    });
    await assert.rejects(
      () => f.client.deleteItem("item", signal()),
      /not confirmed/,
    );
    await f.engine.reconcile("PhotoDemo", signal());
    assert.equal(f.paths.size, 1);
  }
  Object.defineProperty(f.engine, "text", { value: original });
  await f.client.remove("item", photo.version, signal());
  const replacement = await f.client.put(
    "item",
    null,
    upload(f.jpeg),
    signal(),
  );
  assert(replacement.version > photo.version);
});

test("reads, status and confirmed deletion work with uploads disabled and storage exhausted; no product expiry", async () => {
  const f = await fixture(),
    l = f.ledger as MemoryLedger,
    u = upload(f.jpeg);
  await f.client.put("item", null, u, signal());
  const legacy = structuredClone(l.value.legacy);
  Object.defineProperty(f.engine, "now", {
    value: () => Date.now() + 90 * 86400000,
  });
  // There is no seven-day product gate. Actual legacy expiry/data are never edited.
  assert(await f.client.get("item", signal()));
  l.value.control.enabled = false;
  l.value.legacy.bytes = PROJECT.bytes;
  l.value.state.requests = 100000;
  l.value.state.readBytes = 2 ** 30;
  const handler = createBetaHandler({
    enabled: false,
    maintenanceEnabled: true,
    origins: [],
    connect: async () => f.engine,
  });
  const call = (action: string, id = "") =>
    handler(
      new Request(
        "http://127.0.0.1/?" +
          new URLSearchParams({ action, list: "PhotoDemo", item: "item", id }),
        { method: "POST" },
      ),
    );
  assert.equal((await call("get")).status, 200);
  const beforeStatus = await l.load(signal());
  assert.equal((await call("status", u.operationId)).status, 200);
  assert.deepEqual(l.value.state.ops, beforeStatus.state.ops);
  assert.equal((await call("put", crypto.randomUUID() + ":0")).status, 503);
  f.textItems.delete("item");
  assert.equal((await call("delete")).status, 200);
  assert.equal(f.paths.size, 0);
  assert.equal(l.value.legacy.operations, legacy.operations);
});

test("restart without browser journal: ordinary reads reconcile a server-known orphan only after authoritative NULL", async () => {
  const f = await fixture();
  await f.client.put("item", null, upload(f.jpeg), signal());
  f.textItems.delete("item");
  const restored = new MemoryLedger(
    JSON.parse(JSON.stringify(await f.ledger.load(signal()))),
  );
  restored.value.control.enabled = false;
  const engine = new BetaEngine({
    ledger: restored,
    storage: f.storage,
    process: f.engine.process,
    text: f.engine.text,
  });
  const handler = createBetaHandler({
    enabled: false,
    maintenanceEnabled: true,
    origins: [],
    connect: async () => engine,
  });
  // A different surviving item triggers the bounded scan, without original client IDs/markers.
  const req = () =>
    new Request("http://127.0.0.1/?action=get&list=PhotoDemo&item=other&id=", {
      method: "POST",
    });
  f.textAvailable = false;
  await engine.reconcile("PhotoDemo", signal());
  assert.equal(f.paths.size, 1);
  f.textAvailable = true;
  assert.equal((await handler(req())).status, 200);
  assert.equal(f.paths.size, 0);
  assert.equal(
    restored.value.state.items[scope("PhotoDemo", "item")].deleted,
    true,
  );
});

test("late immutable write receipt after deletion settles then cleans; missing unknown outcome never refunds", async () => {
  const f = await fixture(),
    u = upload(f.jpeg);
  let release!: () => void, start!: () => void;
  const started = new Promise<void>((r) => (start = r));
  f.putHook = async () => {
    start();
    await new Promise<void>((r) => (release = r));
  };
  const pending = f.client.put("item", null, u, signal()).then(
    () => false,
    () => true,
  );
  await started;
  f.textItems.delete("item");
  (f.ledger as MemoryLedger).value.control.enabled = false;
  await f.client.deleteItem("item", signal());
  await f.engine.reconcile("PhotoDemo", signal());
  assert.equal(
    (await f.ledger.load(signal())).state.ops[u.operationId].writes[0],
    "writing",
  );
  release();
  assert(await pending);
  assert.equal(f.paths.size, 0);
  assert.equal(
    (await f.ledger.load(signal())).state.ops[u.operationId].state,
    "released",
  );
  const g = await fixture(),
    v = upload(g.jpeg);
  g.putHook = async () => {
    throw Error("ambiguous");
  };
  await assert.rejects(() => g.client.put("item", null, v, signal()));
  const l = g.ledger as MemoryLedger;
  l.value.state.ops[v.operationId].lease = 1;
  for (let i = 0; i < 3; i++) await g.engine.reconcile("PhotoDemo", signal());
  assert.equal(l.value.state.ops[v.operationId].state, "cleanup");
  assert.equal(l.value.state.ops[v.operationId].writes[0], "writing");
  assert.equal(
    Object.values(l.value.state.ops).filter((o) => o.state !== "released")
      .length * RESERVATION,
    393216,
  );
});

test("cleanup failure survives restart and retries without text authority or upload admission", async () => {
  const f = await fixture();
  const p = await f.client.put("item", null, upload(f.jpeg), signal());
  f.cleanupFails = true;
  await assert.rejects(() => f.client.remove("item", p.version, signal()));
  const restored = new MemoryLedger(
    JSON.parse(JSON.stringify(await f.ledger.load(signal()))),
  );
  restored.value.control.enabled = false;
  f.textAvailable = false;
  f.cleanupFails = false;
  const engine = new BetaEngine({
    ledger: restored,
    storage: f.storage,
    text: f.engine.text,
    process: f.engine.process,
  });
  await engine.reconcile("PhotoDemo", signal());
  assert.equal(f.paths.size, 0);
  assert(
    Object.values(restored.value.state.ops).every(
      (o) => o.state === "released",
    ),
  );
});
