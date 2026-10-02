import { test } from "node:test";
import assert from "node:assert/strict";
import { ref, get, set, setWithPriority } from "firebase/database";
import {
  FirebaseStore,
  emulatorDatabase,
  reserveFirebaseList,
} from "../src/firebase-store.ts";
import { legacyFixtures } from "./fixtures/legacy-lists.ts";
import {
  ordered,
  moveBeforePriority,
  appendPriority,
  type ListState,
} from "../src/model.ts";
async function readState(
  store: FirebaseStore,
  title: string,
  count: number,
): Promise<ListState> {
  let stop = () => {};
  try {
    return await new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        stop();
        reject(new Error("Legacy fixture subscription timed out"));
      }, 5000);
      stop = store.subscribe(
        (state) => {
          if (state.title === title && state.items.length === count) {
            clearTimeout(timer);
            resolve(state);
          }
        },
        () => {},
        (error) => {
          clearTimeout(timer);
          reject(error);
        },
      );
    });
  } finally {
    stop();
  }
}
const item = (key: string) => ({
  key,
  ID: key,
  name: "Item " + key,
  checked: false,
  priority: 1024,
});
async function clients(
  fn: (a: FirebaseStore, b: FirebaseStore) => Promise<void>,
) {
  const id = crypto.randomUUID().replaceAll("-", "");
  const a = new FirebaseStore(emulatorDatabase("a" + id), id),
    b = new FirebaseStore(emulatorDatabase("b" + id), id);
  try {
    await fn(a, b);
  } finally {
    a.close();
    b.close();
  }
}
test("concurrent inserts preserve both items", async () =>
  clients(async (a, b) => {
    await Promise.all([
      a.apply({ type: "add", item: item("a") }),
      b.apply({ type: "add", item: item("b") }),
    ]);
    const value = (await get(ref(a.db, `lists/${a.id}`))).val();
    assert.deepEqual(Object.keys(value).sort(), ["a", "b"]);
  }));
test("concurrent edit/check retain both fields and legacy priority", async () =>
  clients(async (a, b) => {
    await a.apply({ type: "add", item: item("a") });
    await Promise.all([
      a.apply({ type: "edit", key: "a", name: "New name" }),
      b.apply({ type: "check", key: "a", checked: true }),
    ]);
    const snap = await get(ref(a.db, `lists/${a.id}/a`));
    assert.equal(snap.val().name, "New name");
    assert.equal(snap.val().checked, true);
    assert.equal(snap.priority, 1024);
  }));
test("reorder does not overwrite an independent edit or another item", async () =>
  clients(async (a, b) => {
    await a.apply({ type: "add", item: item("a") });
    await b.apply({ type: "add", item: item("b") });
    await Promise.all([
      a.apply({ type: "move", key: "a", priority: 512 }),
      b.apply({ type: "edit", key: "a", name: "Kept" }),
    ]);
    const snap = await get(ref(a.db, `lists/${a.id}/a`));
    assert.equal(snap.val().name, "Kept");
    assert.equal(snap.priority, 512);
    assert.ok((await get(ref(a.db, `lists/${a.id}/b`))).exists());
  }));
test("delete wins against later stale edit/check/reorder", async () =>
  clients(async (a, b) => {
    await a.apply({ type: "add", item: item("a") });
    await a.apply({ type: "check", key: "a", checked: true });
    await a.apply({ type: "delete", key: "a" });
    for (const c of [
      { type: "edit", key: "a", name: "Ghost" },
      { type: "check", key: "a", checked: true },
      { type: "move", key: "a", priority: 1 },
    ] as const)
      await assert.rejects(b.apply(c), /removed/);
    assert.equal((await get(ref(a.db, `lists/${a.id}/a`))).exists(), false);
  }));
test("legacy numeric keys/IDs/priority and list title load without migration", async () =>
  clients(async (a, b) => {
    await setWithPriority(
      ref(a.db, `lists/${a.id}/1`),
      { ID: 1, name: "Legacy", checked: false },
      7,
    );
    await a.apply({ type: "title", title: "Old list" });
    let stop = () => {};
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error("subscription timeout")),
        5000,
      );
      stop = b.subscribe(
        (s) => {
          if (s.title === "Old list" && s.items.length) {
            assert.equal(s.items[0].ID, 1);
            assert.equal(s.items[0].priority, 7);
            clearTimeout(timer);
            resolve();
          }
        },
        () => {},
        reject,
      );
    });
    stop();
  }));
test("offline queued transaction commits after reconnect and sees other client edit", async () =>
  clients(async (a, b) => {
    await a.apply({ type: "add", item: item("a") });
    await get(ref(b.db, `lists/${a.id}/a`));
    b.disconnect();
    let done = false;
    const saving = b
      .apply({ type: "check", key: "a", checked: true })
      .then(() => {
        done = true;
      });
    await a.apply({ type: "edit", key: "a", name: "While offline" });
    assert.equal(done, false);
    b.reconnect();
    await saving;
    const val = (await get(ref(a.db, `lists/${a.id}/a`))).val();
    assert.equal(val.checked, true);
    assert.equal(val.name, "While offline");
  }));
test("rules deny broad reads and malformed writes; retry add remains idempotent", async () =>
  clients(async (a, b) => {
    await assert.rejects(get(ref(a.db, "lists")));
    await assert.rejects(set(ref(a.db, `lists/${a.id}/bad`), { name: "bad" }));
    await a.apply({ type: "add", item: item("a") });
    await b.apply({ type: "edit", key: "a", name: "Preserve" });
    await a.apply({ type: "add", item: item("a") });
    assert.equal(
      (await get(ref(a.db, `lists/${a.id}/a`))).val().name,
      "Preserve",
    );
  }));

test("atomic generated claims have one winner and detect pre-registry legacy data", async () =>
  clients(async (a, b) => {
    const results = await Promise.all([
      reserveFirebaseList(a.db, a.id, true),
      reserveFirebaseList(b.db, a.id, true),
    ]);
    assert.equal(results.filter(Boolean).length, 1);
    const legacy = "old" + crypto.randomUUID().replaceAll("-", "");
    await set(ref(a.db, `listAttrs/${legacy}/listName`), "Existing");
    assert.equal(await reserveFirebaseList(b.db, legacy, true), false);
  }));
test("racing custom-list creation never resets existing content", async () => {
  const id = "custom " + crypto.randomUUID();
  const a = new FirebaseStore(emulatorDatabase("custom-a" + id), id),
    b = new FirebaseStore(emulatorDatabase("custom-b" + id), id);
  try {
    await Promise.all([
      reserveFirebaseList(a.db, id, false),
      reserveFirebaseList(b.db, id, false),
    ]);
    await Promise.all([
      a.apply({ type: "add", item: item("a") }),
      b.apply({ type: "add", item: item("b") }),
    ]);
    await reserveFirebaseList(a.db, id, false);
    assert.equal(
      Object.keys((await get(ref(a.db, `lists/${id}`))).val()).length,
      2,
    );
  } finally {
    a.close();
    b.close();
  }
});

test("unchecked deletes reject; checked deletes and retries are idempotent", async () =>
  clients(async (a, b) => {
    await a.apply({ type: "add", item: item("a") });
    await assert.rejects(b.apply({ type: "delete", key: "a" }), /not checked/);
    await a.apply({ type: "check", key: "a", checked: true });
    await b.apply({ type: "delete", key: "a" });
    await a.apply({ type: "delete", key: "a" });
    assert.equal((await get(ref(a.db, `lists/${a.id}/a`))).exists(), false);
  }));

test("a queued stale delete aborts when another client unchecks before commit", async () =>
  clients(async (a, b) => {
    await a.apply({ type: "add", item: { ...item("a"), checked: true } });
    // Keep checked data cached while offline so the transaction actually starts stale.
    let stop = () => {};
    await new Promise<void>((resolve, reject) => {
      stop = a.subscribe(
        (s) => {
          if (s.items[0]?.checked) resolve();
        },
        () => {},
        reject,
      );
    });
    try {
      a.disconnect();
      const deletion = a.apply({ type: "delete", key: "a" });
      const rejected = assert.rejects(deletion, /not checked/);
      await b.apply({ type: "check", key: "a", checked: false });
      a.reconnect();
      await rejected;
      const value = (await get(ref(b.db, `lists/${a.id}/a`))).val();
      assert.equal(value.checked, false);
      assert.equal(value.name, "Item a");
    } finally {
      stop();
    }
  }));

test("multi-position order survives independent subscription and reconnect", async () =>
  clients(async (a, b) => {
    for (let i = 0; i < 4; i++)
      await a.apply({
        type: "add",
        item: { ...item(String(i)), priority: i * 1024 },
      });
    await a.apply({ type: "move", key: "3", priority: -1024 });
    const expectOrder = () =>
      new Promise<void>((resolve, reject) => {
        let stop = () => {};
        stop = b.subscribe(
          (s) => {
            if (s.items.length === 4) {
              try {
                assert.deepEqual(
                  s.items.map((x) => x.key),
                  ["3", "0", "1", "2"],
                );
                resolve();
              } catch (e) {
                reject(e);
              }
              queueMicrotask(stop);
            }
          },
          () => {},
          reject,
        );
      });
    await expectOrder();
    b.disconnect();
    b.reconnect();
    await expectOrder();
  }));

for (const fixture of legacyFixtures) {
  test(`legacy compatibility: ${fixture.name}`, async () =>
    clients(async (a, b) => {
      for (const { key, priority, ...value } of fixture.items)
        await setWithPriority(
          ref(a.db, `lists/${a.id}/${key}`),
          value,
          priority,
        );
      const attrs = {
        listName: `Legacy title · ${fixture.name}`,
        lastMod: 1234567890,
      };
      await set(ref(a.db, `listAttrs/${a.id}/listName`), attrs.listName);
      await set(ref(a.db, `listAttrs/${a.id}/lastMod`), attrs.lastMod);
      const before = await get(ref(a.db, `lists/${a.id}`));
      const firebaseOrder: string[] = [];
      before.forEach((child) => {
        firebaseOrder.push(child.key!);
      });
      assert.deepEqual(firebaseOrder, fixture.expected);
      const loaded = await readState(b, attrs.listName, fixture.items.length);
      assert.deepEqual(
        loaded.items.map((x) => x.key),
        firebaseOrder,
      );
      for (const original of fixture.items)
        assert.deepEqual(
          loaded.items.find((x) => x.key === original.key),
          original,
        );
      // Loading/subscribing must not normalize or rewrite any data or priority metadata.
      assert.deepEqual(
        (await get(ref(a.db, `lists/${a.id}`))).exportVal(),
        before.exportVal(),
      );
      assert.deepEqual(
        (await get(ref(a.db, `listAttrs/${a.id}`))).val(),
        attrs,
      );
      // Edits and checks preserve the item's ID, exact priority type/value and other fields.
      for (const original of fixture.items) {
        await b.apply({
          type: "edit",
          key: original.key,
          name: original.name + " edited",
        });
        await a.apply({
          type: "check",
          key: original.key,
          checked: !original.checked,
        });
        const after = await get(ref(a.db, `lists/${a.id}/${original.key}`));
        assert.equal(after.priority, original.priority);
        assert.deepEqual(after.val(), {
          ID: original.ID,
          name: original.name + " edited",
          checked: !original.checked,
        });
      }
      b.disconnect();
      b.reconnect();
      const reopened = await readState(b, attrs.listName, fixture.items.length);
      assert.deepEqual(
        reopened.items.map((x) => x.key),
        firebaseOrder,
      );
      for (const original of fixture.items)
        assert.equal(
          reopened.items.find((x) => x.key === original.key)!.priority,
          original.priority,
        );
    }));
}

test("mixed-priority reorder and append write only their own items", async () =>
  clients(async (a, b) => {
    const priorities = [null, -10, 0, "a", "c"] as const;
    const items = priorities.map((priority, i) => ({
      ...item(String(i)),
      priority,
    }));
    for (const value of items) await a.apply({ type: "add", item: value });
    const before = await get(ref(a.db, `lists/${a.id}`));
    const priority = moveBeforePriority(items, "2", "4");
    assert.equal(priority, "a!");
    await b.apply({ type: "move", key: "2", priority });
    const after = await get(ref(a.db, `lists/${a.id}`));
    const order: string[] = [];
    after.forEach((child) => {
      order.push(child.key!);
    });
    assert.deepEqual(order, ["0", "1", "3", "2", "4"]);
    for (const key of ["0", "1", "3", "4"])
      assert.deepEqual(
        after.child(key).exportVal(),
        before.child(key).exportVal(),
      );
    const current = ordered(
      items.map((x) => (x.key === "2" ? { ...x, priority } : x)),
    );
    await a.apply({
      type: "add",
      item: { ...item("5"), priority: appendPriority(current, "5") },
    });
    const appended = await get(ref(b.db, `lists/${a.id}`));
    const appendedOrder: string[] = [];
    appended.forEach((child) => {
      appendedOrder.push(child.key!);
    });
    assert.deepEqual(appendedOrder, [...order, "5"]);
    for (const key of order)
      assert.deepEqual(
        appended.child(key).exportVal(),
        after.child(key).exportVal(),
      );
  }));
