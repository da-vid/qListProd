import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { ref, get, set, goOffline, goOnline } from "firebase/database";
import { setLogLevel } from "firebase/app";
import { emulatorDatabase, FirebaseStore } from "../src/firebase-store.ts";
import { SavedMetadataWarning } from "../src/model.ts";
import { watchWrites } from "../src/production-store.ts";
import { run, client } from "../scripts/migrate.mjs";
import { digest } from "../scripts/migration-core.mjs";
import { owner, loadRules } from "./candidate-harness.ts";
setLogLevel("silent");
const fixture = {
  lists: {
    "Synthetic? 50%": {
      "4": { ID: 98, name: "Original", checked: false, ".priority": 7 },
    },
  },
  listAttrs: {
    "Synthetic? 50%": { listName: "Title" },
    Empty: { listName: "Title only" },
  },
};
test(
  "migration runner freezes, copies, verifies, enables locally and retains post-launch writes for recovery",
  { timeout: 60000 },
  async (t) => {
    const directory = await mkdtemp(path.join(tmpdir(), "qlist-migration-"));
    const invoke = (action: string) =>
      run({ action, directory, emulator: true, execute: true });
    const db = emulatorDatabase("runner-client", "127.0.0.1", 19000);
    const old = emulatorDatabase("runner-offline", "127.0.0.1", 19000);
    const store = new FirebaseStore(db, "Synthetic? 50%", "v2");
    try {
      await loadRules("current-active.rules.json");
      await owner("", "PUT", fixture);
      await get(ref(old, "lists/Synthetic? 50%"));
      goOffline(old);
      const queued = set(ref(old, "lists/Synthetic? 50%/4"), null).then(
        () => false,
        () => true,
      );
      await t.test(
        "freeze captures verified private snapshots and rejects old queued deletion",
        async () => {
          assert.equal((await invoke("freeze")).status, "passed");
          goOnline(old);
          assert.equal(await queued, true);
          assert.equal(digest(await owner("lists")), digest(fixture.lists));
          await assert.rejects(set(ref(db, "lists/Synthetic? 50%"), {}));
          const enabled = await new Promise((resolve) => {
            let stop = () => {};
            stop = watchWrites(db, (value) => {
              stop();
              resolve(value);
            });
          });
          assert.equal(enabled, false);
        },
      );
      await t.test(
        "copy is idempotent, preserves metadata and refuses overwriting unexpected data",
        async () => {
          await invoke("copy");
          await invoke("copy");
          await invoke("verify");
          assert.equal(
            (await get(ref(db, "v2/lists/Synthetic? 50%/4"))).priority,
            7,
          );
          const preserved = await owner("v2");
          await owner(
            "v2/listAttrs/Empty/listName",
            "PUT",
            "Unexpected administrative edit",
          );
          await assert.rejects(
            invoke("copy"),
            /namespace-verification-mismatch/,
          );
          await assert.rejects(
            invoke("verify"),
            /namespace-verification-mismatch/,
          );
          await owner("v2", "PUT", preserved);
          const api = client(true, null),
            missing = await api("conditionalFixture");
          await owner("conditionalFixture", "PUT", { written: true });
          await assert.rejects(
            api("conditionalFixture", "PUT", { overwrite: true }, missing.etag),
            /412/,
          );
          await owner("conditionalFixture", "PUT", null);
        },
      );
      await t.test(
        "a committed edit with denied timestamp gives a non-retry warning",
        async () => {
          await invoke("enable");
          const rules = JSON.parse(
            await readFile("candidate/database.rules.json", "utf8"),
          );
          rules.rules.v2.listAttrs.$list.lastMod[".write"] = false;
          await owner(".settings/rules", "PUT", rules);
          await assert.rejects(
            store.apply({
              type: "edit",
              key: "4",
              name: "Saved despite timestamp denial",
            }),
            SavedMetadataWarning,
          );
          assert.equal(
            (await get(ref(db, "v2/lists/Synthetic? 50%/4/name"))).val(),
            "Saved despite timestamp denial",
          );
          await loadRules("database.rules.json");
        },
      );
      await t.test(
        "freeze-modern retains latest writes, permits read-only recovery and resumes same data",
        async () => {
          await store.apply({
            type: "edit",
            key: "4",
            name: "Acknowledged edit",
          });
          await invoke("freeze-modern");
          await invoke("verify-recovery");
          await assert.rejects(
            store.apply({ type: "edit", key: "4", name: "Blocked" }),
          );
          assert.equal(
            (await get(ref(db, "v2/lists/Synthetic? 50%/4/name"))).val(),
            "Acknowledged edit",
          );
          await invoke("enable");
          assert.equal(
            (await get(ref(db, "v2/lists/Synthetic? 50%/4/ID"))).val(),
            98,
          );
          assert.equal(digest(await owner("lists")), digest(fixture.lists));
        },
      );
    } finally {
      store.close();
      new FirebaseStore(old, "cleanup").close();
    }
  },
);
