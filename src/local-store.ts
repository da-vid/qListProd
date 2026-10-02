import {
  type Change,
  type Item,
  type ListState,
  type Store,
  ordered,
  validate,
} from "./model.ts";
// One immutable operation per key: concurrent tabs never replace a whole list.
export class LocalStore implements Store {
  private prefix: string;
  private notify: () => void = () => {};
  private onError: (e: Error) => void = () => {};
  private storage: Storage;
  constructor(id: string, storage: Storage = localStorage) {
    this.storage = storage;
    this.prefix = `qlist:modern:v1:${encodeURIComponent(id)}:`;
  }
  private read(): ListState {
    const changes: { stamp: string; change: Change; checkedOnly?: boolean }[] =
      [];
    for (let i = 0; i < this.storage.length; i++) {
      const key = this.storage.key(i)!;
      if (key.startsWith(this.prefix))
        changes.push(JSON.parse(this.storage.getItem(key)!));
    }
    changes.sort((a, b) => a.stamp.localeCompare(b.stamp));
    const items = new Map<string, Item>();
    const deleted = new Set<string>();
    let title = "";
    for (const { change: c, checkedOnly } of changes) {
      if (c.type === "title") {
        title = c.title;
        continue;
      }
      if (c.type === "add") {
        if (!deleted.has(c.item.key)) items.set(c.item.key, { ...c.item });
        continue;
      }
      if (c.type === "delete") {
        // Older preview records keep their historical meaning; new deletes are conditional.
        if (checkedOnly && items.has(c.key) && !items.get(c.key)!.checked)
          continue;
        deleted.add(c.key);
        items.delete(c.key);
        continue;
      }
      const item = items.get(c.key);
      if (!item) continue;
      if (c.type === "edit") item.name = c.name;
      if (c.type === "check") item.checked = c.checked;
      if (c.type === "move") item.priority = c.priority;
    }
    return { title, items: ordered([...items.values()]) };
  }
  subscribe(
    fn: (s: ListState) => void,
    connection: (b: boolean) => void,
    error: (e: Error) => void,
  ) {
    this.onError = error;
    this.notify = () => {
      try {
        fn(this.read());
      } catch (e) {
        error(e as Error);
      }
    };
    const listener = (event: StorageEvent) => {
      if (event.key?.startsWith(this.prefix)) this.notify();
    };
    window.addEventListener("storage", listener);
    connection(true);
    this.notify();
    return () => window.removeEventListener("storage", listener);
  }
  async apply(change: Change) {
    validate(change);
    const write = async () => this.write(change);
    if (navigator.locks) await navigator.locks.request(this.prefix, write);
    else await write();
  }
  private write(change: Change) {
    if (change.type === "delete") {
      const item = this.read().items.find((x) => x.key === change.key);
      if (item && !item.checked)
        throw new Error(
          "This item is not checked anymore. Check it before deleting.",
        );
    }
    let clock = Date.now();
    for (let i = 0; i < this.storage.length; i++) {
      const key = this.storage.key(i)!;
      if (key.startsWith(this.prefix))
        clock = Math.max(
          clock,
          Number(key.slice(this.prefix.length).split("-")[0]) + 1,
        );
    }
    const stamp =
      clock.toString().padStart(16, "0") + "-" + crypto.randomUUID();
    this.storage.setItem(
      this.prefix + stamp,
      JSON.stringify({ stamp, change, checkedOnly: change.type === "delete" }),
    );
    this.notify();
  }
  close() {}
}

// Web Locks serialize reservations across tabs in the same browser profile.
export async function reserveLocalList(
  id: string,
  onlyNew: boolean,
  storage: Storage = localStorage,
): Promise<boolean> {
  const claim = `qlist:claims:v1:${encodeURIComponent(id)}`;
  const action = () => {
    if (storage.getItem(claim) !== null) return false;
    const prefix = `qlist:modern:v1:${encodeURIComponent(id)}:`;
    const exists =
      storage.getItem(`qlist:synthetic:v1:${id}`) !== null ||
      Array.from({ length: storage.length }, (_, i) => storage.key(i)!).some(
        (key) => key.startsWith(prefix),
      );
    storage.setItem(claim, "reserved");
    return !onlyNew || !exists;
  };
  if (navigator.locks)
    return navigator.locks.request("qlist-list-reservation", action);
  if (onlyNew)
    throw new Error(
      "This browser cannot safely reserve a random list address. Open a custom list URL instead.",
    );
  return action();
}
