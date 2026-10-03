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
  a.add("key");
  b.add("other");
  a.remove("key");
  assert.deepEqual(b.load(), ["other"]);
  assert.deepEqual(cleanupJournal(store, "different").load(), []);
  assert.deepEqual(cleanupJournal(store, "PhotoDemo").load(), ["other"]);
  b.remove("other");
  for (let n = 0; n < 100; n++) a.add(String(n));
  assert.throws(() => a.add("overflow"));
  a.add("0");
  for (const value of data.values()) assert.equal(value, "1");
  data.set("qlist.photo.cleanup.v1:PhotoDemo:corrupt", "not a marker");
  assert.throws(() => a.load());
});
