import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { fixture, signal, upload } from "./test-support.ts";
import { RESERVATION, PROJECT, transact } from "./ledger.ts";
const [psql, socket, safe] = process.argv.slice(2),
  run = promisify(execFile);
assert(socket.includes("/qlist-beta-pg-") && socket.endsWith("/socket"));
const env = Object.fromEntries(
  Object.entries(process.env).filter(([k]) => !k.startsWith("PG")),
);
async function sql(query, role) {
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
      "postgres",
      "-v",
      "ON_ERROR_STOP=1",
      "-c",
      (role ? "set role " + role + ";" : "") + query,
    ],
    {
      env:
        role && safe
          ? { ...env, PGOPTIONS: "-c session_preload_libraries=" + safe }
          : env,
      maxBuffer: 2 * 1024 * 1024,
      timeout: 10000,
    },
  ).catch((e) => {
    throw Error(e.stderr || e.message);
  });
  return stdout.trim();
}
const quote = (value) => "'" + String(value).replaceAll("'", "''") + "'";
const migration = await readFile(
  new URL(
    "./supabase/migrations/20261003040950_qlist_photo_beta_disabled.sql",
    import.meta.url,
  ),
  "utf8",
);
await sql(`create role anon nologin;create role authenticated nologin;create role service_role nologin bypassrls;
create schema qlist_photo_trial;create table qlist_photo_trial.budgets(scope text primary key,used_bytes bigint,reserved_bytes bigint,photo_count int,operation_count int,item_count int,read_count int,read_bytes bigint,pending_count int,expires_at timestamptz,batch_state text,continuation_state text);
insert into qlist_photo_trial.budgets values('global',0,0,0,9,6,6,2359296,0,'2026-10-04T00:00:00Z','blocked','complete');
grant usage on schema qlist_photo_trial to service_role;grant select,update on qlist_photo_trial.budgets to service_role;`);
await sql(migration);
const results = {
  runtime: process.version,
  scope:
    "temporary PostgreSQL with actual local JPEG files; no hosted services",
  tests: [],
  safeupdate: Boolean(safe),
};
async function check(name, fn) {
  await fn();
  results.tests.push(name);
  console.log("PASS " + name);
}
const ledger = {
  load: async () =>
    JSON.parse(
      await sql("select public.qlist_photo_beta_load();", "service_role"),
    ),
  swap: async (before, state) =>
    (await sql(
      `select public.qlist_photo_beta_swap(${before.revision},${quote(JSON.stringify(before.control))}::jsonb,${quote(before.legacyToken)},${quote(JSON.stringify(state))}::jsonb);`,
      "service_role",
    )) === "t",
};
await check(
  "migration starts disabled, empty allowlist, no activation deadline",
  async () => {
    const s = await ledger.load();
    assert.deepEqual(s.control, {
      enabled: false,
      maintenance: false,
      lists: [],
    });
    assert.equal(s.legacy.operations, 9);
    assert.equal(s.legacy.readBytes, 2359296);
  },
);
await check(
  "anon and authenticated cannot call RPC or read ledger; service cannot change control",
  async () => {
    for (const role of ["anon", "authenticated"])
      for (const command of [
        "select public.qlist_photo_beta_load();",
        "select * from qlist_photo_beta.ledger;",
      ])
        await assert.rejects(() => sql(command, role), /permission denied/);
    await assert.rejects(
      () =>
        sql(
          `update qlist_photo_beta.ledger set control='{}' where singleton;`,
          "service_role",
        ),
      /permission denied/,
    );
    assert.equal(
      await sql(
        "select relrowsecurity from pg_class where oid='qlist_photo_beta.ledger'::regclass;",
      ),
      "t",
    );
  },
);
await sql(
  `update qlist_photo_beta.ledger set control=${quote(JSON.stringify({ enabled: true, maintenance: true, lists: ["PhotoDemo"] }))}::jsonb where singleton;`,
);
const originalLegacy = await sql(
  "select to_jsonb(b)::text from qlist_photo_trial.budgets b where scope='global';",
);
const f = await fixture(ledger);
await check(
  "HTTP client plus PostgreSQL CAS plus real codec/files round-trip",
  async () => {
    const p = await f.client.put("item", null, upload(f.jpeg), signal());
    assert(p.full.size > 0);
    assert.equal(f.paths.size, 1);
    assert.equal((await ledger.load()).state.reads, 1);
  },
);
await check(
  "lost CAS and kill-switch control changes reject stale state",
  async () => {
    const before = await ledger.load();
    await f.engine.admit("PhotoDemo", "item", signal());
    assert.equal(await ledger.swap(before, before.state), false);
    const s = await ledger.load();
    await sql(
      "update qlist_photo_beta.ledger set control=jsonb_set(control,'{enabled}','false') where singleton;",
    );
    assert.equal(await ledger.swap(s, s.state), false);
    assert(await f.client.get("item", signal()));
    assert.equal(f.paths.size, 1);
    await sql(
      "update qlist_photo_beta.ledger set control=jsonb_set(control,'{enabled}','true') where singleton;",
    );
  },
);
await check(
  "cleanup failure remains charged, retry removes files, no historical rows disappear",
  async () => {
    const p = await f.client.get("item", signal());
    f.cleanupFails = true;
    await assert.rejects(() => f.client.remove("item", p.version, signal()));
    assert.equal(
      Object.values((await ledger.load()).state.ops).filter(
        (o) => o.state !== "released",
      ).length,
      1,
    );
    f.cleanupFails = false;
    await f.client.remove("item", p.version, signal());
    assert.equal(f.paths.size, 0);
    const s = await ledger.load();
    assert.equal(Object.keys(s.state.ops).length, 1);
    const changed = structuredClone(s.state);
    changed.ops = {};
    await assert.rejects(
      () => ledger.swap(s, changed),
      /history_reset_forbidden/,
    );
  },
);
await check(
  "prior trial expiry and every cumulative field are unchanged",
  async () => {
    assert.equal(
      await sql(
        "select to_jsonb(b)::text from qlist_photo_trial.budgets b where scope='global';",
      ),
      originalLegacy,
    );
  },
);
await check(
  "global last-capacity race serializes across PostgreSQL sessions",
  async () => {
    // Synthetic fixture changes ONLY in temporary database, to create a one-reservation boundary.
    await sql(
      `update qlist_photo_trial.budgets set used_bytes=${PROJECT.bytes - RESERVATION} where scope='global';`,
    );
    const r = await Promise.allSettled(
      ["item", "other"].map((key) =>
        f.client.put(key, null, upload(f.jpeg), signal()),
      ),
    );
    assert.equal(r.filter((x) => x.status === "fulfilled").length, 1);
  },
);
await check(
  "global last-rate-token race serializes and independent SQL cap guard rejects forged counter",
  async () => {
    await sql(
      `update qlist_photo_beta.ledger set state=jsonb_set(jsonb_set(state,'{minute}',to_jsonb(${Math.floor(Date.now() / 60000)}::bigint)),'{minuteRequests}','59') where singleton;`,
    );
    const r = await Promise.allSettled([
      f.engine.admit("PhotoDemo", "item", signal()),
      f.engine.admit("PhotoDemo", "other", signal()),
    ]);
    assert.equal(r.filter((x) => x.status === "fulfilled").length, 1);
    const s = await ledger.load();
    const state = structuredClone(s.state);
    state.minuteRequests = 61;
    await assert.rejects(() => ledger.swap(s, state), /beta_cap_exceeded/);
  },
);
if (safe)
  await check(
    "actual pg-safeupdate rejects unqualified UPDATE in service sessions",
    async () => {
      await assert.rejects(
        () =>
          sql(
            "update qlist_photo_beta.ledger set revision=revision;",
            "service_role",
          ),
        /WHERE clause/,
      );
    },
  );
await check(
  "review verification and stop artifacts execute without deleting state or objects",
  async () => {
    await sql(
      await readFile(new URL("./verification.sql", import.meta.url), "utf8"),
    );
    const before = await ledger.load();
    const files = f.paths.size;
    await sql(await readFile(new URL("./stop.sql", import.meta.url), "utf8"));
    const after = await ledger.load();
    assert.equal(after.control.enabled, false);
    assert.deepEqual(after.state, before.state);
    assert.equal(f.paths.size, files);
  },
);
await check(
  "upload stop and historical read totals cannot block read-only status or explicit cleanup",
  async () => {
    const snapshot = await ledger.load();
    const it = Object.values(snapshot.state.items).find((i) => i.current);
    assert(it);
    const id = it.current;
    await sql(
      "update qlist_photo_beta.ledger set state=jsonb_set(state,'{readBytes}','1073741824') where singleton;",
    );
    const before = await ledger.load();
    assert(await f.client.get(it.item, signal()));
    const status = await f.engine.status("PhotoDemo", it.item, id, signal());
    assert.equal(status.state, "committed");
    assert.deepEqual((await ledger.load()).state.ops, before.state.ops);
    f.textAvailable = false; // Photo-only removal does not depend on Firebase availability.
    await f.client.remove(it.item, it.version, signal());
    assert.equal(f.paths.size, 0);
    assert.equal((await ledger.load()).state.ops[id].state, "released");
  },
);
results.passed = true;
await mkdir(new URL("./results/", import.meta.url), { recursive: true });
await writeFile(
  new URL("./results/postgres.json", import.meta.url),
  JSON.stringify(results, null, 2) + "\n",
);
