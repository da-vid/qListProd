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
export const validID = (id: string) => /^[A-Za-z0-9_-]{6,128}$/.test(id);
export function newID(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(18)), (n) =>
    n.toString(16).padStart(2, "0"),
  ).join("");
}
export function route(path: string, cookie: string): string {
  const id = path.replace(/^\/|\/$/g, "");
  if (id && id !== "new") {
    if (!validID(id))
      throw new Error(
        "That list address is not valid. Open a list link or create a new list.",
      );
    return id;
  }
  const previous = cookie
    .split(";")
    .map((x) => x.trim())
    .find((x) => x.startsWith("lastList="))
    ?.slice(9);
  return id !== "new" && previous && validID(previous) ? previous : newID();
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
