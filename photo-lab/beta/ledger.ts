// Authoritative server reducer; never import into the ordinary qList client.
export const RESERVATION = 425984;
export const PROPOSED = Object.freeze({
  bytes: 10485760,
  photos: 20,
  operations: 100,
  items: 100,
  reads: 100,
  readBytes: 5242880,
  pending: 2,
  requests: 500,
  perMinute: 30,
});
export class BetaError extends Error {
  readonly status: number;
  constructor(message: string, status = 409) {
    super(message);
    this.status = status;
  }
}
export type Control = {
  enabled: boolean;
  lists: string[];
  until: number | null;
};
export type Legacy = {
  bytes: number;
  photos: number;
  operations: number;
  items: number;
  reads: number;
  readBytes: number;
  pending: number;
};
export type Operation = {
  id: string;
  list: string;
  item: string;
  expected: number;
  epoch: number;
  hash?: string;
  state: "pending" | "committed" | "cleanup" | "released";
  writes: ("planned" | "writing" | "stored")[];
  sizes: number[];
  hashes: string[];
  lease: number;
  version?: number;
};
export type Item = {
  list: string;
  item: string;
  epoch: number;
  version: number;
  current?: string;
  deleted: boolean;
};
export type State = {
  ops: Record<string, Operation>;
  items: Record<string, Item>;
  requests: number;
  reads: number;
  readBytes: number;
  minute: number;
  minuteRequests: number;
};
export type Snapshot = {
  revision: number;
  control: Control;
  legacy: Legacy;
  state: State;
  legacyToken: string;
};
export interface Ledger {
  load(signal: AbortSignal): Promise<Snapshot>;
  swap(before: Snapshot, state: State, signal: AbortSignal): Promise<boolean>;
}
export const emptyState = (): State => ({
  ops: {},
  items: {},
  requests: 0,
  reads: 0,
  readBytes: 0,
  minute: 0,
  minuteRequests: 0,
});
export const scope = (list: string, item: string) =>
  JSON.stringify([list, item]);
export const demand = (ok: unknown, message: string, status = 409): void => {
  if (!ok) throw new BetaError(message, status);
};
export function open(s: Snapshot, list: string, now: number) {
  demand(
    s.control.enabled &&
      s.control.until !== null &&
      Number.isSafeInteger(s.control.until) &&
      now < s.control.until,
    "Photos are paused.",
    503,
  );
  demand(
    s.control.lists.includes(list),
    "Photos are unavailable for this list.",
    403,
  );
}
export function assertCaps(s: Snapshot, state: State) {
  const ops = Object.values(state.ops),
    active = ops.filter((o) => o.state !== "released");
  demand(
    s.legacy.bytes + active.length * RESERVATION <= PROPOSED.bytes &&
      s.legacy.photos + active.length <= PROPOSED.photos,
    "Photo storage limit reached.",
    429,
  );
  demand(
    s.legacy.operations + ops.length <= PROPOSED.operations &&
      s.legacy.items + Object.keys(state.items).length <= PROPOSED.items,
    "Photo history limit reached.",
    429,
  );
  demand(
    s.legacy.pending +
      ops.filter((o) => o.state === "pending" || o.writes.includes("writing"))
        .length <=
      PROPOSED.pending,
    "Photo processing is busy.",
    429,
  );
  demand(
    s.legacy.reads + state.reads <= PROPOSED.reads &&
      s.legacy.readBytes + state.readBytes <= PROPOSED.readBytes,
    "Photo delivery limit reached.",
    429,
  );
  demand(
    state.requests <= PROPOSED.requests &&
      state.minuteRequests <= PROPOSED.perMinute,
    "Too many photo requests.",
    429,
  );
}
export async function transact<T>(
  ledger: Ledger,
  signal: AbortSignal,
  change: (s: Snapshot) => T,
): Promise<T> {
  for (let n = 0; n < 12; n++) {
    signal.throwIfAborted();
    const s = await ledger.load(signal),
      before = structuredClone(s);
    const result = change(s);
    assertCaps(s, s.state);
    if (await ledger.swap(before, s.state, signal)) return result;
  }
  throw new BetaError("Photos are busy. Retry later.", 503);
}
// Test-only reference store, optionally restored from a serialized snapshot.
export class MemoryLedger implements Ledger {
  value: Snapshot;
  constructor(value?: Snapshot) {
    this.value = value ?? {
      revision: 0,
      control: { enabled: false, lists: [], until: null },
      legacy: {
        bytes: 0,
        photos: 0,
        operations: 9,
        items: 6,
        reads: 6,
        readBytes: 2359296,
        pending: 0,
      },
      legacyToken: "synthetic-accepted-trial",
      state: emptyState(),
    };
  }
  async load(signal: AbortSignal) {
    signal.throwIfAborted();
    return structuredClone(this.value);
  }
  async swap(before: Snapshot, state: State, signal: AbortSignal) {
    signal.throwIfAborted();
    if (
      before.revision !== this.value.revision ||
      before.legacyToken !== this.value.legacyToken ||
      JSON.stringify(before.control) !== JSON.stringify(this.value.control)
    )
      return false;
    this.value = {
      ...this.value,
      revision: this.value.revision + 1,
      state: structuredClone(state),
    };
    return true;
  }
}
