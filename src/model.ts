export interface Item {
  key: string;
  ID: number | string;
  name: string;
  checked: boolean;
  priority: number;
}
export interface ListState {
  title: string;
  items: Item[];
}
export type Change =
  | { type: "add"; item: Item }
  | { type: "edit"; key: string; name: string }
  | { type: "check"; key: string; checked: boolean }
  | { type: "move"; key: string; priority: number }
  | { type: "delete"; key: string }
  | { type: "title"; title: string };
export interface Store {
  subscribe(
    fn: (state: ListState) => void,
    connection: (online: boolean) => void,
    error: (error: Error) => void,
  ): () => void;
  apply(change: Change): Promise<void>;
  close(): void;
}
export function validID(id: string): boolean {
  if (!id || /[.#$\[\]\/\u0000-\u001f\u007f]/.test(id)) return false;
  try {
    return encodeURIComponent(id).replace(/%[a-f\d]{2}/gi, "x").length <= 768;
  } catch {
    return false;
  }
}
export function newID(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789";
  const limit = 256 - (256 % alphabet.length);
  let id = "";
  while (id.length < 6)
    for (const n of crypto.getRandomValues(new Uint8Array(12))) {
      if (n < limit) id += alphabet[n % alphabet.length];
      if (id.length === 6) break;
    }
  return id;
}
export function routeRequest(path: string, cookie: string): string | null {
  if (!path.startsWith("/") || path.includes("?") || path.includes("#"))
    throw new Error(
      "Use one list name in the URL path; query strings and fragments are not list names.",
    );
  let id: string;
  try {
    id = decodeURIComponent(path.slice(1).replace(/\/$/, ""));
  } catch {
    throw new Error("That list address contains invalid URL encoding.");
  }
  if (id && id !== "new") {
    if (!validID(id))
      throw new Error(
        "Use a single list name, up to 768 UTF-8 bytes, without . # $ [ ] / or control characters.",
      );
    return id;
  }
  if (id === "new") return null;
  const raw = cookie
    .split(";")
    .map((x) => x.trim())
    .find((x) => x.startsWith("lastList="))
    ?.slice(9);
  try {
    const previous = raw ? decodeURIComponent(raw) : "";
    return previous !== "new" && validID(previous) ? previous : null;
  } catch {
    return null;
  }
}
export function route(path: string, cookie: string): string {
  return routeRequest(path, cookie) ?? newID();
}
export async function reserveGeneratedID(
  reserve: (id: string) => Promise<boolean>,
  generate: () => string = newID,
): Promise<string> {
  for (let attempt = 0; attempt < 10; attempt++) {
    const id = generate();
    if (await reserve(id)) return id;
  }
  throw new Error(
    "Could not reserve an unused list address. Please try creating a new list again.",
  );
}
export function ordered(items: Item[]): Item[] {
  return [...items].sort(
    (a, b) => a.priority - b.priority || a.key.localeCompare(b.key),
  );
}
export function movePriority(
  items: Item[],
  key: string,
  direction: -1 | 1,
): number {
  const list = ordered(items);
  const i = list.findIndex((x) => x.key === key);
  const j = i + direction;
  if (i < 0 || j < 0 || j >= list.length)
    throw new Error("Already at the edge of the list.");
  const remaining = list.filter((x) => x.key !== key);
  const before = remaining[j - 1]?.priority;
  const after = remaining[j]?.priority;
  const value =
    before === undefined
      ? after! - 1024
      : after === undefined
        ? before + 1024
        : (before + after) / 2;
  if (!Number.isFinite(value) || value === before || value === after)
    throw new Error(
      "These items have the same order after simultaneous moves. Move one to the top or bottom, then try again.",
    );
  return value;
}
export function validate(change: Change): void {
  if (change.type === "title" && change.title.length > 160)
    throw new Error("Keep list titles under 160 characters.");
  if (
    (change.type === "edit" &&
      (!change.name.trim() || change.name.length > 1000)) ||
    (change.type === "add" &&
      (!change.item.name.trim() || change.item.name.length > 1000))
  )
    throw new Error("Enter an item between 1 and 1,000 characters.");
}
