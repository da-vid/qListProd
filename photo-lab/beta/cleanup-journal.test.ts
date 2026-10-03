import test from "node:test";
import assert from "node:assert/strict";
import { cleanupJournal } from "../../src/photo/cleanup-journal.ts";
test("cleanup intents survive restoration, stay list-scoped and cannot overwrite another tab’s item marker", () => {
  const data = new Map<string, string>();
  const store = {
    get length() {
      return data.size;
    },
    key: (n: number) => [...data.keys()][n] ?? null,
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => {
      data.set(k, v);
    },
    removeItem: (k: string) => {
      data.delete(k);
    },
  };
  const a = cleanupJournal(store, "PhotoDemo"),
    b = cleanupJournal(store, "PhotoDemo");
  a.add({ key: "key", version: 1 });
  b.add({ key: "other", version: 2 });
  a.remove({ key: "key", version: 1 });
  assert.deepEqual(b.load(), [{ key: "other", version: 2 }]);
  assert.deepEqual(cleanupJournal(store, "different").load(), []);
  assert.deepEqual(cleanupJournal(store, "PhotoDemo").load(), [
    { key: "other", version: 2 },
  ]);
  b.remove({ key: "other", version: 2 });
  a.add({ key: "same", version: 1 });
  b.add({ key: "same", version: 2 });
  a.remove({ key: "same", version: 1 });
  assert.deepEqual(b.load(), [{ key: "same", version: 2 }]);
  b.remove({ key: "same", version: 2 });
  data.set("qlist.photo.cleanup.v1:PhotoDemo:old", "1");
  assert.deepEqual(a.load(), []); // Never replay old unversioned hints.
  for (let n = 0; n < 100; n++) a.add({ key: String(n), version: 1 });
  assert.throws(() => a.add({ key: "overflow", version: 1 }));
  a.add({ key: "0", version: 1 });
  for (const value of data.values()) assert.equal(value, "1");
  data.set("qlist.photo.cleanup.v2:PhotoDemo:corrupt", "not a marker");
  assert.throws(() => a.load());
});
