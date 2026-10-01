import { test } from "node:test";
import assert from "node:assert/strict";
import { ref, get, set, setWithPriority } from "firebase/database";
import { FirebaseStore, emulatorDatabase } from "../src/firebase-store.ts";
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
