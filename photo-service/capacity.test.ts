import { test } from "node:test";
import assert from "node:assert/strict";
import {
  assertCaps,
  emptyState,
  FREE_STORAGE_BYTES,
  MemoryLedger,
  RESERVATION,
  transact,
  type Operation,
  type State,
} from "../photo-lab/beta/ledger.ts";
const signal = () => new AbortController().signal;
const op = (n: number): Operation => ({
  id: String(n),
  list: "Shared",
  item: String(n),
  expected: 0,
  epoch: 0,
  state: "committed",
  writes: ["stored"],
  sizes: [12000],
  hashes: ["a".repeat(64)],
  lease: 0,
  version: 1,
});
const countState = (count: number): State => ({
  ...emptyState(),
  ops: Object.fromEntries(
    Array.from({ length: count }, (_, n) => [String(n), op(n)]),
  ),
});
function production() {
  const l = new MemoryLedger();
  l.value.storageBudget = {
    bytes: FREE_STORAGE_BYTES,
    aggregateBytes: FREE_STORAGE_BYTES,
    externalBytes: 0,
  };
  return l;
}
test("production allowance is one conservative decimal GB and admits beyond both old caps", () => {
  const l = production();
  assert.equal(FREE_STORAGE_BYTES, 1_000_000_000);
  assert.doesNotThrow(() => assertCaps(l.value, countState(172), emptyState()));
  const slots = Math.floor(FREE_STORAGE_BYTES / RESERVATION);
  assert.equal(slots, 2543);
  assert.doesNotThrow(() =>
    assertCaps(l.value, countState(slots), countState(slots - 1)),
  );
  assert.throws(
    () => assertCaps(l.value, countState(slots + 1), countState(slots)),
    /full/,
  );
});
test("shared aggregate counts trial reservations and other objects at byte-exact boundaries", () => {
  for (const offset of [-1, 0, 1]) {
    const l = production();
    l.value.legacy.bytes = 12345;
    l.value.storageBudget!.externalBytes =
      FREE_STORAGE_BYTES - RESERVATION - 12345 + offset;
    const action = () => assertCaps(l.value, countState(1), emptyState());
    if (offset <= 0) assert.doesNotThrow(action);
    else assert.throws(action, /full/);
  }
});
test("shared last-slot concurrency admits one reservation across independent item namespaces", async () => {
  const l = production();
  l.value.legacy.bytes = FREE_STORAGE_BYTES - RESERVATION;
  const r = await Promise.allSettled(
    [1, 2].map((n) =>
      transact(l, signal(), (s) => {
        s.state.ops[String(n)] = { ...op(n), list: "List" + n };
      }),
    ),
  );
  assert.equal(r.filter((x) => x.status === "fulfilled").length, 1);
  assert.equal(Object.keys(l.value.state.ops).length, 1);
});
test("smaller rollback caps retain every charge/history and permit nonincreasing recovery", async () => {
  const l = production();
  l.value.state = countState(172);
  const history = structuredClone(l.value.state);
  l.value.storageBudget = {
    bytes: 33554432,
    aggregateBytes: 67108864,
    externalBytes: 0,
  };
  await transact(l, signal(), (s) => {
    s.state.reads++;
  });
  assert.deepEqual(l.value.state.ops, history.ops);
  await assert.rejects(
    () =>
      transact(l, signal(), (s) => {
        s.state.ops.extra = op(999);
      }),
    /full/,
  );
  await transact(l, signal(), (s) => {
    s.state.ops["0"].state = "released";
  });
  assert.equal(Object.keys(l.value.state.ops).length, 172);
  assert.equal(
    Object.values(l.value.state.ops).filter((x) => x.state !== "released")
      .length,
    171,
  );
});
test("unknown writers, malformed budgets and unrelated rate/concurrency limits stay conservative", () => {
  const l = production();
  l.value.storageBudget!.externalBytes = FREE_STORAGE_BYTES;
  assert.throws(() => assertCaps(l.value, countState(1), emptyState()), /full/);
  assert.doesNotThrow(() => assertCaps(l.value, countState(1), countState(1)));
  l.value.storageBudget!.externalBytes = 0;
  for (const invalid of [NaN, -1, 1_000_000_001]) {
    l.value.storageBudget!.bytes = invalid;
    assert.throws(
      () => assertCaps(l.value, emptyState(), emptyState()),
      /budget/,
    );
  }
  l.value.storageBudget!.bytes = FREE_STORAGE_BYTES;
  const pending = countState(5);
  Object.values(pending.ops).forEach((o) => {
    o.state = "pending";
    o.writes = ["writing"];
    o.lease = Date.now() + 60000;
  });
  assert.throws(() => assertCaps(l.value, pending, emptyState()), /busy/);
  for (const field of ["minuteRequests", "maintenanceRequests"] as const) {
    const next = emptyState();
    next[field] = 61;
    assert.throws(() => assertCaps(l.value, next, emptyState()), /Too many/);
  }
});
