import { inspectJpeg } from "../../src/photo/jpeg.ts";
import { readJpegUpload } from "../upload-boundary.ts";
import {
  BetaError,
  RESERVATION,
  demand,
  open,
  maintain,
  scope,
  transact,
  type Ledger,
  type Operation,
} from "./ledger.ts";
import { validScope, type TextAuthority } from "./text-authority.ts";
export type Pair = { full: Uint8Array; thumbnail: Uint8Array };
export type StoragePort = {
  put(key: string, bytes: Uint8Array, signal: AbortSignal): Promise<void>;
  read(key: string, signal: AbortSignal): Promise<Uint8Array>;
  remove(keys: string[], signal: AbortSignal): Promise<void>;
  exists(key: string, signal: AbortSignal): Promise<boolean>;
};
export const objectKey = (id: string) => `beta-v1/${id}/full.jpg`;
const hash = async (bytes: Uint8Array) =>
  Array.from(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", Uint8Array.from(bytes)),
    ),
  )
    .map((n) => n.toString(16).padStart(2, "0"))
    .join("");
export class BetaEngine {
  readonly ledger: Ledger;
  readonly storage: StoragePort;
  readonly text: TextAuthority;
  readonly process: (input: Uint8Array) => Promise<Pair>;
  readonly now: () => number;
  constructor(deps: {
    ledger: Ledger;
    storage: StoragePort;
    text: TextAuthority;
    process: (input: Uint8Array) => Promise<Pair>;
    now?: () => number;
  }) {
    this.ledger = deps.ledger;
    this.storage = deps.storage;
    this.text = deps.text;
    this.process = deps.process;
    this.now = deps.now ?? Date.now;
  }
  async admit(
    list: string,
    item: string,
    signal: AbortSignal,
    maintenance = false,
  ) {
    validScope(list, item);
    await transact(this.ledger, signal, (s) => {
      if (maintenance) maintain(s, list);
      else open(s, list, this.now());
      const minute = Math.floor(this.now() / 60000);
      if (maintenance) {
        if (s.state.maintenanceMinute !== minute) {
          s.state.maintenanceMinute = minute;
          s.state.maintenanceRequests = 0;
        }
        s.state.maintenanceRequests++;
        return;
      }
      if (s.state.minute !== minute) {
        s.state.minute = minute;
        s.state.minuteRequests = 0;
      }
      s.state.minuteRequests++;
      s.state.requests++;
    });
  }
  async verify(
    list: string,
    item: string,
    signal: AbortSignal,
    allowMissing = false,
  ) {
    const check = await this.text(list, item, signal);
    demand(
      check.listExists && (check.itemExists || allowMissing),
      "The text list or item is unavailable.",
      404,
    );
    return check;
  }
  async put(
    list: string,
    item: string,
    id: string,
    expected: number,
    request: Request,
    signal: AbortSignal,
  ) {
    demand(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(
        id,
      ) &&
        Number.isSafeInteger(expected) &&
        expected >= 0,
      "Invalid save request.",
      400,
    );
    await this.verify(list, item, signal);
    const fresh = await transact(this.ledger, signal, (s) => {
      open(s, list, this.now());
      const old = s.state.ops[id];
      if (old) {
        demand(
          old.list === list && old.item === item && old.expected === expected,
          "Save request changed.",
        );
        return false;
      }
      const key = scope(list, item),
        it = (s.state.items[key] ??= {
          list,
          item,
          epoch: 0,
          version: 0,
          deleted: false,
        });
      demand(
        !it.deleted && (it.current ? it.version : 0) === expected,
        "This photo changed. Reopen it.",
      );
      demand(
        !Object.values(s.state.ops).some(
          (o) => o.list === list && o.item === item && o.state === "pending",
        ),
        "A save is already pending.",
      );
      s.state.items[key] = it;
      s.state.ops[id] = {
        id,
        list,
        item,
        expected,
        epoch: it.epoch,
        state: "pending",
        writes: ["planned"],
        sizes: [],
        hashes: [],
        lease: this.now() + 30000,
      };
      return true;
    });
    try {
      const input = await readJpegUpload(request, 4000),
        fingerprint = await hash(input);
      demand(
        inspectJpeg(input).sanitized.length === input.length,
        "Prepare the JPEG again to remove metadata.",
        400,
      );
      if (!fresh) {
        const op = (await this.ledger.load(signal)).state.ops[id];
        demand(op.hash === fingerprint, "Save request changed.");
        demand(
          op.version !== undefined,
          "Save is pending or failed. Check status.",
        );
        return { version: op.version };
      }
      await transact(this.ledger, signal, (s) => {
        const op = s.state.ops[id];
        demand(op.state === "pending", "Save was cancelled.");
        op.hash = fingerprint;
      });
      const pair = await this.process(input),
        outputs = [pair.full];
      for (let n = 0; n < 1; n++) {
        const p = inspectJpeg(outputs[n], {
          maxBytes: n ? 32768 : 393216,
          maxEdge: n ? 192 : 1280,
        });
        demand(
          p.sanitized.length === outputs[n].length,
          "Processor metadata check failed.",
          503,
        );
      }
      const hashes = await Promise.all(outputs.map(hash));
      await transact(this.ledger, signal, (s) => {
        const op = s.state.ops[id];
        demand(op.state === "pending", "Save was cancelled.");
        op.sizes = outputs.map((b) => b.length);
        op.hashes = hashes;
      });
      for (let n = 0; n < 1; n++) {
        await transact(this.ledger, signal, (s) => {
          open(s, list, this.now());
          const op = s.state.ops[id],
            it = s.state.items[scope(list, item)];
          demand(
            op.state === "pending" &&
              op.lease > this.now() &&
              !it.deleted &&
              it.epoch === op.epoch &&
              (it.current ? it.version : 0) === expected &&
              op.writes[n] === "planned",
            "Save was fenced.",
          );
          op.writes[n] = "writing";
        });
        // A grant is consumed before PUT. Rejection/timeout is an unknown writer: never retry or refund it.
        await this.storage.put(objectKey(id), outputs[n], signal);
        await transact(this.ledger, signal, (s) => {
          s.state.ops[id].writes[n] = "stored";
        });
      }
      await this.verify(list, item, signal);
      const version = await transact(this.ledger, signal, (s) => {
        open(s, list, this.now());
        const op = s.state.ops[id],
          it = s.state.items[scope(list, item)];
        demand(
          op.state === "pending" &&
            op.lease > this.now() &&
            op.writes.every((w) => w === "stored") &&
            !it.deleted &&
            it.epoch === op.epoch &&
            (it.current ? it.version : 0) === expected,
          "Save was fenced.",
        );
        if (it.current) s.state.ops[it.current].state = "cleanup";
        it.version++;
        it.current = id;
        op.state = "committed";
        op.version = it.version;
        return it.version;
      });
      await this.cleanup(list, item, signal).catch(() => {});
      return { version };
    } catch (error) {
      if (fresh) {
        await transact(this.ledger, signal, (s) => {
          const op = s.state.ops[id];
          if (op.state !== "committed" && op.state !== "released")
            op.state = op.writes.every((w) => w === "planned")
              ? "released"
              : "cleanup";
        }).catch(() => {});
        await this.cleanup(list, item, signal).catch(() => {});
      }
      throw error;
    }
  }
  async get(list: string, item: string, signal: AbortSignal) {
    const check = await this.text(list, item, signal);
    if (check.itemAbsent) {
      await this.fenceDeleted(list, item, signal);
      await this.cleanup(list, item, signal);
    }
    demand(
      check.listExists && check.itemExists,
      "The text list or item is unavailable.",
      404,
    );
    const op = await transact(this.ledger, signal, (s) => {
      maintain(s, list);
      const it = s.state.items[scope(list, item)];
      if (!it?.current) return undefined;
      // Observability only, never a lifetime read allowance.
      s.state.reads++;
      s.state.readBytes += RESERVATION;
      return structuredClone(s.state.ops[it.current]);
    });
    if (!op) return undefined;
    const bytes = await this.storage.read(objectKey(op.id), signal);
    demand(
      bytes.length === op.sizes[0] && (await hash(bytes)) === op.hashes[0],
      "Photo verification failed.",
      503,
    );
    inspectJpeg(bytes, { maxBytes: RESERVATION, maxEdge: 1280 });
    const after = await this.text(list, item, signal);
    if (after.itemAbsent) {
      await this.fenceDeleted(list, item, signal);
      await this.cleanup(list, item, signal);
    }
    demand(
      after.listExists && after.itemExists,
      "The text list or item is unavailable.",
      404,
    );
    const latest = await this.ledger.load(signal);
    maintain(latest, list);
    demand(
      latest.state.items[scope(list, item)]?.current === op.id,
      "Photo changed. Retry.",
    );
    return { version: op.version!, full: bytes };
  }
  // Read-only lifecycle status: admission counters are the only write.
  async status(list: string, item: string, id: string, signal: AbortSignal) {
    const s = await this.ledger.load(signal);
    maintain(s, list);
    const op = s.state.ops[id];
    if (!op || op.list !== list || op.item !== item) return undefined;
    return {
      state:
        op.version !== undefined
          ? "committed"
          : op.state === "pending"
            ? "pending"
            : "failed",
      version: s.state.items[scope(list, item)]?.version,
      cleanup: op.state === "cleanup",
      unknownWriter: op.writes.includes("writing"),
    };
  }
  // No public scan route. The server invokes this on reads (or an existing trusted operator).
  // Durable cursor works after restart/lost browser state; one tracked item per invocation.
  // Only definite authoritative absence fences a deleted text item. No TTL.
  async reconcile(list: string, signal: AbortSignal) {
    await this.admit(list, "maintenance", signal, true);
    const selected = await transact(this.ledger, signal, (s) => {
      maintain(s, list);
      const keys = Object.keys(s.state.items)
        .filter((k) => s.state.items[k].list === list)
        .sort();
      const key = keys.find((k) => k > s.state.reconciliationCursor) ?? keys[0];
      if (!key) return undefined;
      s.state.reconciliationCursor = key;
      const it = s.state.items[key];
      for (const op of Object.values(s.state.ops)) {
        if (
          op.list === list &&
          op.item === it.item &&
          op.state === "pending" &&
          op.lease <= this.now()
        )
          op.state = op.writes.every((w) => w === "planned")
            ? "released"
            : "cleanup";
      }
      return { item: it.item, epoch: it.epoch };
    });
    if (!selected) return { scanned: 0 };
    // An outage must not block already-authorized cleanup or become a deletion signal.
    const check = await this.text(list, selected.item, signal).catch(
      () => undefined,
    );
    if (check?.itemAbsent) await this.fenceDeleted(list, selected.item, signal);
    await this.cleanup(list, selected.item, signal);
    const s = await this.ledger.load(signal);
    return {
      scanned: 1,
      item: selected.item,
      textUnavailable: !check,
      unknownWriters: Object.values(s.state.ops).filter(
        (o) =>
          o.list === list &&
          o.item === selected.item &&
          o.writes.includes("writing"),
      ).length,
    };
  }
  private async fenceDeleted(list: string, item: string, signal: AbortSignal) {
    await transact(this.ledger, signal, (s) => {
      maintain(s, list);
      const it = s.state.items[scope(list, item)];
      if (!it || it.deleted) return;
      it.deleted = true;
      this.fence(s.state, list, item);
    });
  }
  private fence(
    state: import("./ledger.ts").State,
    list: string,
    item: string,
  ) {
    const it = state.items[scope(list, item)];
    it.epoch++;
    it.version++;
    delete it.current;
    for (const op of Object.values(state.ops))
      if (op.list === list && op.item === item && op.state !== "released")
        op.state = op.writes.every((w) => w === "planned")
          ? "released"
          : "cleanup";
  }
  async remove(
    list: string,
    item: string,
    expected: number | undefined,
    deleted: boolean,
    signal: AbortSignal,
  ) {
    if (deleted) {
      // DOM disappearance is merely a hint. Present, malformed or unreachable text cannot delete photos.
      const check = await this.text(list, item, signal);
      demand(
        check.itemAbsent,
        "Text deletion is not confirmed. Photo retained.",
        409,
      );
      await this.fenceDeleted(list, item, signal);
    } else
      await transact(this.ledger, signal, (s) => {
        maintain(s, list);
        const it = s.state.items[scope(list, item)];
        if (!it) return;
        demand(
          Number.isSafeInteger(expected) && expected! > 0,
          "Invalid version.",
          400,
        );
        if (!it.current) return;
        demand(it.version === expected, "Photo changed. Reopen it.");
        this.fence(s.state, list, item);
      });
    await this.cleanup(list, item, signal);
  }
  // Cleanup consumes only explicitly fenced, settled objects. No retained-photo TTL.
  async cleanup(list: string, item: string, signal: AbortSignal) {
    const snapshot = await this.ledger.load(signal);
    maintain(snapshot, list);
    for (const op of Object.values(snapshot.state.ops)) {
      if (
        op.list !== list ||
        op.item !== item ||
        op.state !== "cleanup" ||
        op.writes.includes("writing")
      )
        continue;
      const keys = op.writes.flatMap((w, n) =>
        w === "stored" ? [objectKey(op.id)] : [],
      );
      await this.storage.remove(keys, signal);
      for (const key of keys)
        demand(
          !(await this.storage.exists(key, signal)),
          "Photo cleanup is waiting.",
          503,
        );
      await transact(this.ledger, signal, (s) => {
        maintain(s, list);
        const current = s.state.ops[op.id];
        if (current.state === "released") return;
        demand(
          current.state === "cleanup" &&
            !current.writes.includes("writing") &&
            s.state.items[scope(list, item)]?.current !== op.id,
          "Cleanup was fenced.",
        );
        current.state = "released";
      });
      break; // At most one object per request; remaining markers persist in the ledger.
    }
  }
}
