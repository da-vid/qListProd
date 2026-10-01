// Explicit opt-in synthetic cloud smoke test. Not run by CI or npm test.
import { test } from "node:test";
import assert from "node:assert/strict";
import { ref, get, enableLogging } from "firebase/database";
import { stagingDatabase } from "../src/staging-store.ts";
import { FirebaseStore, reserveFirebaseList } from "../src/firebase-store.ts";
import { reserveGeneratedID } from "../src/model.ts";
if (process.env.QLIST_STAGING_SMOKE !== "1")
  throw new Error(
    "Set QLIST_STAGING_SMOKE=1 explicitly to test the approved synthetic staging project.",
  );
enableLogging((message) => {
  if (/Websocket connecting|Reset packet received/.test(message))
    console.log(message);
});
test("two independent staging clients share and preserve concurrent synthetic edits", async () => {
  const suffix = crypto.randomUUID();
  const da = stagingDatabase("cloud-a-" + suffix, "localhost"),
    db = stagingDatabase("cloud-b-" + suffix, "localhost");
  const id = await reserveGeneratedID((candidate) =>
    reserveFirebaseList(da, candidate, true),
  );
  const a = new FirebaseStore(da, id),
    b = new FirebaseStore(db, id);
  const ka = crypto.randomUUID().replaceAll("-", ""),
    kb = crypto.randomUUID().replaceAll("-", "");
  try {
    await a.apply({ type: "title", title: "Synthetic cross-client QA" });
    await Promise.all([
      a.apply({
        type: "add",
        item: {
          key: ka,
          ID: ka,
          name: "Synthetic apples",
          checked: false,
          priority: 1024,
        },
      }),
      b.apply({
        type: "add",
        item: {
          key: kb,
          ID: kb,
          name: "Synthetic milk",
          checked: false,
          priority: 2048,
        },
      }),
    ]);
    await Promise.all([
      a.apply({ type: "edit", key: ka, name: "Synthetic green apples" }),
      b.apply({ type: "check", key: ka, checked: true }),
    ]);
    await b.apply({ type: "move", key: kb, priority: 512 });
    const rows = await get(ref(db, `lists/${id}`));
    assert.equal(rows.size, 2);
    assert.equal(rows.child(ka).val().name, "Synthetic green apples");
    assert.equal(rows.child(ka).val().checked, true);
    assert.equal(rows.child(kb).priority, 512);
    assert.equal(
      (await get(ref(db, `listAttrs/${id}/listName`))).val(),
      "Synthetic cross-client QA",
    );
    console.log("SYNTHETIC_REVIEW_LIST=" + id);
  } finally {
    a.close();
    b.close();
  }
});
