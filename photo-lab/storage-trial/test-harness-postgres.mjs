import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { runCase } from "./handler.ts";
const [psql, socket, database] = process.argv.slice(2);
assert(socket.includes("/qlist-phase-a-") && socket.endsWith("/socket"));
assert(/^trial_\d+$/.test(database));
const env = Object.fromEntries(
  Object.entries(process.env).filter(([k]) => !k.startsWith("PG")),
);
const run = promisify(execFile);
const rpc = async (action, payload, signal) => {
  const body = JSON.stringify(payload).replaceAll("'", "''");
  const sql = `set role service_role; select public.qlist_photo_trial_rpc('${action}','${body}'::jsonb);`;
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
      database,
      "-v",
      "ON_ERROR_STOP=1",
      "-c",
      sql,
    ],
    { env, signal, timeout: 8000, maxBuffer: 256 * 1024 },
  );
  return JSON.parse(stdout);
};
for (const name of [
  "smoke",
  "replacement-race",
  "delete-during-stage",
  "partial-cleanup",
  "status",
]) {
  const result = await runCase(name, rpc, AbortSignal.timeout(15000));
  assert(result.evidence.length > 0);
  console.log("PASS harness case", name);
}
