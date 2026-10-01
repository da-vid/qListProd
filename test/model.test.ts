import { test } from "node:test";
import assert from "node:assert/strict";
import { route, newID, validID, movePriority, ordered } from "../src/model.ts";
test("legacy case-sensitive links, trailing slash and lastList cookie survive", () => {
  assert.equal(route("/AbC234/", ""), "AbC234");
  assert.equal(route("/", "other=1; lastList=AbC234"), "AbC234");
  assert.notEqual(route("/new", "lastList=AbC234"), "AbC234");
  assert.throws(() => route("/bad/path", ""));
});
test("new links have 144 bits of randomness and are valid", () => {
  const ids = Array.from({ length: 1000 }, newID);
  assert.equal(new Set(ids).size, 1000);
  assert.ok(ids.every((x) => x.length === 36 && validID(x)));
});
test("moving an item changes only its priority with stable tie ordering", () => {
  const items = [0, 1, 2].map((i) => ({
    key: String(i),
    ID: i,
    name: String(i),
    checked: false,
    priority: i * 1024,
  }));
  assert.equal(movePriority(items, "2", -1), 512);
  assert.equal(movePriority(items, "0", 1), 1536);
  assert.equal(ordered([{ ...items[1], priority: 0 }, items[0]])[0].key, "0");
  assert.throws(() => movePriority(items, "0", -1));
});
