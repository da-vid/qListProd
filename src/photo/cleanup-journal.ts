import { validID } from "../model.ts";
import { PhotoError } from "./jpeg.ts";
export type CleanupJournal = {
  load(): string[];
  add(key: string): void;
  remove(key: string): void;
};
// Device-local retry intent only: item keys, never images, text, credentials or quota state.
// One marker per item avoids one tab overwriting another tab's cleanup intents.
export function cleanupJournal(
  storage: Pick<
    Storage,
    "length" | "key" | "getItem" | "setItem" | "removeItem"
  >,
  list: string,
): CleanupJournal {
  if (!validID(list) || list === "new")
    throw new PhotoError("Invalid cleanup list.");
  const prefix = "qlist.photo.cleanup.v1:" + encodeURIComponent(list) + ":";
  const valid = (key: string) => {
    if (!validID(key) || key === "__proto__")
      throw new PhotoError("Invalid cleanup item.");
    return key;
  };
  const load = () => {
    if (storage.length > 10000)
      throw new PhotoError("Cleanup retry storage is unavailable.");
    const keys: string[] = [];
    for (let i = 0; i < storage.length; i++) {
      const name = storage.key(i);
      if (!name?.startsWith(prefix)) continue;
      if (storage.getItem(name) !== "1")
        throw new PhotoError("Cleanup retry data is unavailable.");
      keys.push(valid(decodeURIComponent(name.slice(prefix.length))));
      if (keys.length > 100)
        throw new PhotoError("Cleanup retry limit reached.");
    }
    return keys;
  };
  return {
    load,
    add: (key) => {
      valid(key);
      const keys = load();
      if (keys.length >= 100 && !keys.includes(key))
        throw new PhotoError("Cleanup retry limit reached.");
      storage.setItem(prefix + encodeURIComponent(key), "1");
    },
    remove: (key) =>
      storage.removeItem(prefix + encodeURIComponent(valid(key))),
  };
}
