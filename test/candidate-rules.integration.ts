import { test } from "node:test";
import assert from "node:assert/strict";
import {
  get,
  ref,
  set,
  setWithPriority,
  goOffline,
  goOnline,
  onValue,
} from "firebase/database";
import { setLogLevel } from "firebase/app";
import {
  FirebaseStore,
  emulatorDatabase,
  reserveFirebaseList,
} from "../src/firebase-store.ts";
import { owner, loadRules, writesEnabled } from "./candidate-harness.ts";
setLogLevel("silent");
const id = "Synthetic mismatch? 50% &é";
const old = { ID: 91, name: "Historical item", checked: false, ".priority": 7 };
const key = "a1".repeat(16);
const outcome = (promise: Promise<unknown>) =>
  promise.then(
    () => "accepted",
    () => "denied",
  );

test(
  "candidate migration and collaboration policies (synthetic data only)",
  { timeout: 60000 },
  async (t) => {
    const a = emulatorDatabase("candidate-a", "127.0.0.1", 19000);
    const b = emulatorDatabase("candidate-b", "127.0.0.1", 19000);
    const c = emulatorDatabase("candidate-offline", "127.0.0.1", 19000);
    const modern = new FirebaseStore(a, id, "v2");
    const other = new FirebaseStore(b, id, "v2");
    const stops: (() => void)[] = [];
    try {
      await loadRules("current-active.rules.json");
      await owner("", "PUT", null);
      await t.test(
        "exact active legacy rules compile and permit whole saves/deletes",
        async () => {
          await set(ref(a, `lists/${id}`), {
            "7": old,
            "8": { ID: 8, name: "Delete", checked: false },
          });
          await set(ref(a, `lists/${id}/8`), null);
          await set(ref(a, `listAttrs/${id}`), {
            listName: "Historical title",
            lastMod: 1,
          });
          await assert.rejects(get(ref(b)));
          await assert.rejects(get(ref(b, "lists")));
        },
      );
      const preserved = await owner("");
      // Queue both legacy write shapes while their rules still allow them.
      await get(ref(c, `lists/${id}`));
      goOffline(c);
      const queuedSave = outcome(
        set(ref(c, `lists/${id}`), {
          "9": { ID: 9, name: "Stale save", checked: false },
        }),
      );
      const queuedDelete = outcome(set(ref(c, `lists/${id}/7`), null));
      await owner("v2", "PUT", {
        ...preserved,
        listClaims: { [id]: true, "Title only": true },
      });
      await owner("v2/listAttrs/Title only", "PUT", {
        listName: "Retained empty list",
      });
      await loadRules("database.rules.json");
      await t.test(
        "freeze denies online and queued legacy writes and preserves reads",
        async () => {
          await assert.rejects(set(ref(a, `lists/${id}`), { "7": old }));
          await assert.rejects(set(ref(a, `lists/${id}/7`), null));
          await assert.rejects(
            set(ref(a, `listAttrs/${id}/listName`), "Old title"),
          );
          goOnline(c);
          assert.deepEqual(await Promise.all([queuedSave, queuedDelete]), [
            "denied",
            "denied",
          ]);
          assert.deepEqual(await owner("lists"), preserved.lists);
          assert.deepEqual(await owner("listAttrs"), preserved.listAttrs);
          assert.equal((await get(ref(b, `lists/${id}/7/ID`))).val(), 91);
          await assert.rejects(
            modern.apply({ type: "edit", key: "7", name: "Disabled" }),
          );
        },
      );
      await writesEnabled(true);
      await t.test(
        "historical mismatched ID stays immutable through edit/check/reorder",
        async () => {
          await Promise.all([
            modern.apply({ type: "edit", key: "7", name: "Edited" }),
            other.apply({ type: "check", key: "7", checked: true }),
          ]);
          await modern.apply({
            type: "move",
            key: "7",
            priority: "legacy-string",
          });
          const snap = await get(ref(b, `v2/lists/${id}/7`));
          assert.deepEqual(snap.val(), {
            ID: 91,
            name: "Edited",
            checked: true,
          });
          assert.equal(snap.priority, "legacy-string");
          for (const value of [7, "91", "7", null])
            await assert.rejects(set(ref(a, `v2/lists/${id}/7/ID`), value));
        },
      );
      await t.test(
        "new claims/items and title-only lists work without rewriting legacy paths",
        async () => {
          assert.equal(
            await reserveFirebaseList(a, "New234", true, "v2"),
            true,
          );
          assert.equal(
            await reserveFirebaseList(b, "New234", true, "v2"),
            false,
          );
          assert.equal(
            await reserveFirebaseList(a, "Title only", true, "v2"),
            false,
          );
          const fresh = new FirebaseStore(a, "New234", "v2");
          await fresh.apply({
            type: "add",
            item: {
              key,
              ID: key,
              name: "New item",
              checked: false,
              priority: null,
            },
          });
          await fresh.apply({ type: "title", title: "New title" });
          const empty = new FirebaseStore(a, "Title only", "v2");
          await empty.apply({
            type: "add",
            item: {
              key,
              ID: key,
              name: "First item",
              checked: false,
              priority: 1024,
            },
          });
          assert.equal(
            (await get(ref(b, "v2/listAttrs/Title only/listName"))).val(),
            "Retained empty list",
          );
          await modern.apply({
            type: "add",
            item: {
              key,
              ID: key,
              name: "Added",
              checked: false,
              priority: 1024,
            },
          });
        },
      );
      await t.test(
        "server rejects malformed data, ID changes, broad writes and enumeration",
        async () => {
          for (const path of [
            "",
            "lists",
            "listAttrs",
            "v2",
            "v2/lists",
            "v2/listAttrs",
            "v2/listClaims",
            "v2Control",
          ])
            await assert.rejects(get(ref(b, path || undefined)));
          for (const [path, value] of [
            [`v2/lists/${id}`, { "7": old }],
            [`v2/listAttrs/${id}`, { listName: "Overwrite" }],
            [`v2/listClaims/${id}`, null],
            ["v2Control/writesEnabled", false],
            [`v2/lists/${id}/${key}/name`, " "],
            [`v2/lists/${id}/${key}/name`, null],
            [`v2/lists/${id}/${key}/checked`, "true"],
            [`v2/lists/${id}/${key}/extra`, true],
            [`v2/listAttrs/${id}/listName`, null],
            [`v2/listAttrs/${id}/listName`, "x".repeat(161)],
            [
              `v2/lists/${id}/12`,
              { ID: 12, name: "New numeric", checked: false },
            ],
            [
              `v2/lists/${id}/${"b2".repeat(16)}`,
              { ID: "wrong", name: "Mismatch", checked: false },
            ],
          ] as [string, unknown][])
            await assert.rejects(set(ref(a, path), value));
          await assert.rejects(
            setWithPriority(ref(a, `v2/lists/${id}/${key}/name`), "Name", 1),
          );
        },
      );
      await t.test(
        "checked-only delete is enforced by both adapter and server",
        async () => {
          await assert.rejects(modern.apply({ type: "delete", key }));
          await assert.rejects(set(ref(a, `v2/lists/${id}/${key}`), null));
          await modern.apply({ type: "check", key, checked: true });
          await modern.apply({ type: "delete", key });
          assert.equal(
            (await get(ref(b, `v2/lists/${id}/${key}`))).exists(),
            false,
          );
          await assert.rejects(
            modern.apply({ type: "edit", key, name: "Resurrect" }),
          );
        },
      );
      await t.test(
        "offline stale checked-delete cannot remove a newly unchecked item",
        async () => {
          const stale = new FirebaseStore(c, id, "v2");
          stops.push(onValue(ref(c, `v2/lists/${id}/7`), () => {}));
          await get(ref(c, `v2/lists/${id}/7`));
          goOffline(c);
          const deletion = outcome(stale.apply({ type: "delete", key: "7" }));
          // Let the transaction enqueue while offline before the other client edits.
          await new Promise((resolve) => setTimeout(resolve, 50));
          await other.apply({ type: "check", key: "7", checked: false });
          goOnline(c);
          assert.equal(await deletion, "denied");
          assert.equal(
            (await get(ref(b, `v2/lists/${id}/7/checked`))).val(),
            false,
          );
          assert.equal((await get(ref(b, `v2/lists/${id}/7/ID`))).val(), 91);
        },
      );
      await t.test(
        "post-launch freeze retains acknowledged modern writes for rollback",
        async () => {
          const latest = await owner("v2");
          await writesEnabled(false);
          await assert.rejects(
            modern.apply({ type: "edit", key: "7", name: "Frozen" }),
          );
          assert.deepEqual(await owner("v2"), latest);
          // Recovery uses the current namespace snapshot, never the old legacy snapshot.
          await owner("v2", "PUT", latest);
          await writesEnabled(true);
          const value = await get(ref(b, `v2/lists/${id}/7`));
          assert.equal(value.val().name, "Edited");
          assert.equal(value.val().checked, false);
          assert.equal(value.val().ID, 91);
          assert.equal(value.priority, "legacy-string");
          await modern.apply({ type: "check", key: "7", checked: true });
          await modern.apply({ type: "delete", key: "7" });
          await modern.apply({ type: "delete", key: "7" }); // Historical numeric-key retry.
          await assert.rejects(set(ref(a, `v2/lists/${id}/7`), old));
          assert.deepEqual(await owner("lists"), preserved.lists);
          assert.deepEqual(await owner("listAttrs"), preserved.listAttrs);
        },
      );
    } finally {
      stops.forEach((stop) => stop());
      modern.close();
      other.close();
      new FirebaseStore(c, id).close();
    }
  },
);
