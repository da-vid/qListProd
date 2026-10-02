import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { get, ref, set } from "firebase/database";
import { setLogLevel } from "firebase/app";
import { emulatorDatabase } from "../src/firebase-store.ts";
import { owner } from "./candidate-harness.ts";
setLogLevel("silent");
test("production privacy rules deny legacy reads without changing v2 or retained data", async () => {
  const previous = JSON.parse(
    await readFile("candidate/database.rules.json", "utf8"),
  );
  const rules = JSON.parse(
    await readFile("production/database.rules.json", "utf8"),
  );
  const expected = structuredClone(previous);
  expected.rules.lists.$list[".read"] = false;
  expected.rules.listAttrs.$list[".read"] = false;
  assert.deepEqual(rules, expected);
  const key = "ab".repeat(16);
  const item = { ID: key, name: "Synthetic retained item", checked: true };
  const retained = {
    lists: { PrivacyTest: { [key]: item } },
    listAttrs: { PrivacyTest: { listName: "Synthetic title" } },
  };
  await owner("", "PUT", {
    ...retained,
    v2: { ...retained, listClaims: { PrivacyTest: true } },
    v2Control: { writesEnabled: true },
  });
  const before = await owner("");
  await owner(".settings/rules", "PUT", rules);
  const db = emulatorDatabase("production-privacy-test", "127.0.0.1", 19000);
  try {
    for (const path of [
      "lists/PrivacyTest",
      "listAttrs/PrivacyTest",
      "lists",
      "listAttrs",
      "v2",
      "",
    ])
      await assert.rejects(get(path ? ref(db, path) : ref(db)));
    for (const node of ["lists", "listAttrs"]) {
      assert.deepEqual(
        (await get(ref(db, `v2/${node}/PrivacyTest`))).val(),
        retained[node as keyof typeof retained].PrivacyTest,
      );
      await assert.rejects(set(ref(db, `${node}/PrivacyTest`), null));
    }
    assert.equal((await get(ref(db, "v2Control/writesEnabled"))).val(), true);
    assert.deepEqual(await owner(""), before);
    await set(
      ref(db, `v2/lists/PrivacyTest/${key}/name`),
      "Updated synthetic item",
    );
    await set(ref(db, `v2/lists/PrivacyTest/${key}`), null);
    assert.equal(
      (await get(ref(db, `v2/lists/PrivacyTest/${key}`))).exists(),
      false,
    );
    assert.deepEqual(await owner("lists"), retained.lists);
    assert.deepEqual(await owner("listAttrs"), retained.listAttrs);
  } finally {
    const { goOffline } = await import("firebase/database");
    const { deleteApp } = await import("firebase/app");
    goOffline(db);
    await deleteApp(db.app);
  }
});
