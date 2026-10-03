// Authoritative server reducer; never import into the ordinary qList client.
export const RESERVATION = 393216;
// Proposal only. One stored JPEG per item; replacement/unknown bytes stay counted.
export const PROPOSED = Object.freeze({
  bytes: 32 * 1048576,
  pending: 4,
  perMinute: 60,
  maintenancePerMinute: 60,
});
// Historical trial usage is retained and included, never reset or transferred into beta counters.
export const PROJECT = Object.freeze({ bytes: 64 * 1048576 });
export class BetaError extends Error {
  readonly status: number;
  constructor(message: string, status = 409) {
    super(message);
    this.status = status;
  }
}
export type Control = {
  enabled: boolean;
  maintenance: boolean;
  lists: string[];
  allLists?: boolean;
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
};
export type State = {
  ops: Record<string, Operation>;
  items: Record<string, Item>;
  requests: number;
  reads: number;
  readBytes: number;
  minute: number;
  minuteRequests: number;
  maintenanceMinute: number;
  maintenanceRequests: number;
  reconciliationCursor: string;
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
  maintenanceMinute: 0,
  maintenanceRequests: 0,
  reconciliationCursor: "",
});
export const scope = (list: string, item: string) =>
  JSON.stringify([list, item]);
export const demand = (ok: unknown, message: string, status = 409): void => {
  if (!ok) throw new BetaError(message, status);
};
export function open(s: Snapshot, list: string, now: number) {
  demand(
    s.control.enabled,
    "Photo uploads are paused. Existing photos can still be viewed or removed.",
    503,
  );
  demand(
    s.control.allLists === true || s.control.lists.includes(list),
    "Photos are unavailable for this list.",
    403,
  );
}
export function maintain(s: Snapshot, list: string) {
  demand(s.control.maintenance, "Photo maintenance is paused.", 503);
  demand(
    s.control.allLists === true || s.control.lists.includes(list),
    "Photos are unavailable for this list.",
    403,
  );
}
export function assertCaps(s: Snapshot, state: State, before: State) {
  const used = (v: State) =>
    Object.values(v.ops).filter((o) => o.state !== "released").length *
    RESERVATION;
  const next = used(state),
    old = used(before);
  // Recovery remains possible even if independently observed historical usage increases.
  const cap = (n: number, previous: number, limit: number, message: string) =>
    demand(n <= limit || n <= previous, message, 429);
  cap(
    next,
    old,
    PROPOSED.bytes,
    "Photo storage is full. Remove a photo before adding another.",
  );
  cap(
    s.legacy.bytes + next,
    s.legacy.bytes + old,
    PROJECT.bytes,
    "Photo storage is full. Remove a photo before adding another.",
  );
  const busy = (v: State) =>
    Object.values(v.ops).filter(
      (o) => o.state === "pending" && o.lease > Date.now(),
    ).length;
  cap(busy(state), busy(before), PROPOSED.pending, "Photo processing is busy.");
  demand(
    state.minuteRequests <= PROPOSED.perMinute,
    "Too many photo requests. Retry shortly.",
    429,
  );
  demand(
    state.maintenanceRequests <= PROPOSED.maintenancePerMinute,
    "Too many photo requests. Retry shortly.",
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
    assertCaps(s, s.state, before.state);
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
      control: { enabled: false, maintenance: false, lists: [] },
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
