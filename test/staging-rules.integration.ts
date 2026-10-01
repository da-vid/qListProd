import { test } from "node:test";
import assert from "node:assert/strict";
import { ref, get, set, setWithPriority } from "firebase/database";
import {
  FirebaseStore,
  emulatorDatabase,
  reserveFirebaseList,
} from "../src/firebase-store.ts";
const ns = "demo-qlist-default-rtdb";
// The emulator's documented owner bypass is used only on a hard-coded loopback URL.
async function control(enabled: boolean, expiresAt: number) {
  const response = await fetch(
    `http://127.0.0.1:9000/stagingControl.json?ns=${ns}`,
    {
      method: "PUT",
      headers: {
        Authorization: "Bearer owner",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ enabled, expiresAt }),
    },
  );
  assert.equal(response.ok, true);
}
test("staging rules permit granular collaboration and reject unsafe access", async () => {
  const id = "family notes",
    key = "abc12345".repeat(4);
  const a = new FirebaseStore(emulatorDatabase("staging-a"), id),
    b = new FirebaseStore(emulatorDatabase("staging-b"), id);
  try {
    await control(true, Date.now() + 3600000);
    await reserveFirebaseList(a.db, id, false);
    await a.apply({
      type: "add",
      item: {
        key,
        ID: key,
        name: "Synthetic apples",
        checked: false,
        priority: 1024,
      },
    });
    await Promise.all([
      a.apply({ type: "edit", key, name: "Synthetic pears" }),
      b.apply({ type: "check", key, checked: true }),
    ]);
    await b.apply({ type: "move", key, priority: 512 });
    await a.apply({ type: "title", title: "Synthetic test only" });
    const result = await get(ref(a.db, `lists/${id}/${key}`));
    assert.equal(result.val().name, "Synthetic pears");
    assert.equal(result.val().checked, true);
    assert.equal(result.priority, 512);
    await setWithPriority(
      ref(a.db, `lists/${id}/1`),
      { ID: 1, name: "Legacy-shaped fixture", checked: false },
      7,
    );
    for (const path of [
      "",
      "lists",
      "listAttrs",
      "listClaims",
      "stagingControl",
    ])
      await assert.rejects(get(ref(a.db, path || undefined)));
    await assert.rejects(set(ref(a.db, "stagingControl/enabled"), true));
    await assert.rejects(set(ref(a.db, `listClaims/${id}`), false));
    await reserveFirebaseList(a.db, "AbC234", true);
    const short = new FirebaseStore(a.db, "AbC234");
    await short.apply({ type: "title", title: "Six character list" });
    assert.equal(
      (await get(ref(b.db, "listAttrs/AbC234/listName"))).val(),
      "Six character list",
    );
    await assert.rejects(set(ref(a.db, `lists/${id}`), {}));
    await assert.rejects(
      set(ref(a.db, `listAttrs/${id}`), { listName: "Whole record" }),
    );
    await assert.rejects(set(ref(a.db, `listAttrs/${id}/other`), "No"));
    await assert.rejects(
      set(ref(a.db, `listAttrs/${id}/listName`), "x".repeat(161)),
    );
    await assert.rejects(set(ref(a.db, `lists/${id}/${key}/name`), " "));
    await assert.rejects(
      set(ref(a.db, `lists/${id}/${key}/name`), "x".repeat(1001)),
    );
    await assert.rejects(set(ref(a.db, `lists/${id}/${key}/checked`), "true"));
    await assert.rejects(set(ref(a.db, `lists/${id}/${key}/ID`), "new-id"));
    await assert.rejects(set(ref(a.db, `lists/${id}/${key}/extra`), true));
    await assert.rejects(
      setWithPriority(
        ref(a.db, `lists/${id}/${key}`),
        { ID: key, name: "Priority string", checked: false },
        "first",
      ),
    );
    await a.apply({ type: "delete", key });
    assert.equal((await get(ref(a.db, `lists/${id}/${key}`))).exists(), false);
    await control(true, Date.now() - 1000);
    await assert.rejects(get(ref(a.db, `lists/${id}`)));
    await assert.rejects(a.apply({ type: "title", title: "Expired" }));
    await control(false, Date.now() + 3600000);
    await assert.rejects(get(ref(a.db, `listAttrs/${id}`)));
  } finally {
    a.close();
    b.close();
  }
});
