import test from "node:test";
import assert from "node:assert/strict";
import { fixture, signal, upload } from "../photo-lab/beta/test-support.ts";
import { MemoryLedger, scope } from "../photo-lab/beta/ledger.ts";
import { HttpPhotoGateway } from "../src/photo/http-gateway.ts";
import { sdkPorts } from "../photo-lab/beta/sdk.ts";

test("general access requires a real claim/item and keeps identical item keys isolated between lists", async () => {
  const f = await fixture(),
    ledger = f.ledger as MemoryLedger;
  ledger.value.control = {
    enabled: true,
    maintenance: true,
    lists: [],
    allLists: true,
  };
  Object.defineProperty(f.engine, "text", {
    value: async (list: string, item: string) => ({
      listExists: ["OneList", "TwoList"].includes(list),
      itemExists: ["OneList", "TwoList"].includes(list) && item === "item",
      itemAbsent: ["OneList", "TwoList"].includes(list) && item === "deleted",
    }),
  });
  const client = (list: string) =>
    new HttpPhotoGateway("http://127.0.0.1/photo", list, async (input, init) =>
      f.handler(new Request(String(input), init)),
    );
  const a = client("OneList"),
    b = client("TwoList"),
    u = upload(f.jpeg);
  await assert.rejects(
    () => client("Unclaimed").put("item", null, upload(f.jpeg), signal()),
    /unavailable/,
  );
  await assert.rejects(
    () => a.put("missing", null, upload(f.jpeg), signal()),
    /unavailable/,
  );
  assert.equal(f.puts, 0);
  const ap = await a.put("item", null, u, signal());
  const bp = await b.put("item", null, upload(f.jpeg), signal());
  await assert.rejects(() => b.put("item", null, u, signal()), /changed/);
  assert.equal(
    await f.engine.status("TwoList", "item", u.operationId, signal()),
    undefined,
  );
  await a.remove("item", ap.version, signal());
  assert.equal((await b.get("item", signal()))?.version, bp.version);
  assert.equal(
    ledger.value.state.items[scope("OneList", "item")].current,
    undefined,
  );
  assert(ledger.value.state.items[scope("TwoList", "item")].current);
  assert.equal(f.paths.size, 1);
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
