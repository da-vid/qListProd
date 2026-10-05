import { initializeApp, deleteApp } from "firebase/app";
import {
  getDatabase,
  connectDatabaseEmulator,
  ref,
  get,
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
  SavedMetadataWarning,
  validID,
  validate,
} from "./model.ts";
export const DEMO_PROJECT = "demo-qlist";
export type DataNamespace = "" | "v2";
function dataPath(namespace: DataNamespace, path: string): string {
  if (namespace !== "" && namespace !== "v2")
    throw new Error("Unsupported data namespace");
  return namespace ? `${namespace}/${path}` : path;
}
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
export async function reserveFirebaseList(
  db: Database,
  id: string,
  onlyNew: boolean,
  namespace: DataNamespace = "",
): Promise<boolean> {
  if (!validID(id) || id === "new") throw new Error("Invalid list ID");
  const result = await runTransaction(
    ref(db, dataPath(namespace, `listClaims/${id}`)),
    (current) => (current === null ? true : undefined),
    { applyLocally: false },
  );
  if (!result.committed) return false;
  if (!onlyNew) return true;
  // Legacy-shaped data may predate the claims registry. Never assign its ID to a generated list.
  const [items, attrs] = await Promise.all([
    get(ref(db, dataPath(namespace, `lists/${id}`))),
    get(ref(db, dataPath(namespace, `listAttrs/${id}`))),
  ]);
  return !items.exists() && !attrs.exists();
}
export class FirebaseStore implements Store {
  readonly db: Database;
  readonly id: string;
  readonly namespace: DataNamespace;
  constructor(db: Database, id: string, namespace: DataNamespace = "") {
    this.db = db;
    this.id = id;
    dataPath(namespace, "");
    this.namespace = namespace;
    if (!validID(id)) throw new Error("Invalid list ID");
  }
  private path(path: string) {
    return dataPath(this.namespace, path);
  }
  subscribe(
    fn: (s: ListState) => void,
    connection: (b: boolean) => void,
    error: (e: Error) => void,
  ) {
    let state: ListState = { title: "", items: [] };
    let itemsReady = false,
      titleReady = false,
      active = true;
    const publish = () => {
      if (active && itemsReady && titleReady) fn(state);
    };
    const a = onValue(
      ref(this.db, this.path(`lists/${this.id}`)),
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
              priority: child.priority,
            });
        });
        state = { ...state, items: ordered(items) };
        itemsReady = true;
        publish();
      },
      error,
    );
    const b = onValue(
      ref(this.db, this.path(`listAttrs/${this.id}/listName`)),
      (snap) => {
        state = {
          ...state,
          title: typeof snap.val() === "string" ? snap.val() : "",
        };
        titleReady = true;
        publish();
      },
      error,
    );
    const c = onValue(ref(this.db, ".info/connected"), (snap) =>
      connection(snap.val() === true),
    );
    return () => {
      active = false;
      a();
      b();
      c();
    };
  }
  async apply(change: Change) {
    await this.write(change);
    try {
      await runTransaction(
        ref(this.db, this.path(`listAttrs/${this.id}/lastMod`)),
        (current) =>
          Math.max(
            typeof current === "number" ? current : 0,
            Math.floor(Date.now() / 1000),
          ),
        { applyLocally: false },
      );
    } catch {
      throw new SavedMetadataWarning();
    }
  }
  private async write(change: Change) {
    validate(change);
    if (change.type === "title") {
      await set(
        ref(this.db, this.path(`listAttrs/${this.id}/listName`)),
        change.title,
      );
      return;
    }
    if (change.type === "add") {
      const { key, priority, ...item } = change.item;
      // Random UUID-derived item key, reused on retry. Never derive identity from list length.
      const result = await runTransaction(
        ref(this.db, this.path(`lists/${this.id}/${key}`)),
        (current) => current ?? { ...item, ".priority": priority },
        { applyLocally: false },
      );
      if (!result.committed) throw new Error("Could not add item. Retry.");
      return;
    }
    const target = ref(this.db, this.path(`lists/${this.id}/${change.key}`));
    // Keep a listener alive while transacting: an empty SDK cache is not evidence of deletion.
    let stop = () => {};
    await new Promise<void>((resolve, reject) => {
      stop = onValue(target, () => resolve(), reject);
    });
    try {
      const result = await runTransaction(
        target,
        (current) => {
          // Re-evaluated on every server conflict: a stale checked UI is not authorization to delete.
          if (change.type === "delete")
            return current === null || current.checked === true
              ? null
              : undefined;
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
          change.type === "delete"
            ? "This item is not checked anymore. Check it before deleting."
            : "This item was removed in another tab. Your change was not saved.",
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
    closeDatabase(this.db);
  }
}

export function closeDatabase(db: Database) {
  goOffline(db);
  void deleteApp(db.app);
}
