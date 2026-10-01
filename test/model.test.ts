import { test } from "node:test";
import assert from "node:assert/strict";
import {
  route,
  newID,
  validID,
  movePriority,
  moveBeforePriority,
  ordered,
  routeRequest,
  reserveGeneratedID,
} from "../src/model.ts";
test("legacy case-sensitive links, trailing slash and lastList cookie survive", () => {
  assert.equal(route("/AbC234/", ""), "AbC234");
  assert.equal(route("/", "other=1; lastList=AbC234"), "AbC234");
  assert.notEqual(route("/new", "lastList=AbC234"), "AbC234");
  assert.throws(() => route("/bad/path", ""));
});
test("new links use six cryptographically generated characters", () => {
  const ids = Array.from({ length: 1000 }, newID);
  assert.equal(new Set(ids).size, 1000);
  assert.ok(ids.every((x) => x.length === 6 && validID(x)));
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

test("custom names, short IDs, encoded names and longer legacy IDs round-trip", () => {
  for (const id of [
    "a",
    "shopping-list",
    "Team Notes",
    "東京",
    "a:b",
    "literal?name",
    "A".repeat(200),
  ]) {
    assert.equal(route("/" + encodeURIComponent(id), ""), id);
    assert.equal(route("/", "lastList=" + encodeURIComponent(id)), id);
  }
  for (const path of [
    "/bad%2Fpath",
    "/bad.name",
    "/bad%23name",
    "/bad%24name",
    "/bad%5Bname",
    "/bad%00name",
    "/%zz",
    "/x?other=list",
    "/x#fragment",
    "/" + encodeURIComponent("é".repeat(385)),
  ])
    assert.throws(() => route(path, ""));
  assert.equal(routeRequest("/new", "lastList=old"), null);
  assert.equal(routeRequest("/", "lastList=%zz"), null);
});
test("generated reservation retries collisions and stops without an unsafe fallback", async () => {
  const attempts: string[] = [];
  const ids = ["AbC234", "AbC234", "XyZ789"];
  assert.equal(
    await reserveGeneratedID(
      async (id) => {
        attempts.push(id);
        return id === "XyZ789";
      },
      () => ids.shift()!,
    ),
    "XyZ789",
  );
  assert.equal(attempts.length, 3);
  await assert.rejects(
    reserveGeneratedID(
      async () => false,
      () => "AbC234",
    ),
    /Could not reserve/,
  );
});

test("drag targets use current anchor keys and reject deleted targets", () => {
  const items = [0, 1, 2, 3].map((i) => ({
    key: String(i),
    ID: i,
    name: String(i),
    checked: false,
    priority: i * 1024,
  }));
  assert.equal(moveBeforePriority(items, "3", "0"), -1024);
  assert.equal(moveBeforePriority(items, "0", null), 4096);
  assert.equal(moveBeforePriority(items, "0", "3"), 2560);
  assert.throws(() => moveBeforePriority(items, "gone", "1"), /removed/);
  assert.throws(() => moveBeforePriority(items, "0", "gone"), /changed/);
  assert.throws(
    () =>
      moveBeforePriority(
        items.map((x) => ({ ...x, priority: 1 })),
        "0",
        "2",
      ),
    /same order/,
  );
});
