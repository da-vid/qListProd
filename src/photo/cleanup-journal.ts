import { validID } from "../model.ts";
import { PhotoError } from "./jpeg.ts";
export type CleanupIntent = { key: string; version: number };
export type CleanupJournal = {
  load(): CleanupIntent[];
  add(intent: CleanupIntent): void;
  remove(intent: CleanupIntent): void;
};
// Exact device-local removal intents. Older unversioned v1 hints cannot authorize removal.
export function cleanupJournal(
  storage: Pick<
    Storage,
    "length" | "key" | "getItem" | "setItem" | "removeItem"
  >,
  list: string,
): CleanupJournal {
  if (!validID(list) || list === "new")
    throw new PhotoError("Invalid cleanup list.");
  const prefix = "qlist.photo.cleanup.v2:" + encodeURIComponent(list) + ":";
  const valid = (intent: CleanupIntent) => {
    if (
      !intent ||
      !validID(intent.key) ||
      intent.key === "__proto__" ||
      !Number.isSafeInteger(intent.version) ||
      intent.version < 0
    )
      throw new PhotoError("Invalid cleanup intent.");
    return intent;
  };
  const name = (intent: CleanupIntent) =>
    prefix + encodeURIComponent(JSON.stringify(valid(intent)));
  const load = () => {
    if (storage.length > 10000)
      throw new PhotoError("Cleanup retry storage is unavailable.");
    const intents: CleanupIntent[] = [];
    for (let i = 0; i < storage.length; i++) {
      const key = storage.key(i);
      if (!key?.startsWith(prefix)) continue;
      if (storage.getItem(key) !== "1")
        throw new PhotoError("Cleanup retry data is unavailable.");
      intents.push(
        valid(JSON.parse(decodeURIComponent(key.slice(prefix.length)))),
      );
      if (intents.length > 100)
        throw new PhotoError("Cleanup retry limit reached.");
    }
    return intents;
  };
  return {
    load,
    add: (intent) => {
      const key = name(intent);
      if (load().length >= 100 && storage.getItem(key) !== "1")
        throw new PhotoError("Cleanup retry limit reached.");
      storage.setItem(key, "1");
    },
    remove: (intent) => storage.removeItem(name(intent)),
  };
}
