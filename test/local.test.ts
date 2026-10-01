import { test } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { LocalStore } from "../src/local-store.ts";
const dom = new JSDOM("", { url: "http://localhost/AbC234" });
Object.assign(globalThis, { window: dom.window });
test("two local clients merge independent changes and deletion wins stale edits", async () => {
  const storage = dom.window.localStorage;
  storage.clear();
  const a = new LocalStore("AbC234", storage),
    b = new LocalStore("AbC234", storage);
  let state;
  const refresh = () =>
    a.subscribe(
      (s) => (state = s),
      () => {},
      (e) => {
        throw e;
      },
    )();
  await Promise.all([
    a.apply({
      type: "add",
      item: { key: "a", ID: "a", name: "A", checked: false, priority: 1 },
    }),
    b.apply({
      type: "add",
      item: { key: "b", ID: "b", name: "B", checked: false, priority: 2 },
    }),
  ]);
  await a.apply({ type: "check", key: "a", checked: true });
  await b.apply({ type: "edit", key: "a", name: "Edited" });
  refresh();
  assert.equal(state.items.length, 2);
  assert.equal(state.items[0].checked, true);
  assert.equal(state.items[0].name, "Edited");
  await a.apply({ type: "delete", key: "a" });
  await b.apply({ type: "edit", key: "a", name: "Stale" });
  refresh();
  assert.equal(state.items.length, 1);
});
test("storage failure rejects the write instead of reporting it saved", async () => {
  const store = new LocalStore("Fail23", {
    setItem() {
      throw new Error("Storage full");
    },
  } as Storage);
  await assert.rejects(
    store.apply({ type: "title", title: "Test" }),
    /Storage full/,
  );
});
