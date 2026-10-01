import { initializeApp, deleteApp } from "firebase/app";
import {
  getDatabase,
  connectDatabaseEmulator,
  ref,
  onValue,
  set,
  runTransaction,
  goOffline,
  goOnline,
  type Database,
} from "firebase/database";
import {
  type Change,
  type Item,
  type ListState,
  type Store,
  ordered,
  validID,
  validate,
} from "./model.ts";
export const DEMO_PROJECT = "demo-qlist";
export function emulatorDatabase(
  name: string,
  host = "127.0.0.1",
  port = 9000,
): Database {
  if (host !== "127.0.0.1" && host !== "localhost")
    throw new Error("Only a loopback demo emulator is allowed.");
  if (!Number.isInteger(port) || port < 1024 || port > 65535)
    throw new Error("Invalid emulator port.");
  const app = initializeApp(
    {
      projectId: DEMO_PROJECT,
      databaseURL: `https://${DEMO_PROJECT}-default-rtdb.firebaseio.com`,
    },
    name,
  );
  const db = getDatabase(app);
  connectDatabaseEmulator(db, host, port);
  return db;
}
export class FirebaseStore implements Store {
  readonly db: Database;
  readonly id: string;
  constructor(db: Database, id: string) {
    this.db = db;
    this.id = id;
    if (!validID(id)) throw new Error("Invalid list ID");
  }
  subscribe(
    fn: (s: ListState) => void,
    connection: (b: boolean) => void,
    error: (e: Error) => void,
  ) {
    let state: ListState = { title: "", items: [] };
    const a = onValue(
      ref(this.db, `lists/${this.id}`),
      (snap) => {
        const items: Item[] = [];
        snap.forEach((child) => {
          const v = child.val();
          if (v && typeof v.name === "string")
            items.push({
              key: child.key!,
              ID: v.ID ?? child.key!,
              name: v.name,
              checked: v.checked === true,
              priority:
                typeof child.priority === "number"
                  ? (child.priority as number)
                  : 0,
            });
        });
        state = { ...state, items: ordered(items) };
        fn(state);
      },
      error,
    );
    const b = onValue(
      ref(this.db, `listAttrs/${this.id}/listName`),
      (snap) => {
        state = {
          ...state,
          title: typeof snap.val() === "string" ? snap.val() : "",
        };
        fn(state);
      },
      error,
    );
    const c = onValue(ref(this.db, ".info/connected"), (snap) =>
      connection(snap.val() === true),
    );
    return () => {
      a();
      b();
      c();
    };
  }
  async apply(change: Change) {
    await this.write(change);
    await runTransaction(
      ref(this.db, `listAttrs/${this.id}/lastMod`),
      (current) =>
        Math.max(
          typeof current === "number" ? current : 0,
          Math.floor(Date.now() / 1000),
        ),
      { applyLocally: false },
    );
  }
  private async write(change: Change) {
    validate(change);
    if (change.type === "title") {
      await set(ref(this.db, `listAttrs/${this.id}/listName`), change.title);
      return;
    }
    if (change.type === "add") {
      const { key, priority, ...item } = change.item;
      // Random 128-bit item key, reused on retry. Never derive identity from list length.
      const result = await runTransaction(
        ref(this.db, `lists/${this.id}/${key}`),
        (current) => current ?? { ...item, ".priority": priority },
        { applyLocally: false },
      );
      if (!result.committed) throw new Error("Could not add item. Retry.");
      return;
    }
    const target = ref(this.db, `lists/${this.id}/${change.key}`);
    // Keep a listener alive while transacting: an empty SDK cache is not evidence of deletion.
    let stop = () => {};
    await new Promise<void>((resolve, reject) => {
      stop = onValue(target, () => resolve(), reject);
    });
    try {
      const result = await runTransaction(
        target,
        (current) => {
          if (change.type === "delete") return null; // Deletion is idempotent, including retry after a lost acknowledgement.
          if (current === null) return; // A deleted item must never be resurrected by a stale edit.
          if (change.type === "edit") return { ...current, name: change.name };
          if (change.type === "check")
            return { ...current, checked: change.checked };
          return { ...current, ".priority": change.priority };
        },
        { applyLocally: false },
      );
      if (!result.committed)
        throw new Error(
          "This item was removed in another tab. Your change was not saved.",
        );
    } finally {
      stop();
    }
  }
  disconnect() {
    goOffline(this.db);
  }
  reconnect() {
    goOnline(this.db);
  }
  close() {
    goOffline(this.db);
    void deleteApp(this.db.app);
  }
}
