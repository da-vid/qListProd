import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  readFile,
  writeFile,
  mkdir,
  mkdtemp,
  unlink,
  stat,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { PhysicalTrial, BUCKET } from "./engine.ts";
import { initialize } from "./codec.js";
import { fixtures as encoded } from "./fixtures.js";
const root = new URL("./", import.meta.url),
  run = promisify(execFile),
  [psql, socket, safeupdate] = process.argv.slice(2);
assert(socket.includes("/qlist-physical-") && socket.endsWith("/socket"));
const env = Object.fromEntries(
  Object.entries(process.env).filter(([k]) => !k.startsWith("PG")),
);
async function sql(query, db = "postgres", role) {
  const { stdout } = await run(
    psql,
    [
      "-X",
      "-qAt",
      "-h",
      socket,
      "-U",
      "postgres",
      "-d",
      db,
      "-v",
      "ON_ERROR_STOP=1",
      "-c",
      (role ? "set role " + role + ";" : "") + query,
    ],
    {
      env:
        role && safeupdate
          ? { ...env, PGOPTIONS: "-c session_preload_libraries=" + safeupdate }
          : env,
      timeout: 10000,
      maxBuffer: 1024 * 1024,
    },
  ).catch((e) => {
    throw new Error(e.stderr || e.message);
  });
  return stdout.trim();
}
await sql(
  "create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;",
);
const a = await readFile(
  new URL(
    "../supabase/migrations/20261002235210_qlist_photo_trial_phase_a.sql",
    root,
  ),
  "utf8",
);
const b = await readFile(
  new URL(
    "../supabase/migrations/20261003002735_qlist_photo_trial_phase_b.sql",
    root,
  ),
  "utf8",
);
const c = await readFile(
  new URL(
    "../supabase/migrations/20261003022856_qlist_photo_trial_continuation.sql",
    root,
  ),
  "utf8",
);
const fixtures = Object.fromEntries(
  Object.entries(encoded).map(([k, v]) => [
    k,
    Uint8Array.from(Buffer.from(v, "base64")),
  ]),
);
const processor = await initialize();
const results = {
  runtime: process.version,
  tests: [],
  storage:
    "actual local files via fault-injectable adapter; not Supabase Storage",
};
class FileStore {
  files = new Set();
  puts = 0;
  reads = 0;
  deletes = 0;
  setupCalls = 0;
  afterPut;
  beforePut;
  beforeRemove;
  afterRead;
  holdAbsence = false;
  constructor(dir) {
    this.dir = dir;
  }
  setup = async () => {
    this.setupCalls++;
  };
  checkEmpty = async () => {
    assert.equal(this.files.size, 0);
  };
  target = (key) => {
    assert.match(
      key,
      /^phase-b\/PhotoDemo\/phaseb-[a-z0-9-]{1,64}\/(full|thumb)\.jpg$/,
    );
    return path.join(this.dir, key);
  };
  put = async (key, bytes) => {
    this.puts++;
    if (this.beforePut) await this.beforePut(key, bytes);
    const file = this.target(key);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, bytes, { flag: "wx" });
    this.files.add(key);
    if (this.afterPut) await this.afterPut(key, bytes);
  };
  read = async (key) => {
    this.reads++;
    let bytes = Uint8Array.from(await readFile(this.target(key)));
    if (this.afterRead) bytes = this.afterRead(bytes);
    return new ReadableStream({
      start(c) {
        c.enqueue(bytes);
        c.close();
      },
    });
  };
  remove = async (keys) => {
    this.deletes++;
    if (this.beforeRemove) await this.beforeRemove(keys);
    for (const key of keys) {
      try {
        await unlink(this.target(key));
      } catch (e) {
        if (e.code !== "ENOENT") throw e;
      }
      this.files.delete(key);
    }
    return keys.map((name) => ({ name }));
  };
  exists = async (key) => {
    if (this.holdAbsence) return true;
    try {
      await stat(this.target(key));
      return true;
    } catch (e) {
      if (e.code === "ENOENT") return false;
      throw e;
    }
  };
}
async function fresh(index, apply = true) {
  const db = "physical_" + index;
  await sql("create database " + db + ";");
  await sql(a, db);
  // Retain a representative Phase A history of 3 released operations, one item, six objects.
  await sql(
    "do $$ declare n int;p jsonb;begin for n in 1..3 loop p=jsonb_build_object('operation_id','phasea-retained-'||n,'item_id','trial-retained','fixture','gradient','expected_version',0);perform public.qlist_photo_trial_rpc('reserve',p);perform public.qlist_photo_trial_rpc('cancel',p-'item_id'-'fixture'-'expected_version');perform public.qlist_photo_trial_rpc('cleanup',p-'item_id'-'fixture'-'expected_version');end loop;end $$;",
    db,
    "service_role",
  );
  if (apply) await sql(b, db);
  const store = new FileStore(
    await mkdtemp(path.join(tmpdir(), "qlist-objects-")),
  );
  const rpc = async (action, payload) =>
    JSON.parse(
      await sql(
        "select public.qlist_photo_trial_b_rpc('" +
          action +
          "','" +
          JSON.stringify(payload).replaceAll("'", "''") +
          "'::jsonb);",
        db,
        "service_role",
      ),
    );
  const trial = new PhysicalTrial(
    rpc,
    store,
    processor,
    fixtures,
    AbortSignal.timeout(30000),
    1000,
  );
  const budget = async () =>
    JSON.parse(
      await sql(
        "select to_jsonb(t) from qlist_photo_trial.budgets t where scope='global';",
        db,
      ),
    );
  return { db, store, rpc, trial, budget };
}
async function test(name, fn, apply = true) {
  const start = Date.now();
  try {
    const ctx = await fresh(results.tests.length, apply);
    await fn(ctx);
    results.tests.push({ name, passed: true, ms: Date.now() - start });
    console.log("PASS", name);
  } catch (e) {
    results.tests.push({ name, passed: false, error: String(e) });
    throw e;
  }
}
try {
  await test("full bounded batch: codec, physical file bytes, readback, replacement, deletion, partial cleanup, noise and zero residuals", async ({
    db,
    store,
    trial,
    budget,
  }) => {
    const r = await trial.run();
    assert.equal(r.complete, true);
    assert.equal(store.setupCalls, 1);
    assert.equal(store.puts, 6);
    assert.equal(store.reads, 5);
    assert.equal(store.files.size, 0);
    const q = await budget();
    assert.equal(q.operation_count, 8);
    assert.equal(q.batch_state, "complete");
    assert.equal(q.read_bytes, 5 * 393216);
    assert.equal(q.used_bytes + q.reserved_bytes, 0);
    assert.equal(
      await sql(
        "select count(*) from qlist_photo_trial.operations where mode='simulated' and phase='released';",
        db,
      ),
      "3",
    );
    assert.equal(
      await sql(
        "select count(*) from qlist_photo_trial.objects where writer_state='absent';",
        db,
      ),
      "10",
    );
    await assert.rejects(() => trial.run(), /batch_already_claimed/);
    assert.equal(store.puts, 6);
  });
  await test("unsettled upload: timeout then late physical completion remains fully charged, never rewritten or cleaned", async ({
    store,
    trial,
    budget,
  }) => {
    await trial.call("batch_claim");
    const pair = await trial.prepare(
      "phaseb-late",
      "trial-physical-late",
      "gradient",
    );
    let release;
    store.beforePut = () => new Promise((r) => (release = r));
    const pending = trial.write("phaseb-late", "full", pair.full);
    await assert.rejects(() => pending, /operation_timeout/);
    await trial.cancel("phaseb-late");
    assert.equal((await budget()).reserved_bytes, 425984);
    await assert.rejects(
      () => trial.cleanup("phaseb-late"),
      /writer_unsettled/,
    );
    release();
    await new Promise((r) => setTimeout(r, 35));
    assert.equal(store.files.size, 1);
    await assert.rejects(
      () => trial.cleanup("phaseb-late"),
      /writer_unsettled/,
    );
    await assert.rejects(
      () => trial.write("phaseb-late", "full", pair.full),
      /operation_fenced/,
    );
    assert.equal(store.puts, 1);
    assert.equal(store.deletes, 0);
    const recovered = await trial.reconcile();
    assert.deepEqual(recovered.retained, ["phaseb-late"]);
    assert.equal((await budget()).reserved_bytes, 425984);
  });
  await test("upload succeeds but acknowledgement is lost: retry cannot PUT again or refund", async ({
    trial,
    store,
    budget,
    rpc,
  }) => {
    await trial.call("batch_claim");
    const pair = await trial.prepare(
      "phaseb-ack",
      "trial-physical-ack",
      "gradient",
    );
    const original = trial.rpc;
    trial.rpc = async (a, p, s) => {
      if (a === "write_ack") throw Error("lost_ack");
      return original(a, p, s);
    };
    await assert.rejects(
      () => trial.write("phaseb-ack", "full", pair.full),
      /lost_ack/,
    );
    trial.rpc = rpc;
    await assert.rejects(
      () => trial.write("phaseb-ack", "full", pair.full),
      /write_already_claimed/,
    );
    await trial.cancel("phaseb-ack");
    await assert.rejects(() => trial.cleanup("phaseb-ack"), /writer_unsettled/);
    assert.equal(store.puts, 1);
    assert.equal((await budget()).reserved_bytes, 425984);
  });
  await test("cleanup failure and false absence retain charges; safe retry refunds exactly once", async ({
    trial,
    store,
    budget,
  }) => {
    await trial.call("batch_claim");
    const pair = await trial.prepare(
      "phaseb-clean",
      "trial-physical-clean",
      "gradient",
    );
    await trial.write("phaseb-clean", "full", pair.full);
    await trial.cancel("phaseb-clean");
    store.beforeRemove = () => {
      throw Error("delete_failure");
    };
    await assert.rejects(() => trial.cleanup("phaseb-clean"), /delete_failure/);
    assert.equal((await budget()).reserved_bytes, 425984);
    store.beforeRemove = undefined;
    store.holdAbsence = true;
    await assert.rejects(
      () => trial.cleanup("phaseb-clean"),
      /object_still_present/,
    );
    assert.equal((await budget()).reserved_bytes, 425984);
    store.holdAbsence = false;
    await trial.cleanup("phaseb-clean");
    const count = store.deletes;
    await trial.cleanup("phaseb-clean");
    assert.equal(store.deletes, count);
    assert.equal((await budget()).reserved_bytes, 0);
  });
  await test("corrupt or oversized readback cannot verify/commit; read attempts stay charged", async ({
    trial,
    store,
    budget,
  }) => {
    await trial.call("batch_claim");
    const pair = await trial.prepare(
      "phaseb-corrupt",
      "trial-physical-corrupt",
      "gradient",
    );
    await trial.write("phaseb-corrupt", "full", pair.full);
    store.afterRead = (b) => {
      b[100] ^= 1;
      return b;
    };
    await assert.rejects(
      () => trial.verify("phaseb-corrupt", "full"),
      /stored_bytes_mismatch/,
    );
    await assert.rejects(() => trial.commit("phaseb-corrupt"), /not_verified/);
    store.afterRead = () => new Uint8Array(393217);
    await assert.rejects(
      () => trial.verify("phaseb-corrupt", "full"),
      /download_limit/,
    );
    assert.equal((await budget()).read_bytes, 2 * 393216);
    await trial.cancel("phaseb-corrupt");
    await trial.cleanup("phaseb-corrupt");
    assert.equal((await budget()).reserved_bytes, 0);
  });
  await test("concurrent write claims grant exactly one writer and never renew a lost claim", async ({
    trial,
    rpc,
  }) => {
    await trial.call("batch_claim");
    await trial.prepare("phaseb-claim", "trial-physical-claim", "gradient");
    const claims = await Promise.all(
      [1, 2].map(() =>
        rpc("write_claim", {
          owner: trial.owner,
          operation_id: "phaseb-claim",
          kind: "full",
          ticket: crypto.randomUUID(),
        }),
      ),
    );
    assert.equal(claims.filter((x) => x.claimed).length, 1);
    await trial.cancel("phaseb-claim");
    await assert.rejects(
      () => trial.cleanup("phaseb-claim"),
      /writer_unsettled/,
    );
  });
  await test("two simultaneous byte-budget admissions, two-pending cap, and no orphan metadata", async ({
    trial,
    db,
    budget,
  }) => {
    await trial.call("batch_claim");
    await sql("update qlist_photo_trial.budgets set cap_bytes=425984;", db);
    const got = await Promise.allSettled([
      trial.reserve("phaseb-a", "trial-physical-a", "gradient"),
      trial.reserve("phaseb-b", "trial-physical-b", "gradient"),
    ]);
    assert.equal(got.filter((x) => x.status === "fulfilled").length, 1);
    assert.equal((await budget()).operation_count, 4);
    await sql("update qlist_photo_trial.budgets set cap_bytes=10485760;", db);
    await trial.reserve("phaseb-c", "trial-physical-c", "gradient");
    await assert.rejects(() =>
      trial.reserve("phaseb-d", "trial-physical-d", "gradient"),
    );
    assert.equal((await budget()).pending_count, 2);
  });
  await test("5 MiB read cap charges worst-case bucket bytes and rejects before GET", async ({
    trial,
    store,
    budget,
  }) => {
    await trial.call("batch_claim");
    const pair = await trial.prepare(
      "phaseb-read",
      "trial-physical-read",
      "gradient",
    );
    await trial.write("phaseb-read", "full", pair.full);
    for (let n = 0; n < 13; n++) await trial.verify("phaseb-read", "full");
    await assert.rejects(() => trial.verify("phaseb-read", "full"));
    assert.equal(store.reads, 13);
    assert.equal((await budget()).read_bytes, 13 * 393216);
  });
  await test("service-only invoker/RLS, disabled simulated API, rejected caller proof fields and nonce checks", async ({
    trial,
    db,
    rpc,
  }) => {
    for (const role of ["anon", "authenticated"])
      await assert.rejects(
        () => sql("select public.qlist_photo_trial_b_rpc('status');", db, role),
        /permission denied/,
      );
    await assert.rejects(
      () =>
        sql(
          "select public.qlist_photo_trial_rpc('status');",
          db,
          "service_role",
        ),
      /permission denied/,
    );
    assert.equal(
      await sql(
        "select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='qlist_photo_trial' and c.relkind='r' and c.relrowsecurity;",
        db,
      ),
      "4",
    );
    await assert.rejects(
      () => rpc("cleanup_ack", { objectsAbsent: true }),
      /unknown_field/,
    );
    await trial.call("batch_claim");
    await trial.reserve("phaseb-proof", "trial-physical-proof", "gradient");
    await trial.cancel("phaseb-proof");
    await assert.rejects(
      () =>
        trial.call("cleanup_ack", {
          operation_id: "phaseb-proof",
          ticket: crypto.randomUUID(),
          receipt: "0".repeat(64),
        }),
      /cleanup_receipt_mismatch/,
    );
  });
  await test("out-of-range thumbnail plan rolls back full-object metadata atomically", async ({
    trial,
  }) => {
    await trial.call("batch_claim");
    await trial.reserve("phaseb-plan", "trial-physical-plan", "gradient");
    await assert.rejects(() =>
      trial.call("plan", {
        operation_id: "phaseb-plan",
        objects: {
          full: { bytes: 100, digest: "0".repeat(64) },
          thumb: { bytes: 32769, digest: "0".repeat(64) },
        },
      }),
    );
    const r = await trial.status("phaseb-plan");
    assert(r.objects.every((o) => o.size_bytes === 0));
  });
  await test(
    "migration refuses active Phase A work and rolls back all schema changes",
    async ({ db }) => {
      await sql(
        'select public.qlist_photo_trial_rpc(\'reserve\',\'{"operation_id":"phasea-active","item_id":"trial-active","fixture":"gradient","expected_version":0}\');',
        db,
        "service_role",
      );
      await assert.rejects(() => sql(b, db), /phase_a_not_quiescent/);
      assert.equal(
        await sql(
          "select count(*) from information_schema.columns where table_schema='qlist_photo_trial' and table_name='budgets' and column_name='batch_state';",
          db,
        ),
        "0",
      );
    },
    false,
  );
  await test("deletion while physical upload is still running blocks cleanup until acknowledged completion", async ({
    trial,
    store,
    budget,
  }) => {
    await trial.call("batch_claim");
    const pair = await trial.prepare(
      "phaseb-during",
      "trial-physical-during",
      "gradient",
    );
    let checked = false;
    store.afterPut = async () => {
      await trial.call("delete_item", { item_id: "trial-physical-during" });
      await assert.rejects(
        () => trial.cleanup("phaseb-during"),
        /writer_unsettled/,
      );
      checked = true;
    };
    await trial.write("phaseb-during", "full", pair.full);
    assert(checked);
    await trial.cleanup("phaseb-during");
    assert.equal(store.files.size, 0);
    assert.equal((await budget()).reserved_bytes, 0);
  });
  await test("lost commit response replays the durable physical commit without another upload", async ({
    trial,
    store,
    rpc,
    budget,
  }) => {
    await trial.call("batch_claim");
    const pair = await trial.prepare(
      "phaseb-commit",
      "trial-physical-commit",
      "portrait",
    );
    await trial.upload("phaseb-commit", pair);
    trial.rpc = async (a, p, s) => {
      const r = await rpc(a, p, s);
      if (a === "commit") throw Error("lost_commit_response");
      return r;
    };
    await assert.rejects(
      () => trial.commit("phaseb-commit"),
      /lost_commit_response/,
    );
    trial.rpc = rpc;
    const replay = await trial.commit("phaseb-commit");
    assert.equal(replay.operation.committed_version, 1);
    assert.equal(store.puts, 2);
    assert.equal(
      (await budget()).used_bytes,
      pair.full.length + pair.thumbnail.length,
    );
    await assert.rejects(
      () => trial.cleanup("phaseb-commit"),
      /cannot_clean_current/,
    );
  });
  await test("100 lifetime admissions include preserved Phase A history", async ({
    trial,
    db,
    budget,
  }) => {
    await trial.call("batch_claim");
    const owner = trial.owner,
      ticket = crypto.randomUUID();
    await sql(
      `do $$ declare n int;p jsonb;begin for n in 1..97 loop p=jsonb_build_object('owner','${owner}','operation_id','phaseb-limit-'||n,'item_id','trial-physical-limit','fixture','gradient','expected_version',0);perform public.qlist_photo_trial_b_rpc('reserve',p);p=p-'item_id'-'fixture'-'expected_version';perform public.qlist_photo_trial_b_rpc('cancel',p);p=p||jsonb_build_object('ticket','${ticket}');perform public.qlist_photo_trial_b_rpc('cleanup_begin',p);perform public.qlist_photo_trial_b_rpc('cleanup_ack',p||jsonb_build_object('receipt',repeat('0',64)));end loop;end $$;`,
      db,
      "service_role",
    );
    await assert.rejects(() =>
      trial.reserve("phaseb-over", "trial-physical-limit", "gradient"),
    );
    assert.equal((await budget()).operation_count, 100);
  });
  await test("expired lease retains charges; rollback fences access without deleting physical bytes or records", async ({
    trial,
    db,
    store,
    budget,
  }) => {
    await trial.call("batch_claim");
    const pair = await trial.prepare(
      "phaseb-stop",
      "trial-physical-stop",
      "gradient",
    );
    await trial.write("phaseb-stop", "full", pair.full);
    await sql(
      "update qlist_photo_trial.operations set lease_until=clock_timestamp()-interval '1 second' where mode='physical';",
      db,
    );
    await assert.rejects(
      () => trial.write("phaseb-stop", "thumb", pair.thumbnail),
      /lease_closed/,
    );
    await trial.call("expire");
    assert.equal((await budget()).reserved_bytes, 425984);
    await sql(await readFile(new URL("rollback.sql", root), "utf8"), db);
    await assert.rejects(() => trial.status(), /permission denied/);
    assert.equal((await budget()).reserved_bytes, 425984);
    assert.equal(store.files.size, 1);
  });
  await test(
    "existing storage policies require explicit review; migration never changes them",
    async ({ db }) => {
      await sql(
        "create schema storage;create table storage.objects(id int);alter table storage.objects enable row level security;create policy broad_access on storage.objects for select using(true);",
        db,
      );
      await assert.rejects(
        () => sql(b, db),
        /existing_storage_policies_require_review/,
      );
      assert.equal(
        await sql(
          "select count(*) from pg_policies where schemaname='storage';",
          db,
        ),
        "1",
      );
    },
    false,
  );
  async function blockedHostedShape({ trial, store, budget }) {
    const exists = store.exists;
    store.exists = async (key) => {
      if (key.includes("phaseb-batch-base"))
        throw Error("object_absence_unverified");
      return exists(key);
    };
    await assert.rejects(() => trial.run(), /object_absence_unverified/);
    store.exists = exists;
    const q = await budget();
    assert.equal(q.batch_state, "blocked");
    assert.equal(q.used_bytes, 37660);
    assert.equal(q.reserved_bytes, 0);
    assert.equal(q.read_bytes, 1572864);
    assert.equal(q.read_count, 4);
    assert.equal(q.operation_count, 5);
    assert.equal(store.files.size, 2);
    store.setup = async () => {
      throw Error("cleanup_must_not_setup");
    };
    store.put = async () => {
      throw Error("cleanup_must_not_upload");
    };
    store.read = async () => {
      throw Error("cleanup_must_not_download");
    };
  }
  await test("exact hosted-shape cleanup fences version 2, refunds only verified deletion, and repeats without Storage writes", async (ctx) => {
    await blockedHostedShape(ctx);
    const { trial, store, budget } = ctx;
    const result = await trial.finishCleanup();
    assert.equal(result.cleanup_complete, true);
    assert.equal(result.trial_complete, false);
    assert.deepEqual(result.untested, [
      "partial_upload",
      "deletion_during_upload",
      "noise_rejection",
    ]);
    const q = await budget();
    assert.equal(q.batch_state, "blocked");
    assert.equal(q.used_bytes, 0);
    assert.equal(q.reserved_bytes, 0);
    assert.equal(q.photo_count, 0);
    assert.equal(q.operation_count, 5);
    assert.equal(q.read_bytes, 1572864);
    assert.equal(store.files.size, 0);
    const deletes = store.deletes;
    assert.equal((await trial.finishCleanup()).cleanup_complete, true);
    assert.equal(store.deletes, deletes);
  });
  await test("cleanup failure on replacement leaves its exact charge and safely re-enters from cleanup phase", async (ctx) => {
    await blockedHostedShape(ctx);
    const { trial, store, budget } = ctx;
    store.beforeRemove = async (keys) => {
      if (keys.some((k) => k.includes("phaseb-batch-replacement")))
        throw Error("second_pair_delete_failed");
    };
    await assert.rejects(
      () => trial.finishCleanup(),
      /second_pair_delete_failed/,
    );
    const q = await budget();
    assert.equal(q.used_bytes, 16448);
    assert.equal(q.photo_count, 0);
    assert.equal(store.files.size, 2);
    store.beforeRemove = undefined;
    assert.equal((await trial.finishCleanup()).cleanup_complete, true);
    assert.equal((await budget()).used_bytes, 0);
    assert.equal(store.files.size, 0);
  });
  await test("two cleanup callers racing the same current version yield one safe completion and a fenced loser", async (ctx) => {
    await blockedHostedShape(ctx);
    const { trial, rpc, store, budget } = ctx;
    let arrivals = 0,
      release;
    const barrier = new Promise((r) => (release = r));
    const raced = async (a, p, s) => {
      if (a === "remove") {
        arrivals++;
        if (arrivals === 2) release();
        await barrier;
      }
      return rpc(a, p, s);
    };
    trial.rpc = raced;
    const other = new PhysicalTrial(
      raced,
      store,
      processor,
      fixtures,
      AbortSignal.timeout(30000),
      1000,
    );
    const done = await Promise.allSettled([
      trial.finishCleanup(),
      other.finishCleanup(),
    ]);
    assert.equal(done.filter((x) => x.status === "fulfilled").length, 1);
    assert(
      done.some(
        (x) =>
          x.status === "rejected" &&
          String(x.reason).includes("version_conflict"),
      ),
    );
    assert.equal((await budget()).used_bytes, 0);
    assert.equal(store.files.size, 0);
    assert.equal((await budget()).read_count, 4);
  });
  await test("current-version drift after preflight is rejected by SQL before any new deletion", async (ctx) => {
    await blockedHostedShape(ctx);
    const { trial, rpc, db, store, budget } = ctx;
    const deletes = store.deletes;
    trial.rpc = async (a, p, s) => {
      if (a === "remove")
        await sql(
          "update qlist_photo_trial.items set version=3 where item_id='trial-physical-replace';",
          db,
        );
      return rpc(a, p, s);
    };
    await assert.rejects(() => trial.finishCleanup(), /version_conflict/);
    assert.equal(store.deletes, deletes);
    assert.equal(store.files.size, 2);
    assert.equal((await budget()).used_bytes, 37660);
  });
  await test("lost cleanup acknowledgement response does not double refund on re-entry", async (ctx) => {
    await blockedHostedShape(ctx);
    const { trial, rpc, store, budget } = ctx;
    let lose = true;
    trial.rpc = async (a, p, s) => {
      const r = await rpc(a, p, s);
      if (
        a === "cleanup_ack" &&
        p.operation_id === "phaseb-batch-base" &&
        lose
      ) {
        lose = false;
        throw Error("cleanup_ack_response_lost");
      }
      return r;
    };
    await assert.rejects(
      () => trial.finishCleanup(),
      /cleanup_ack_response_lost/,
    );
    assert.equal((await budget()).used_bytes, 16448);
    assert.equal(store.files.size, 2);
    assert.equal((await trial.finishCleanup()).cleanup_complete, true);
    assert.equal((await budget()).used_bytes, 0);
    assert.equal(store.files.size, 0);
  });
  async function readyContinuation(ctx, apply = true) {
    const { trial, store, db, rpc } = ctx;
    const put = store.put,
      read = store.read;
    await blockedHostedShape(ctx);
    await trial.finishCleanup();
    store.put = put;
    store.read = read;
    // Mirrors the already fixed hosted deadline; only this local fixture sets it.
    await sql(
      "update qlist_photo_trial.budgets set expires_at='2026-10-04T00:00:00Z' where scope in ('global','PhotoDemo');",
      db,
    );
    const history = await sql(
      "select jsonb_build_object('operations',(select jsonb_agg(to_jsonb(t) order by operation_id) from qlist_photo_trial.operations t),'objects',(select jsonb_agg(to_jsonb(t) order by operation_id,kind) from qlist_photo_trial.objects t));",
      db,
    );
    const baseline = await ctx.budget();
    if (apply) await sql(c, db);
    const next = new PhysicalTrial(
      rpc,
      store,
      processor,
      fixtures,
      AbortSignal.timeout(30000),
      1000,
    );
    return { next, baseline, history };
  }
  await test("continuation: four fixed cases consume original budgets, preserve history/deadline/blocked batch and end empty", async (ctx) => {
    const { next, baseline, history } = await readyContinuation(ctx);
    const puts = ctx.store.puts,
      reads = ctx.store.reads,
      deletes = ctx.store.deletes;
    const result = await next.runContinuation();
    assert.equal(result.continuation_complete, true);
    assert.equal(result.trial_complete, false);
    assert.deepEqual(
      result.evidence.filter((e) => e.scenario).map((e) => e.scenario),
      [
        "partial_upload",
        "deletion_during_upload",
        "noise_rejection",
        "oversize_rejection",
      ],
    );
    assert.equal(ctx.store.puts - puts, 2);
    assert.equal(ctx.store.reads - reads, 2);
    assert.equal(ctx.store.deletes - deletes, 2);
    assert.equal(ctx.store.files.size, 0);
    assert.equal(ctx.store.setupCalls, 1);
    const q = await ctx.budget();
    for (const name of [
      "batch_state",
      "batch_owner",
      "expires_at",
      "cap_bytes",
      "stopped",
    ])
      assert.deepEqual(q[name], baseline[name], name);
    assert.equal(q.continuation_state, "complete");
    assert.equal(q.operation_count, 9);
    assert.equal(q.read_bytes, 2359296);
    assert.equal(q.read_count, 6);
    for (const name of [
      "used_bytes",
      "reserved_bytes",
      "photo_count",
      "pending_count",
    ])
      assert.equal(q[name], 0, name);
    const prior = JSON.parse(history);
    for (const table of ["operations", "objects"]) {
      const actual = JSON.parse(
        await sql(
          `select jsonb_agg(to_jsonb(t) order by operation_id${table === "objects" ? ",kind" : ""}) from qlist_photo_trial.${table} t where operation_id not like 'phaseb-cont-%';`,
          ctx.db,
        ),
      );
      assert.deepEqual(actual, prior[table]);
    }
    const rejects = JSON.parse(
      await sql(
        "select jsonb_agg(to_jsonb(t)) from qlist_photo_trial.objects t where operation_id in ('phaseb-cont-noise','phaseb-cont-oversize');",
        ctx.db,
      ),
    );
    assert.equal(rejects.length, 4);
    assert(
      rejects.every(
        (o) =>
          o.writer_state === "absent" &&
          o.write_nonce === null &&
          o.size_bytes === 0 &&
          o.physical_deleted_at === null &&
          /^[0-9a-f]{64}$/.test(o.delete_receipt),
      ),
    );
    await assert.rejects(
      () => next.runContinuation(),
      /continuation_already_claimed/,
    );
    await assert.rejects(() => ctx.trial.run(), /original_batch_closed/);
    await assert.rejects(
      () => ctx.trial.call("batch_close", { result: "complete" }),
      /original_batch_closed/,
    );
    assert.equal(ctx.store.puts - puts, 2);
  });
  await test("continuation migration rejects unclean or wrong source and atomically leaves schema untouched", async (ctx) => {
    await blockedHostedShape(ctx);
    await assert.rejects(() => sql(c, ctx.db), /cleaned_hosted_state_required/);
    assert.equal(
      await sql(
        "select count(*) from information_schema.columns where table_schema='qlist_photo_trial' and column_name='continuation_state';",
        ctx.db,
      ),
      "0",
    );
    await sql(
      "create or replace function qlist_photo_trial.reconcile() returns void language plpgsql as $$begin null;end$$;",
      ctx.db,
    );
    await assert.rejects(() => sql(c, ctx.db), /reviewed_source_mismatch/);
  });
  await test("continuation claim is unique under concurrency; foreign owner and arbitrary cases cannot create objects", async (ctx) => {
    const { next } = await readyContinuation(ctx);
    const owners = [next.owner, crypto.randomUUID()];
    const claims = await Promise.allSettled(
      owners.map((owner) => ctx.rpc("continuation_claim", { owner })),
    );
    assert.equal(claims.filter((r) => r.status === "fulfilled").length, 1);
    const winner = owners[claims.findIndex((r) => r.status === "fulfilled")];
    next.owner = winner;
    await assert.rejects(
      () =>
        next.reserve(
          "phaseb-arbitrary",
          "trial-physical-arbitrary",
          "gradient",
        ),
      /continuation_case_mismatch/,
    );
    await assert.rejects(
      () =>
        next.reserve(
          "phaseb-cont-partial",
          "trial-physical-cont-partial",
          "portrait",
        ),
      /continuation_case_mismatch/,
    );
    await assert.rejects(
      () =>
        ctx.rpc("reserve", {
          owner: crypto.randomUUID(),
          operation_id: "phaseb-cont-partial",
          item_id: "trial-physical-cont-partial",
          fixture: "gradient",
          expected_version: 0,
        }),
      /continuation_not_owned/,
    );
    await assert.rejects(
      () => next.call("continuation_close", { result: "complete" }),
      /residual_operations/,
    );
    assert.equal((await ctx.budget()).operation_count, 5);
    for (const role of ["anon", "authenticated"])
      await assert.rejects(
        () =>
          sql(
            "select public.qlist_photo_trial_b_rpc('continuation_claim');",
            ctx.db,
            role,
          ),
        /permission denied/,
      );
    assert.equal(
      await sql(
        "select prosecdef from pg_proc where oid='public.qlist_photo_trial_b_rpc(text,jsonb)'::regprocedure;",
        ctx.db,
      ),
      "f",
    );
  });
  await test("continuation preflight rejects expiry, changed counters, missing receipt, active current, or additional history", async (ctx) => {
    const { next } = await readyContinuation(ctx);
    const mutations = [
      [
        "update qlist_photo_trial.budgets set expires_at=clock_timestamp()-interval '1 second' where scope in ('global','PhotoDemo');",
        /trial_closed/,
      ],
      [
        "update qlist_photo_trial.budgets set read_count=5 where scope in ('global','PhotoDemo');",
        /continuation_preflight_failed/,
      ],
      [
        "update qlist_photo_trial.objects set delete_receipt=null where operation_id='phaseb-batch-base';",
        /continuation_preflight_failed/,
      ],
      [
        "update qlist_photo_trial.items set current_operation='phaseb-batch-replacement' where item_id='trial-physical-replace';",
        /continuation_preflight_failed/,
      ],
      [
        "update qlist_photo_trial.operations set phase='cleanup' where operation_id='phaseb-batch-base';",
        /continuation_preflight_failed/,
      ],
    ];
    for (const [query, error] of mutations) {
      // Transaction rollback after failed claim preserves the independently created local fixture.
      await assert.rejects(
        () =>
          sql(
            query +
              `set role service_role;select public.qlist_photo_trial_b_rpc('continuation_claim','{"owner":"${next.owner}"}');`,
            ctx.db,
          ),
        error,
      );
      assert.equal((await ctx.budget()).continuation_state, "idle");
    }
    assert.equal((await ctx.budget()).read_count, 4);
  });
  await test("continuation refuses missing/nonempty bucket without setup, admission, PUT or automatic retry", async (ctx) => {
    const { next } = await readyContinuation(ctx);
    const puts = ctx.store.puts;
    ctx.store.checkEmpty = async () => {
      throw Error("bucket_not_empty");
    };
    await assert.rejects(() => next.runContinuation(), /bucket_not_empty/);
    const q = await ctx.budget();
    assert.equal(q.operation_count, 5);
    assert.equal(q.continuation_state, "blocked");
    assert.equal(q.batch_state, "blocked");
    assert.equal(ctx.store.puts, puts);
    await assert.rejects(
      () => next.runContinuation(),
      /continuation_already_claimed/,
    );
  });
  await test("continuation partial-delete failure keeps full reservation; reconciliation settles only proven deletion", async (ctx) => {
    const { next } = await readyContinuation(ctx);
    ctx.store.beforeRemove = async () => {
      throw Error("delete_failed");
    };
    await assert.rejects(() => next.runContinuation(), /delete_failed/);
    assert.equal((await ctx.budget()).reserved_bytes, 425984);
    assert.equal((await ctx.budget()).continuation_state, "blocked");
    assert.equal(ctx.store.files.size, 1);
    ctx.store.beforeRemove = undefined;
    assert.deepEqual((await next.reconcile()).retained, []);
    assert.equal((await ctx.budget()).reserved_bytes, 0);
    assert.equal(ctx.store.files.size, 0);
    assert.equal((await ctx.budget()).operation_count, 6);
  });
  await test("continuation late physical PUT remains charged and uncleanable after timeout and completed deletion hook", async (ctx) => {
    const { next } = await readyContinuation(ctx);
    let release, finished;
    const completed = new Promise((r) => (finished = r));
    ctx.store.beforePut = async (key) => {
      if (key.includes("cont-deleted")) await new Promise((r) => (release = r));
    };
    ctx.store.afterPut = async (key) => {
      if (key.includes("cont-deleted")) finished();
    };
    await assert.rejects(() => next.runContinuation(), /operation_timeout/);
    const q = await ctx.budget();
    assert.equal(q.continuation_state, "blocked");
    assert.equal(q.reserved_bytes, 425984);
    release();
    await completed;
    assert.equal(ctx.store.files.size, 1);
    const result = await next.reconcile();
    assert.deepEqual(result.retained, ["phaseb-cont-deleted"]);
    assert.equal((await ctx.budget()).reserved_bytes, 425984);
    const op = await next.status("phaseb-cont-deleted");
    assert.equal(op.operation.phase, "cleanup");
    assert.equal(
      op.objects.find((o) => o.kind === "full").writer_state,
      "uncertain",
    );
    await assert.rejects(
      () => next.runContinuation(),
      /continuation_already_claimed/,
    );
  });
  await test("continuation never-written refund rejects forged reason, planned bytes and uncertain writer", async (ctx) => {
    const { next } = await readyContinuation(ctx);
    await next.call("continuation_claim");
    const id = "phaseb-cont-noise";
    await next.reserve(id, "trial-physical-cont-noise", "noise");
    await assert.rejects(
      () =>
        next.call("reject_unstarted", {
          operation_id: id,
          reason: "input_too_large",
        }),
      /rejection_case_mismatch/,
    );
    await assert.rejects(
      () => next.call("plan", { operation_id: id, objects: {} }),
      /continuation_case_mismatch/,
    );
    await assert.rejects(
      () =>
        sql(
          "update qlist_photo_trial.objects set size_bytes=1 where operation_id='phaseb-cont-noise' and kind='full';" +
            `set role service_role;select public.qlist_photo_trial_b_rpc('reject_unstarted','{"owner":"${next.owner}","operation_id":"${id}","reason":"output_too_complex"}');`,
          ctx.db,
        ),
      /never_written_proof_failed/,
    );
    await sql(
      "update qlist_photo_trial.objects set writer_state='uncertain',write_nonce='00000000-0000-4000-8000-000000000001' where operation_id='phaseb-cont-noise' and kind='full';",
      ctx.db,
    );
    await assert.rejects(
      () =>
        next.call("reject_unstarted", {
          operation_id: id,
          reason: "output_too_complex",
        }),
      /never_written_proof_failed/,
    );
    await next.cancel(id);
    await assert.rejects(() => next.cleanup(id), /writer_unsettled/);
    assert.equal((await ctx.budget()).reserved_bytes, 425984);
  });
  await test("continuation lost rejection response replays DB proof without refunding twice or making Storage calls", async (ctx) => {
    const { next } = await readyContinuation(ctx);
    await next.call("continuation_claim");
    const id = "phaseb-cont-oversize";
    await next.reserve(id, "trial-physical-cont-oversize", "gradient");
    const counts = [ctx.store.puts, ctx.store.reads, ctx.store.deletes];
    await next.call("reject_unstarted", {
      operation_id: id,
      reason: "input_too_large",
    });
    await next.call("reject_unstarted", {
      operation_id: id,
      reason: "input_too_large",
    });
    assert.equal((await ctx.budget()).reserved_bytes, 0);
    assert.deepEqual(
      [ctx.store.puts, ctx.store.reads, ctx.store.deletes],
      counts,
    );
  });
  if (safeupdate)
    await test("actual safeupdate preload rejects an unqualified mutation in service sessions and permits scoped RPCs", async (ctx) => {
      assert.equal(
        await sql("show safeupdate.enabled;", ctx.db, "service_role"),
        "on",
      );
      await assert.rejects(
        () =>
          sql(
            "update qlist_photo_trial.budgets set stopped=true;",
            ctx.db,
            "service_role",
          ),
        /UPDATE requires a WHERE clause/,
      );
      assert.equal((await ctx.budget()).stopped, false);
      const { next } = await readyContinuation(ctx);
      await next.runContinuation();
      assert.equal((await ctx.budget()).continuation_state, "complete");
    });
  results.passed = true;
} finally {
  await writeFile(
    new URL("local-results.json", root),
    JSON.stringify(results, null, 2) + "\n",
  );
}
