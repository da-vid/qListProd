import test from "node:test";
import assert from "node:assert/strict";
import { fixture, signal, upload } from "../photo-lab/beta/test-support.ts";
import { MemoryLedger, scope } from "../photo-lab/beta/ledger.ts";
import { HttpPhotoGateway } from "../src/photo/http-gateway.ts";
import { sdkPorts } from "../photo-lab/beta/sdk.ts";

test("public namespaces need no text existence proof and all photo operations make zero network calls", async () => {
  const f = await fixture(),
    ledger = f.ledger as MemoryLedger;
  ledger.value.control = {
    enabled: true,
    maintenance: true,
    lists: [],
    allLists: true,
  };
  const client = (list: string) =>
    new HttpPhotoGateway("http://127.0.0.1/photo", list, async (input, init) =>
      f.handler(new Request(String(input), init)),
    );
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    throw Error("Unexpected network access, including Firebase");
  };
  try {
    const a = client("NeverCreatedInFirebase"),
      b = client("AnotherPublicNamespace"),
      u = upload(f.jpeg);
    assert.equal(await a.get("invented", signal()), undefined);
    const ap = await a.put("invented", null, u, signal());
    const bp = await b.put("invented", null, upload(f.jpeg), signal());
    assert.equal((await a.status(u.operationId, signal()))?.state, "committed");
    await assert.rejects(() => b.put("invented", 0, u, signal()), /changed/);
    await f.engine.reconcile("NeverCreatedInFirebase", signal());
    await a.remove("invented", ap.version, signal());
    const next = await a.put("invented", null, upload(f.jpeg), signal());
    await assert.rejects(
      () => a.remove("invented", ap.version, signal()),
      /changed/,
    );
    assert.equal((await a.get("invented", signal()))?.version, next.version);
    assert.equal((await b.get("invented", signal()))?.version, bp.version);
    assert.equal(calls, 0);
  } finally {
    globalThis.fetch = original;
  }
});

test("malformed namespaces fail before storage; invented namespaces share one global cap", async () => {
  const f = await fixture(),
    l = f.ledger as MemoryLedger;
  l.value.control = {
    enabled: true,
    maintenance: true,
    lists: [],
    allLists: true,
  };
  let now = Date.now();
  Object.defineProperty(f.engine, "now", { value: () => now });
  const client = (list: string) =>
    new HttpPhotoGateway("http://127.0.0.1/photo", list, async (input, init) =>
      f.handler(new Request(String(input), init)),
    );
  for (const [list, item] of [
    ["", "x"],
    ["new", "x"],
    ["__proto__", "x"],
    ["a/b", "x"],
    ["a", "__proto__"],
    ["a", "a.b"],
    ["a", ""],
    ["x".repeat(769), "x"],
    ["a", "bad\u0000key"],
  ]) {
    await assert.rejects(() =>
      client(list).put(item, null, upload(f.jpeg), signal()),
    );
  }
  assert.equal(f.puts, 0);
  for (let n = 0; n < 85; n++) {
    now += 60000;
    await client("Invented" + n).put(
      "arbitrary",
      null,
      upload(f.jpeg),
      signal(),
    );
  }
  now += 60000;
  await assert.rejects(
    () =>
      client("YetAnotherNamespace").put(
        "arbitrary",
        null,
        upload(f.jpeg),
        signal(),
      ),
    /full/,
  );
  assert.equal(f.puts, 85);
  const a = client("Invented0"),
    p = await a.get("arbitrary", signal());
  assert(p);
  await a.remove("arbitrary", p.version, signal());
  assert.equal(f.paths.size, 84);
});

test("empty-photo revisions prevent stale resurrection and stale removal cannot erase a re-added photo", async () => {
  const f = await fixture();
  await f.client.get("item", signal());
  const oldEmpty = f.client.observedVersion("item")!;
  const p = await f.client.put("item", oldEmpty, upload(f.jpeg), signal());
  await f.client.remove("item", p.version, signal());
  await assert.rejects(
    () => f.client.put("item", oldEmpty, upload(f.jpeg), signal()),
    /changed/,
  );
  assert.equal(await f.client.get("item", signal()), undefined);
  const empty = f.client.observedVersion("item")!;
  assert(empty > p.version);
  const fresh = await f.client.put("item", empty, upload(f.jpeg), signal());
  await assert.rejects(
    () => f.client.remove("item", p.version, signal()),
    /changed/,
  );
  assert.equal((await f.client.get("item", signal()))?.version, fresh.version);
});

test("production Storage and ledger are distinct from beta and admin trial resources", async () => {
  const calls: string[] = [];
  const admin = {
    storage: {
      from: (name: string) => {
        calls.push(name);
        return {};
      },
      getBucket: async (name: string) => {
        calls.push(name);
        return {
          data: {
            public: false,
            file_size_limit: 393216,
            allowed_mime_types: ["image/jpeg"],
          },
        };
      },
    },
    rpc: (name: string) => {
      calls.push(name);
      return { abortSignal: async () => ({ data: { revision: 0 } }) };
    },
  };
  const ports = sdkPorts(admin, true);
  await ports.checkBucket();
  await ports.ledger.load(signal());
  assert.deepEqual(calls, [
    "qlist-photos-v1",
    "qlist-photos-v1",
    "qlist_photos_load",
  ]);
});
