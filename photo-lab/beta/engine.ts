import { inspectJpeg } from "../../src/photo/jpeg.ts";
import { readJpegUpload } from "../upload-boundary.ts";
import {
  BetaError,
  RESERVATION,
  demand,
  open,
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
export const objectKey = (id: string, n: number) =>
  `beta-v1/${id}/${n === 0 ? "full" : "thumb"}.jpg`;
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
  async admit(list: string, item: string, signal: AbortSignal) {
    validScope(list, item);
    await transact(this.ledger, signal, (s) => {
      open(s, list, this.now());
      const minute = Math.floor(this.now() / 60000);
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
        writes: ["planned", "planned"],
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
        outputs = [pair.full, pair.thumbnail];
      for (let n = 0; n < 2; n++) {
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
      for (let n = 0; n < 2; n++) {
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
        await this.storage.put(objectKey(id, n), outputs[n], signal);
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
    await this.verify(list, item, signal);
    const op = await transact(this.ledger, signal, (s) => {
      open(s, list, this.now());
      const it = s.state.items[scope(list, item)];
      if (!it?.current) return undefined;
      s.state.reads += 2; // Full and thumbnail: charge both Storage reads before either begins.
      s.state.readBytes += RESERVATION;
      return structuredClone(s.state.ops[it.current]);
    });
    if (!op) return undefined;
    const output = await Promise.all(
      [0, 1].map((n) => this.storage.read(objectKey(op.id, n), signal)),
    );
    for (let n = 0; n < 2; n++) {
      demand(
        output[n].length === op.sizes[n] &&
          (await hash(output[n])) === op.hashes[n],
        "Photo verification failed.",
        503,
      );
      inspectJpeg(output[n], {
        maxBytes: n ? 32768 : 393216,
        maxEdge: n ? 192 : 1280,
      });
    }
    await this.verify(list, item, signal);
    const latest = await this.ledger.load(signal);
    open(latest, list, this.now());
    demand(
      latest.state.items[scope(list, item)]?.current === op.id,
      "Photo changed. Retry.",
    );
    return { version: op.version!, full: output[0], thumbnail: output[1] };
  }
  async status(list: string, item: string, id: string, signal: AbortSignal) {
    await this.verify(list, item, signal, true);
    await transact(this.ledger, signal, (s) => {
      open(s, list, this.now());
      const op = s.state.ops[id];
      if (
        op &&
        op.list === list &&
        op.item === item &&
        op.state === "pending" &&
        op.lease <= this.now()
      )
        op.state = op.writes.every((w) => w === "planned")
          ? "released"
          : "cleanup";
    });
    await this.cleanup(list, item, signal);
    const s = await this.ledger.load(signal);
    open(s, list, this.now());
    const op = s.state.ops[id];
    if (!op || op.list !== list || op.item !== item) return undefined;
    return {
      state:
        op.version !== undefined
          ? "committed"
          : op.state === "pending"
            ? "pending"
            : "failed",
    };
  }
  async remove(
    list: string,
    item: string,
    expected: number | undefined,
    deleted: boolean,
    signal: AbortSignal,
  ) {
    await this.verify(list, item, signal, deleted);
    await transact(this.ledger, signal, (s) => {
      open(s, list, this.now());
      const it = s.state.items[scope(list, item)];
      if (!it) return;
      if (!deleted) {
        demand(
          Number.isSafeInteger(expected) && expected! > 0,
          "Invalid version.",
          400,
        );
        if (!it.current) return;
        demand(
          (it.current ? it.version : 0) === expected,
          "Photo changed. Reopen it.",
        );
      }
      it.epoch++;
      it.version++;
      if (deleted) it.deleted = true;
      delete it.current;
      for (const op of Object.values(s.state.ops))
        if (op.list === list && op.item === item && op.state !== "released")
          op.state = op.writes.every((w) => w === "planned")
            ? "released"
            : "cleanup";
    });
    await this.cleanup(list, item, signal);
  }
  // Cleanup consumes only explicitly fenced, settled objects. No retained-photo TTL.
  async cleanup(list: string, item: string, signal: AbortSignal) {
    const snapshot = await this.ledger.load(signal);
    for (const op of Object.values(snapshot.state.ops)) {
      if (
        op.list !== list ||
        op.item !== item ||
        op.state !== "cleanup" ||
        op.writes.includes("writing")
      )
        continue;
      const keys = op.writes.flatMap((w, n) =>
        w === "stored" ? [objectKey(op.id, n)] : [],
      );
      await this.storage.remove(keys, signal);
      for (const key of keys)
        demand(
          !(await this.storage.exists(key, signal)),
          "Photo cleanup is waiting.",
          503,
        );
      await transact(this.ledger, signal, (s) => {
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
    }
  }
}
