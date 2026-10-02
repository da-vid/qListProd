import { test } from "node:test";
import assert from "node:assert/strict";
import { QuotaLedger, MAX_RESERVATION_BYTES } from "./quota-ledger.ts";
const digest = "a".repeat(64),
  proof = { writerStopped: true, objectsAbsent: true };
const req = (
  id: string,
  key = id,
  expected: number | null = null,
  bytes = 100,
) => ({ id, key, expected, bytes, digest });
const save = (
  ledger: QuotaLedger,
  id: string,
  key = id,
  expected: number | null = null,
) => {
  ledger.reserve(req(id, key, expected), 0);
  ledger.stage(id, 80, 1);
  return ledger.commit(id, 2);
};
test("quota boundary and idempotent reserve/commit retries do not double count", () => {
  const ledger = new QuotaLedger(100);
  ledger.reserve(req("a"), 0);
  ledger.reserve(req("a"), 1);
  assert.equal(ledger.snapshot().reserved, 100);
  assert.throws(() => ledger.reserve(req("b"), 1), /Quota/);
  ledger.stage("a", 80, 2);
  const first = ledger.commit("a", 3);
  assert.deepEqual(ledger.commit("a", 4), first);
  assert.equal(ledger.snapshot().used, 80);
  assert.equal(ledger.snapshot().reserved, 0);
  assert.throws(
    () => ledger.reserve({ ...req("a"), digest: "b".repeat(64) }, 5),
    /different input/,
  );
});
test("two replacements race by version; loser stays accounted until cleanup is confirmed", () => {
  const ledger = new QuotaLedger(300);
  const old = save(ledger, "old", "item");
  ledger.reserve(req("a", "item", old.version!), 3);
  ledger.reserve(req("b", "item", old.version!), 3);
  ledger.stage("a", 80, 4);
  ledger.stage("b", 80, 4);
  const current = ledger.commit("a", 5);
  assert.throws(() => ledger.commit("b", 5), /conflict/);
  assert.equal(ledger.snapshot().accounted, 260);
  ledger.confirmCleanup("old", proof);
  ledger.confirmCleanup("b", proof);
  ledger.confirmCleanup("b", proof);
  assert.equal(ledger.snapshot().accounted, 80);
  assert.equal(ledger.current("item")!.version, current.version);
  assert.throws(() => ledger.confirmCleanup("a", proof), /current/);
});
test("expired/partial uploads keep reservations until writers stop and objects are absent", () => {
  const ledger = new QuotaLedger(100);
  ledger.reserve(req("a"), 0, 10);
  ledger.stage("a", 40, 1);
  ledger.expire(10);
  assert.throws(() => ledger.commit("a", 11), /fenced/);
  assert.equal(ledger.snapshot().reserved, 100);
  assert.throws(
    () =>
      ledger.confirmCleanup("a", { writerStopped: false, objectsAbsent: true }),
    /not confirmed/,
  );
  assert.throws(
    () =>
      ledger.confirmCleanup("a", { writerStopped: true, objectsAbsent: false }),
    /not confirmed/,
  );
  assert.throws(() => ledger.reserve(req("b"), 11), /Quota/);
  ledger.confirmCleanup("a", proof);
  ledger.reserve(req("b"), 12);
  assert.equal(ledger.snapshot().reserved, 100);
});
test("deleting an item fences pending initial uploads and future retries cannot resurrect it", () => {
  const ledger = new QuotaLedger(200);
  ledger.reserve(req("a", "item"), 0);
  ledger.stage("a", 80, 1);
  ledger.deleteItem("item");
  assert.throws(() => ledger.commit("a", 2), /fenced/);
  assert.throws(() => ledger.reserve(req("b", "item"), 3), /deleted/);
  ledger.confirmCleanup("a", proof);
  assert.equal(ledger.snapshot().accounted, 0);
  assert.equal(ledger.current("item"), undefined);
});
test("remove/re-add cannot let a stale null-version upload win an ABA race", () => {
  const ledger = new QuotaLedger(400);
  ledger.reserve(req("slow", "item"), 0);
  const first = save(ledger, "fast", "item");
  ledger.remove("item", first.version!);
  ledger.stage("slow", 80, 4);
  assert.throws(() => ledger.commit("slow", 5), /conflict/);
  ledger.confirmCleanup("slow", proof);
  ledger.confirmCleanup("fast", proof);
  assert.equal(ledger.snapshot().accounted, 0);
});
test("failed cleanup blocks quota, stale removal cannot delete a replacement, and retries are safe", () => {
  const ledger = new QuotaLedger(200);
  const first = save(ledger, "old", "item"),
    next = save(ledger, "new", "item", first.version!);
  assert.throws(() => ledger.remove("item", first.version!), /conflict/);
  assert.throws(() => ledger.reserve(req("another"), 3), /Quota/);
  ledger.confirmCleanup("old", proof);
  assert.equal(ledger.current("item")!.version, next.version);
  ledger.remove("item", next.version!);
  ledger.confirmCleanup("new", proof);
  assert.equal(ledger.snapshot().accounted, 0);
});
test("invalid/oversized reservations and trial request/concurrency limits fail closed", () => {
  for (const bytes of [0, -1, NaN, Infinity, 1.5, MAX_RESERVATION_BYTES + 1])
    assert.throws(
      () => new QuotaLedger().reserve(req("a", "a", null, bytes), 0),
      /Invalid/,
    );
  const ledger = new QuotaLedger(1000, 1, 2);
  ledger.reserve(req("a"), 0);
  assert.throws(() => ledger.reserve(req("b"), 1), /busy/);
  ledger.cancel("a");
  assert.throws(() => ledger.reserve(req("b"), 2), /busy/);
  ledger.confirmCleanup("a", proof);
  ledger.reserve(req("b"), 3);
  ledger.cancel("b");
  ledger.confirmCleanup("b", proof);
  assert.throws(() => ledger.reserve(req("c"), 4), /operation limit/);
});

test("photo count includes reservations and permits replacement at the count cap", () => {
  const ledger = new QuotaLedger(1000, 2, 100, 1);
  ledger.reserve(req("a", "item"), 0);
  assert.throws(() => ledger.reserve(req("b"), 1), /count/);
  ledger.stage("a", 80, 1);
  const old = ledger.commit("a", 2);
  save(ledger, "replacement", "item", old.version!);
  assert.throws(() => ledger.reserve(req("b"), 3), /count/);
});

test("unknown-item deletion markers cannot bypass the bounded trial metadata limit", () => {
  const ledger = new QuotaLedger(1000, 2, 2);
  ledger.deleteItem("a");
  ledger.deleteItem("b");
  assert.throws(() => ledger.deleteItem("c"), /item limit/);
  assert.throws(() => ledger.reserve(req("c"), 0), /item limit/);
  assert.equal(ledger.snapshot().accounted, 0);
});
