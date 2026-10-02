export type Priority = number | string | null;
export interface Item {
  key: string;
  ID: number | string;
  name: string;
  checked: boolean;
  priority: Priority;
}
export interface ListState {
  title: string;
  items: Item[];
}
export type Change =
  | { type: "add"; item: Item }
  | { type: "edit"; key: string; name: string }
  | { type: "check"; key: string; checked: boolean }
  | { type: "move"; key: string; priority: Priority }
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
// Firebase's key comparator: signed 32-bit integer keys first (leading-zero
// ties by length), then raw UTF-16 string order. Locale collation is not RTDB order.
export function compareKeys(a: string, b: string): number {
  if (a === b) return 0;
  const integer = (key: string) => {
    if (!/^-?0*\d{1,10}$/.test(key)) return null;
    const value = Number(key);
    return value >= -2147483648 && value <= 2147483647 ? value : null;
  };
  const x = integer(a),
    y = integer(b);
  if (x !== null && y !== null) return x - y || a.length - b.length;
  if (x !== null) return -1;
  if (y !== null) return 1;
  return a < b ? -1 : 1;
}
function comparePriorities(a: Priority, b: Priority): number {
  if (a === b) return 0;
  const rank = (value: Priority) =>
    value === null ? 0 : typeof value === "number" ? 1 : 2;
  const typeOrder = rank(a) - rank(b);
  if (typeOrder) return typeOrder;
  return a! < b! ? -1 : 1;
}
function compareItems(
  a: Pick<Item, "key" | "priority">,
  b: Pick<Item, "key" | "priority">,
): number {
  return comparePriorities(a.priority, b.priority) || compareKeys(a.key, b.key);
}
export function ordered(items: Item[]): Item[] {
  return [...items].sort(compareItems);
}
function slotPriority(remaining: Item[], key: string, index: number): Priority {
  const before = remaining[index - 1],
    after = remaining[index];
  const lower = before?.priority,
    upper = after?.priority;
  let candidate: Priority;
  if (upper === null) candidate = null;
  else if (typeof lower === "string") candidate = lower + "!";
  else if (typeof upper === "number")
    candidate =
      typeof lower === "number" ? lower / 2 + upper / 2 : upper - 1024;
  else candidate = typeof lower === "number" ? lower + 1024 : 1024;
  // Never rewrite neighboring priorities to make room. Tied priorities are usable
  // only if this item's Firebase key order really fits in the requested slot.
  const candidates = [
    candidate,
    ...(typeof lower === "string" ? [lower + "\u0000"] : []),
    lower,
    upper,
  ];
  for (const priority of candidates) {
    if (
      priority === undefined ||
      (typeof priority === "number" && !Number.isFinite(priority))
    )
      continue;
    const target = { key, priority };
    if (
      (!before || compareItems(before, target) < 0) &&
      (!after || compareItems(target, after) < 0)
    )
      return priority;
  }
  throw new Error(
    "These items have the same order or legacy priorities with no room for this move. Nothing was changed; move to another position.",
  );
}
export function appendPriority(items: Item[], key: string): Priority {
  const sorted = ordered(items);
  return slotPriority(sorted, key, sorted.length);
}
export function movePriority(
  items: Item[],
  key: string,
  direction: -1 | 1,
): Priority {
  const list = ordered(items);
  const i = list.findIndex((x) => x.key === key);
  const j = i + direction;
  if (i < 0 || j < 0 || j >= list.length)
    throw new Error("Already at the edge of the list.");
  const remaining = list.filter((x) => x.key !== key);
  return moveBeforePriority(items, key, remaining[j]?.key ?? null);
}
// An anchor key, rather than a stale index, keeps a drop relative to current data.
export function moveBeforePriority(
  items: Item[],
  key: string,
  anchor: string | null,
): Priority {
  if (!items.some((x) => x.key === key))
    throw new Error("This item was removed in another tab.");
  const remaining = ordered(items).filter((x) => x.key !== key);
  const j =
    anchor === null
      ? remaining.length
      : remaining.findIndex((x) => x.key === anchor);
  if (j < 0)
    throw new Error("The list changed while dragging. Please try again.");
  return slotPriority(remaining, key, j);
}

export function validate(change: Change): void {
  if (change.type === "add" || change.type === "move") {
    const priority =
      change.type === "add" ? change.item.priority : change.priority;
    if (
      priority !== null &&
      typeof priority !== "string" &&
      !(typeof priority === "number" && Number.isFinite(priority))
    )
      throw new Error("Invalid item priority.");
  }
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

// The user operation is committed: retrying it could overwrite a newer edit.
export class SavedMetadataWarning extends Error {
  constructor() {
    super(
      "Your change was saved, but its activity timestamp could not be updated. Do not retry that change; check the current list before editing again.",
    );
    this.name = "SavedMetadataWarning";
  }
}
