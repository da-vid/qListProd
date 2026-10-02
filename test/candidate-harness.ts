import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";
const origin = "http://127.0.0.1:19000";
const ns = "demo-qlist-default-rtdb";
// Emulator-only owner bypass: never accept an endpoint or namespace argument.
export async function owner(path: string, method = "GET", value?: unknown) {
  const encodedPath = path.split("/").map(encodeURIComponent).join("/");
  const response = await fetch(
    `${origin}/${encodedPath}.json?ns=${ns}&format=export`,
    {
      method,
      headers: {
        Authorization: "Bearer owner",
        "Content-Type": "application/json",
      },
      ...(value === undefined ? {} : { body: JSON.stringify(value) }),
      signal: AbortSignal.timeout(15000),
    },
  );
  assert.equal(response.ok, true, "Loopback owner operation failed");
  return response.json();
}
export async function loadRules(filename: string) {
  const rules = JSON.parse(
    await readFile(
      new URL(`../candidate/${filename}`, import.meta.url),
      "utf8",
    ),
  );
  await owner(".settings/rules", "PUT", rules);
}
export async function writesEnabled(value: boolean) {
  await owner("v2Control/writesEnabled", "PUT", value);
}
