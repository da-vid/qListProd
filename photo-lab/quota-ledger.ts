// Executable single-process specification for the future PostgreSQL transactions.
// No hosting, credentials, database access, clocks or object deletion are hidden here.
export const MAX_RESERVATION_BYTES = 416 * 1024;
type Phase = "reserved" | "staged" | "committed" | "cleanup" | "released";
type Request = {
  id: string;
  key: string;
  digest: string;
  expected: number | null;
  bytes: number;
};
type Operation = Request & {
  epoch: number;
  phase: Phase;
  deadline: number;
  actual: number;
  version?: number;
  committed: boolean;
};
type Slot = { epoch: number; head?: string; deleted: boolean };
export class QuotaLedger {
  private operations = new Map<string, Operation>();
  private slots = new Map<string, Slot>();
  private used = 0;
  private reserved = 0;
  private version = 0;
  readonly cap: number;
  readonly activeLimit: number;
  readonly operationLimit: number;
  readonly photoLimit: number;
  constructor(
    cap = 10 * 1024 * 1024,
    activeLimit = 2,
    operationLimit = 100,
    photoLimit = 20,
  ) {
    if (
      ![cap, activeLimit, operationLimit, photoLimit].every(
        (n) => Number.isSafeInteger(n) && n > 0,
      )
    )
      throw new Error("Invalid quota configuration");
    this.cap = cap;
    this.activeLimit = activeLimit;
    this.operationLimit = operationLimit;
    this.photoLimit = photoLimit;
  }
  snapshot() {
    return {
      used: this.used,
      reserved: this.reserved,
      accounted: this.used + this.reserved,
      cap: this.cap,
      operations: this.operations.size,
    };
  }
  status(id: string) {
    const op = this.require(id);
    return {
      id: op.id,
      phase: op.phase,
      version: op.version,
      actual: op.actual,
    };
  }
  current(key: string) {
    const slot = this.slots.get(key);
    return slot?.head ? this.status(slot.head) : undefined;
  }
  private require(id: string) {
    const op = this.operations.get(id);
    if (!op) throw new Error("Unknown operation");
    return op;
  }
  reserve(request: Request, now: number, leaseMs = 30_000) {
    if (
      !/^[a-zA-Z0-9_-]{1,128}$/.test(request.id) ||
      !/^[a-zA-Z0-9_-]{1,128}$/.test(request.key) ||
      !/^[0-9a-f]{64}$/.test(request.digest) ||
      !Number.isSafeInteger(request.bytes) ||
      request.bytes <= 0 ||
      request.bytes > MAX_RESERVATION_BYTES ||
      (request.expected !== null &&
        (!Number.isSafeInteger(request.expected) || request.expected <= 0)) ||
      !Number.isSafeInteger(now) ||
      now < 0 ||
      !Number.isSafeInteger(leaseMs) ||
      leaseMs <= 0 ||
      !Number.isSafeInteger(now + leaseMs)
    )
      throw new Error("Invalid reservation");
    const prior = this.operations.get(request.id);
    if (prior) {
      if (
        ["key", "digest", "expected", "bytes"].some(
          (field) =>
            prior[field as keyof Request] !== request[field as keyof Request],
        )
      )
        throw new Error("Idempotency key reused with different input");
      return this.status(prior.id);
    }
    if (this.operations.size >= this.operationLimit)
      throw new Error("Trial operation limit reached");
    if (!this.slots.has(request.key) && this.slots.size >= this.operationLimit)
      throw new Error("Trial item limit reached");
    const slot = this.slots.get(request.key) ?? { epoch: 0, deleted: false };
    if (slot.deleted) throw new Error("Item deleted");
    if ((this.current(request.key)?.version ?? null) !== request.expected)
      throw new Error("Version conflict");
    const currentCount = [...this.slots.values()].filter(
      (slot) => slot.head,
    ).length;
    const reservedCount = [...this.operations.values()].filter(
      (op) => op.expected === null && !op.committed && op.phase !== "released",
    ).length;
    if (
      request.expected === null &&
      currentCount + reservedCount >= this.photoLimit
    )
      throw new Error("Photo count full");
    if (
      [...this.operations.values()].filter(
        (op) => !op.committed && op.phase !== "released",
      ).length >= this.activeLimit
    )
      throw new Error("Reservations busy");
    if (this.used + this.reserved + request.bytes > this.cap)
      throw new Error("Quota full");
    this.slots.set(request.key, slot);
    this.operations.set(request.id, {
      ...request,
      phase: "reserved",
      deadline: now + leaseMs,
      epoch: slot.epoch,
      actual: 0,
      committed: false,
    });
    this.reserved += request.bytes;
    return this.status(request.id);
  }
  stage(id: string, actual: number, now: number) {
    const op = this.require(id);
    this.fenceExpired(op, now);
    if (op.phase !== "reserved")
      throw new Error("Reservation fenced or already staged");
    if (!Number.isSafeInteger(actual) || actual <= 0 || actual > op.bytes)
      throw new Error("Output exceeds reservation");
    op.actual = actual;
    op.phase = "staged";
  }
  commit(id: string, now: number) {
    const op = this.require(id);
    if (op.committed) return this.status(id); // Lost-response retry never allocates/writes again.
    this.fenceExpired(op, now);
    if (op.phase !== "staged")
      throw new Error("Reservation not staged or fenced");
    const slot = this.slots.get(op.key)!;
    if (
      slot.deleted ||
      slot.epoch !== op.epoch ||
      (this.current(op.key)?.version ?? null) !== op.expected
    ) {
      op.phase = "cleanup";
      throw new Error("Version conflict or item deleted");
    }
    if (slot.head) this.require(slot.head).phase = "cleanup";
    this.reserved -= op.bytes;
    this.used += op.actual;
    op.committed = true;
    op.phase = "committed";
    op.version = ++this.version;
    slot.head = id;
    slot.epoch++;
    return this.status(id);
  }
  remove(key: string, expected: number) {
    const slot = this.slots.get(key);
    if (!slot?.head) return;
    if (this.current(key)?.version !== expected)
      throw new Error("Version conflict");
    this.require(slot.head).phase = "cleanup";
    slot.head = undefined;
    slot.epoch++;
  }
  deleteItem(key: string) {
    if (!/^[a-zA-Z0-9_-]{1,128}$/.test(key))
      throw new Error("Invalid item key");
    if (!this.slots.has(key) && this.slots.size >= this.operationLimit)
      throw new Error("Trial item limit reached");
    const slot = this.slots.get(key) ?? { epoch: 0, deleted: false };
    slot.deleted = true;
    slot.epoch++;
    slot.head = undefined;
    this.slots.set(key, slot);
    for (const op of this.operations.values())
      if (op.key === key && op.phase !== "released") op.phase = "cleanup";
  }
  cancel(id: string) {
    const op = this.require(id);
    if (!op.committed && op.phase !== "released") op.phase = "cleanup";
  }
  expire(now: number) {
    for (const op of this.operations.values()) this.fenceExpired(op, now);
  }
  private fenceExpired(op: Operation, now: number) {
    if (!Number.isSafeInteger(now) || now < 0) throw new Error("Invalid clock");
    if (
      (op.phase === "reserved" || op.phase === "staged") &&
      now >= op.deadline
    )
      op.phase = "cleanup";
  }
  confirmCleanup(
    id: string,
    evidence: { writerStopped: boolean; objectsAbsent: boolean },
  ) {
    const op = this.require(id);
    if (op.phase === "released") return this.status(id); // Duplicate delete callback refunds once.
    if (op.phase !== "cleanup" || this.slots.get(op.key)?.head === id)
      throw new Error("Cannot clean current photo");
    if (!evidence.writerStopped || !evidence.objectsAbsent)
      throw new Error("Cleanup not confirmed");
    if (op.committed) this.used -= op.actual;
    else this.reserved -= op.bytes;
    op.phase = "released";
    return this.status(id);
  }
}
