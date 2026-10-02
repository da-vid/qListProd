import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  parseJSON,
  parseRules,
  canonical,
  prepare,
  digest,
} from "../scripts/migration-core.mjs";
import { run } from "../scripts/migrate.mjs";
const fixture = {
  lists: {
    Synthetic: [
      null,
      { ID: 9, name: "Original", checked: false, ".priority": 7 },
    ],
  },
  listAttrs: {
    Synthetic: { listName: "Title" },
    Empty: { listName: "No items" },
  },
};
test("strict export parsing rejects duplicate keys, directives and unsafe numbers", () => {
  for (const input of [
    '{"lists":{},"lists":{}}',
    '{"n":9007199254740993}',
    '{"n":1e999}',
    '{"n":true garbage}',
  ])
    assert.throws(() => parseJSON(input));
  assert.deepEqual(
    parseRules(
      '{/* disabled example */"rules":{".read":false,// no listing\n"url":"https://example.test/*literal*/"}}',
    ),
    parseJSON(
      '{"rules":{".read":false,"url":"https://example.test/*literal*/"}}',
    ),
  );
  assert.throws(() => parseRules("{/* missing end"));
  assert.throws(() => canonical({ value: { ".sv": "timestamp" } }));
  const parsed = parseJSON('{"__proto__":{"safe":true},"lists":{"2":null}}');
  assert.equal(Object.getPrototypeOf(parsed), null);
  assert.equal(canonical(parsed).__proto__.safe, true);
});
test("plan preserves arrays, metadata, historical IDs and title-only claims", () => {
  const result = prepare(fixture);
  assert.deepEqual(result.payload.lists, fixture.lists);
  assert.deepEqual(result.payload.listAttrs, fixture.listAttrs);
  assert.equal(result.payload.listClaims.Empty, true);
  assert.deepEqual(result.summary, {
    lists: 2,
    items: 1,
    titleOnly: 1,
    historicalIDMismatches: 1,
  });
  assert.equal(
    digest(fixture.lists),
    digest({ Synthetic: { "1": fixture.lists.Synthetic[1] } }),
  );
  assert.notEqual(digest({ ID: 9 }), digest({ ID: "9" }));
  assert.throws(() => prepare({ ...fixture, v2: {} }));
  assert.throws(() =>
    prepare({ lists: { X: { a: { ID: "a", name: " ", checked: false } } } }),
  );
});
test("offline plan writes private new files and refuses accidental live execution", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "qlist-offline-plan-"));
  const source = path.join(directory, "source.json");
  await writeFile(source, JSON.stringify(fixture), { mode: 0o600 });
  const before = await readFile(source);
  await run({ action: "plan", directory, export: source });
  assert.equal(
    (await stat(path.join(directory, "v2-export.json"))).mode % 512,
    0o600,
  );
  assert.deepEqual(await readFile(source), before);
  await assert.rejects(run({ action: "plan", directory, export: source }));
  await assert.rejects(
    run({ action: "freeze", directory, live: true }),
    /writes-require-execute/,
  );
  await assert.rejects(
    run({ action: "freeze", directory, live: true, execute: true }),
    /approval/,
  );
  await assert.rejects(
    run({
      action: "freeze",
      directory,
      emulator: true,
      live: true,
      execute: true,
    }),
    /emulator-cannot/,
  );
});
