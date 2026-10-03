import assert from "node:assert/strict";
import { fixture, signal, upload } from "../../photo-lab/beta/test-support.ts";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFile, writeFile, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
const [psql, socket, safe] = process.argv.slice(2),
  run = promisify(execFile);
assert(socket.includes("/qlist-beta-pg-") && socket.endsWith("/socket"));
const work = await mkdtemp(join(tmpdir(), "qlist-capacity-sql-"));
let queryNumber = 0;
async function sql(query, role) {
  const file = join(work, `${queryNumber++}.sql`);
  await writeFile(file, (role ? "set role " + role + ";" : "") + query);
  try {
    return (
      await run(
        psql,
        [
          "-X",
          "-qAt",
          "-h",
          socket,
          "-U",
          "postgres",
          "-d",
          "postgres",
          "-v",
          "ON_ERROR_STOP=1",
          "-f",
          file,
        ],
        {
          env: {
            ...Object.fromEntries(
              Object.entries(process.env).filter(([k]) => !k.startsWith("PG")),
            ),
            ...(role && safe
              ? { PGOPTIONS: "-c session_preload_libraries=" + safe }
              : {}),
          },
          maxBuffer: 32 * 1024 * 1024,
          timeout: 20000,
        },
      )
    ).stdout.trim();
  } catch (e) {
    throw Error(e.stderr || e.message);
  }
}
const read = (path) => readFile(new URL(path, import.meta.url), "utf8");
const quote = (v) => "'" + String(v).replaceAll("'", "''") + "'";
const json = (v) => quote(JSON.stringify(v)) + "::jsonb";
const load = async () =>
  JSON.parse(await sql("select public.qlist_photos_load();", "service_role"));
const swap = async (before, next) =>
  await sql(
    `select public.qlist_photos_swap(${before.revision},${json(before.control)},${quote(before.legacyToken)},${json(next)});`,
    "service_role",
  );
const results = {
  tests: [],
  scope: "temporary Unix-socket PostgreSQL; no hosted writes",
  passed: false,
};
async function check(name, fn) {
  await fn();
  results.tests.push(name);
  console.log("PASS " + name);
}
await sql(`create role anon nologin;create role authenticated nologin;create role service_role nologin bypassrls;
create schema storage;create table storage.objects(id text,bucket_id text,name text,metadata jsonb);
grant usage on schema storage to service_role;grant select on storage.objects to service_role;
create schema qlist_photo_trial;create table qlist_photo_trial.budgets(scope text primary key,used_bytes bigint,reserved_bytes bigint,photo_count int,operation_count int,item_count int,read_count int,read_bytes bigint,pending_count int,expires_at timestamptz,batch_state text,continuation_state text);
insert into qlist_photo_trial.budgets values('global',0,0,0,9,6,6,2359296,0,'2026-10-04T00:00:00Z','blocked','complete');
grant usage on schema qlist_photo_trial to service_role;grant select,update on qlist_photo_trial.budgets to service_role;`);
await sql(
  await read("../supabase/migrations/20261003054619_qlist_photos_disabled.sql"),
);
const forward = await read(
  "../supabase/migrations/20261003193000_qlist_photos_free_capacity.sql",
);
const empty = (await load()).state;
const operation = (n) => ({
  id: String(n),
  list: "Shared",
  item: String(n),
  expected: 0,
  epoch: 0,
  state: "committed",
  writes: ["stored"],
  sizes: [16000],
  hashes: ["a".repeat(64)],
  lease: 0,
  version: 1,
});
const countState = (n) => ({
  ...structuredClone(empty),
  ops: Object.fromEntries(
    Array.from({ length: n }, (_, i) => [String(i), operation(i)]),
  ),
});
// Administrative seeding below exists ONLY in this isolated synthetic database.
async function seed(n = 0, legacy = 0) {
  await sql(
    `update qlist_photos.ledger set state=${json(countState(n))},revision=revision+1 where singleton; update qlist_photo_trial.budgets set used_bytes=${legacy},reserved_bytes=0 where scope='global';delete from storage.objects;`,
  );
}
await seed(2, 12345);
await sql(`update qlist_photos.ledger set state=jsonb_set(state,'{ops,1,writes}','["writing"]'),control='{"enabled":true,"maintenance":true,"lists":[],"allLists":true}' where singleton;
update qlist_photo_trial.budgets set reserved_bytes=456 where scope='global';
insert into storage.objects values('own','qlist-photos-v1','beta-v1/0/full.jpg','{"size":16000}'),('trial','qlist-photo-trial-v1','prior.jpg','{"size":10000}'),('other','another-bucket','other.bin','{"size":789}');`);
const contents = () =>
  sql(
    "select jsonb_build_object('ledger',(select to_jsonb(l) from qlist_photos.ledger l),'trial',(select to_jsonb(b) from qlist_photo_trial.budgets b),'objects',(select jsonb_agg(o order by id) from storage.objects o))::text;",
  );
const preserved = await contents();
await check(
  "guarded migration preserves live-style objects, reservations, unknown writers, controls and all history",
  async () => {
    await sql(forward);
    assert.equal(await contents(), preserved);
    const s = await load();
    assert.deepEqual(s.storageBudget, {
      bytes: 1000000000,
      aggregateBytes: 1000000000,
      externalBytes: 789,
    });
    assert.equal(s.legacy.bytes, 12801);
  },
);
await check(
  "migration refuses unexpected function bodies and cannot be replayed",
  async () => {
    await assert.rejects(
      () => sql(forward),
      /capacity_source_changed_review_required/,
    );
  },
);
await check(
  "new helper and existing ledger RPC remain inaccessible to anonymous roles",
  async () => {
    for (const role of ["anon", "authenticated"])
      for (const q of [
        "select public.qlist_photos_load();",
        "select public.qlist_photos_external_bytes('{}',0);",
      ])
        await assert.rejects(() => sql(q, role), /permission denied/);
  },
);
await check(
  "all project buckets and trial excess count; mapped reservations are not double-counted",
  async () => {
    await seed(1, 100);
    await sql(
      `insert into storage.objects values('mapped','qlist-photos-v1','beta-v1/0/full.jpg','{"size":16000}'),('trial','qlist-photo-trial-v1','retained.jpg','{"size":150}'),('unknown','qlist-photos-v1','orphan.jpg','{"size":200}'),('other','different-bucket','x','{"size":300}');`,
    );
    assert.equal((await load()).storageBudget.externalBytes, 550);
    await sql(
      `update storage.objects set metadata='{"size":400000}' where id='mapped';`,
    );
    assert.equal(
      (await load()).storageBudget.externalBytes,
      550 + 400000 - 393216,
    );
  },
);
await check(
  "released-operation objects and malformed bucket metadata remain charged as unaccounted storage",
  async () => {
    await seed(1);
    await sql(`update qlist_photos.ledger set state=jsonb_set(state,'{ops,0,state}','"released"') where singleton;
    insert into storage.objects values('late','qlist-photos-v1','beta-v1/0/full.jpg','{"size":16000}'),('unbucketed',null,'orphan','{"size":123}');`);
    assert.equal((await load()).storageBudget.externalBytes, 16123);
  },
);
await check(
  "invalid or unknown object sizes consume allowance but do not prevent maintenance",
  async () => {
    await seed(1);
    await sql(
      `insert into storage.objects values('unknown','other-bucket','x','{}');`,
    );
    let s = await load();
    assert.equal(s.storageBudget.externalBytes, 1000000000);
    assert.equal(await swap(s, s.state), "t");
    s = await load();
    const n = structuredClone(s.state);
    n.ops.extra = operation(2);
    await assert.rejects(() => swap(s, n), /beta_cap_exceeded/);
  },
);
await check(
  "HTTP gateway and real local codec honor the new SQL budget above the old aggregate cap",
  async () => {
    await seed(0, 1000000000 - 2 * 393216);
    const ports = {
      load: async () => load(),
      swap: async (before, state) => (await swap(before, state)) === "t",
    };
    const f = await fixture(ports);
    const photo = await f.client.put("item", null, upload(f.jpeg), signal());
    assert(photo.full.size > 0);
    assert.equal(f.paths.size, 1);
    assert.equal((await load()).storageBudget.bytes, 1000000000);
    await f.client.remove("item", photo.version, signal());
    assert.equal(f.paths.size, 0);
    assert.equal(
      Object.values((await load()).state.ops).filter(
        (o) => o.state !== "released",
      ).length,
      0,
    );
  },
);
await check(
  "production crosses both old caps and fits 2543 charged photos within unchanged history bounds",
  async () => {
    await seed();
    let s = await load();
    assert.equal(await swap(s, countState(2543)), "t");
    s = await load();
    assert.equal(Object.keys(s.state.ops).length, 2543);
    assert(
      Number(
        await sql("select pg_column_size(state) from qlist_photos.ledger;"),
      ) < 8388608,
    );
    const n = structuredClone(s.state);
    n.ops.extra = operation(9999);
    await assert.rejects(() => swap(s, n), /beta_cap_exceeded/);
  },
);
await check(
  "full-capacity object accounting remains bounded and does not double-charge 2543 mapped JPEGs",
  async () => {
    await seed(2543);
    await sql(
      `insert into storage.objects select n::text,'qlist-photos-v1','beta-v1/'||n||'/full.jpg','{"size":393216}'::jsonb from generate_series(0,2542) n;`,
    );
    const start = performance.now();
    const snapshot = await load();
    const elapsed = performance.now() - start;
    results.full_capacity_load_ms = elapsed;
    assert.equal(snapshot.storageBudget.externalBytes, 0);
    assert(elapsed < 4000, `local full-capacity read took ${elapsed}ms`);
    assert.equal(await swap(snapshot, snapshot.state), "t");
  },
);
await check(
  "aggregate byte boundary admits limit-1 and limit, rejects limit+1 including retained trial",
  async () => {
    for (const delta of [-1, 0, 1]) {
      await seed(0, 1000000000 - 393216 - 123 + delta);
      await sql(
        `insert into storage.objects values('other','other-bucket','x','{"size":123}');`,
      );
      const s = await load();
      if (delta <= 0) assert.equal(await swap(s, countState(1)), "t");
      else
        await assert.rejects(() => swap(s, countState(1)), /beta_cap_exceeded/);
    }
  },
);
await check(
  "changed external storage invalidates stale CAS token",
  async () => {
    await seed();
    const s = await load();
    await sql(
      `insert into storage.objects values('other','other-bucket','x','{"size":1}');`,
    );
    assert.equal(await swap(s, countState(1)), "f");
  },
);
await check(
  "concurrent last-slot requests serialize at shared capacity",
  async () => {
    await seed(0, 1000000000 - 393216);
    const s = await load();
    const states = [
      countState(1),
      { ...countState(1), ops: { other: operation(2) } },
    ];
    const r = await Promise.all(states.map((n) => swap(s, n)));
    assert.deepEqual(r.sort(), ["f", "t"]);
    const current = await load();
    const next = structuredClone(current.state);
    next.ops.more = operation(3);
    await assert.rejects(() => swap(current, next), /beta_cap_exceeded/);
  },
);
await check(
  "rate, concurrency, history reset and metadata bounds remain unchanged",
  async () => {
    await seed();
    for (const field of ["minuteRequests", "maintenanceRequests"]) {
      const s = await load(),
        n = structuredClone(s.state);
      n[field] = 61;
      await assert.rejects(() => swap(s, n), /beta_cap_exceeded/);
    }
    let s = await load();
    const n = countState(5);
    Object.values(n.ops).forEach((o) => {
      o.state = "pending";
      o.lease = Date.now() + 60000;
      o.writes = ["writing"];
    });
    await assert.rejects(() => swap(s, n), /beta_cap_exceeded/);
    await seed(1);
    s = await load();
    await assert.rejects(() => swap(s, empty), /history_reset_forbidden/);
    s.state.padding = "x".repeat(8388608);
    s.state.ops.more = operation(4);
    await assert.rejects(
      async () => swap(await load(), s.state),
      /beta_history_storage_full/,
    );
  },
);
// Canonical function definitions are compared exactly by rollback, including the helper.
const liveLoad = await sql(
  "select pg_get_functiondef('public.qlist_photos_load()'::regprocedure);",
);
const liveSwap = await sql(
  "select pg_get_functiondef('public.qlist_photos_swap(bigint,jsonb,text,jsonb)'::regprocedure);",
);
const liveHelper = await sql(
  "select pg_get_functiondef('public.qlist_photos_external_bytes(jsonb,bigint)'::regprocedure);",
);
const rollbackTemplate = await read("./rollback-template.sql");
// pg_get_functiondef has a final newline; psql trimming removes it above.
assert.equal(liveLoad + "\n", await read("./expanded-load.sql"));
assert.equal(liveSwap + "\n", await read("./expanded-swap.sql"));
const rollback = rollbackTemplate.replace(
  "end $guard$;",
  () =>
    ` if pg_get_functiondef('public.qlist_photos_external_bytes(jsonb,bigint)'::regprocedure) is distinct from $expected_helper$${liveHelper}\n$expected_helper$ then raise exception 'capacity_helper_changed_review_required'; end if;\nend $guard$;`,
);
await writeFile(new URL("./rollback.sql", import.meta.url), rollback);
await check(
  "rollback preserves above-old-cap charges and permits reads, receipts and gradual cleanup",
  async () => {
    await seed(172);
    const before = await contents();
    await sql(rollback);
    assert.equal(await contents(), before);
    let s = await load();
    assert.equal(s.storageBudget.bytes, 33554432);
    assert.equal(s.storageBudget.aggregateBytes, 67108864);
    assert.equal(await swap(s, s.state), "t");
    s = await load();
    const n = structuredClone(s.state);
    n.ops.more = operation(999);
    await assert.rejects(() => swap(s, n), /beta_cap_exceeded/);
    const reduced = structuredClone(s.state);
    reduced.ops["0"].state = "released";
    assert.equal(await swap(s, reduced), "t");
    assert.equal(Object.keys((await load()).state.ops).length, 172);
  },
);
await check(
  "rollback never refunds an unknown writer and checks its own source before replay",
  async () => {
    const s = await load();
    s.state.ops["1"].writes = ["writing"];
    assert.equal(await swap(await load(), s.state), "t");
    assert.equal((await load()).state.ops["1"].state, "committed");
    await assert.rejects(
      () => sql(rollback),
      /capacity_source_changed_review_required/,
    );
  },
);
results.passed = true;
results.production_slots = 2543;
results.forward_sha256 = createHash("sha256").update(forward).digest("hex");
results.rollback_sha256 = createHash("sha256").update(rollback).digest("hex");
await writeFile(
  new URL("./postgres-results.json", import.meta.url),
  JSON.stringify(results, null, 2) + "\n",
);
console.log(JSON.stringify({ passed: true, checks: results.tests.length }));
