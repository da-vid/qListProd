import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { createHash } from "node:crypto";
const root = new URL("../", import.meta.url);
const files = [
  ...(await readdir(new URL("supabase/migrations/", root)))
    .filter((name) => name.endsWith(".sql"))
    .sort()
    .map((name) => "supabase/migrations/" + name),
  "rollback.sql",
  "phase-b/rollback.sql",
];
const sources = await Promise.all(
  files.map(async (name) => ({
    name,
    sql: await readFile(new URL(name, root), "utf8"),
  })),
);
const statements = (sql: string) =>
  sql
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/--[^\n]*/g, " ")
    .match(
      /\bupdate\s+(?:only\s+)?(?:"?qlist_photo_trial"?\s*\.\s*)?"?budgets"?\s+[\s\S]*?;/gi,
    ) ?? [];
const scoped = (statement: string) => {
  const lexical = statement.replace(/'(?:''|[^'])*'/g, "''");
  return (
    /\bwhere\s+scope\s+in\s*\(\s*''\s*,\s*''\s*\)\s*;\s*$/i.test(lexical) &&
    /\bwhere\s+scope\s+in\s*\(\s*'global'\s*,\s*'PhotoDemo'\s*\)\s*;\s*$/i.test(
      statement,
    )
  );
};
test("all canonical migration and rollback budget updates have the reviewed explicit scope predicate", () => {
  let count = 0;
  for (const { name, sql } of sources) {
    for (const statement of statements(sql)) {
      count++;
      assert(scoped(statement), `${name}: unscoped budget update`);
    }
  }
  assert.equal(count, 10); // historical 7 + continuation claim, close and read
});
test("removing the WHERE clause from any canonical budget update is caught", () => {
  for (const { sql } of sources)
    for (const statement of statements(sql)) {
      const mutant = statement.replace(
        /\s+where\s+scope\s+in\s*\([^)]*\)\s*;/i,
        ";",
      );
      assert.notEqual(mutant, statement);
      assert(!scoped(mutant));
    }
});
test("comments, string literals, unrelated WHERE clauses and broadened scopes cannot satisfy the guard", () => {
  for (const sql of [
    "update qlist_photo_trial.budgets set stopped=true /* where scope in ('global','PhotoDemo') */;",
    "update qlist_photo_trial.budgets set note='where scope in (''global'',''PhotoDemo'')';",
    "update qlist_photo_trial.budgets set stopped=true where true;",
    "update qlist_photo_trial.budgets set stopped=true where scope in ('global','PhotoDemo') or true;",
    "update qlist_photo_trial.budgets set stopped=true -- where scope in ('global','PhotoDemo')\n;",
  ]) {
    assert.equal(statements(sql).length, 1);
    assert(!scoped(statements(sql)[0]));
  }
});
test("continuation changes only its own markers and retains historical source guards and expiry", () => {
  const sql = sources.find((s) => s.name.includes("_continuation.sql"))!.sql;
  assert(sql.includes("is distinct from 'a062f7fd5e8b1535c282e5bad0068683'"));
  assert(sql.includes("is distinct from 'd2ae306d98126389774c8cdc7e7ac128'"));
  assert(sql.includes("expires_at<>'2026-10-04T00:00:00Z'::timestamptz"));
  assert(sql.includes("raise exception 'original_batch_closed'"));
  assert(
    !/\bset\s+(batch_state|batch_owner|expires_at|cap_bytes|operation_count|stopped)\s*=/i.test(
      sql,
    ),
  );
  assert(!/\b(drop|truncate|security definer)\b/i.test(sql));
  assert(!/\b(insert into|update|delete from)\s+storage\./i.test(sql));
});
test("canonical runtime bodies exactly match the reviewed hosted fix and supplied source hashes", async () => {
  const fix = await readFile(
    new URL("phase-b/reviewed-safeupdate-fix.sql", root),
    "utf8",
  );
  assert.equal(
    createHash("sha256").update(fix).digest("hex"),
    "81ad85d37eb83b7a31d9e1624d4ed24c296651a68be3fee13dbac091c647d5b7",
  );
  const extract = (sql: string, name: string) => {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const m = sql.match(
      new RegExp(
        "create(?: or replace)? function " +
          escaped +
          "\\(.*?\\bas \\$\\$([\\s\\S]*?)\\$\\$;",
        "is",
      ),
    );
    assert(m);
    return m[1];
  };
  for (const [index, name, hash] of [
    [0, "qlist_photo_trial.reconcile", "d2ae306d98126389774c8cdc7e7ac128"],
    [1, "public.qlist_photo_trial_b_rpc", "a062f7fd5e8b1535c282e5bad0068683"],
  ] as const) {
    const body = extract(sources[index].sql, name);
    assert.equal(body, extract(fix, name));
    assert.equal(createHash("md5").update(body).digest("hex"), hash);
  }
});
