import { validID } from "../../src/model.ts";
import { BetaError, demand } from "./ledger.ts";
export type TextAuthority = (
  list: string,
  item: string,
  signal: AbortSignal,
) => Promise<{ listExists: boolean; itemExists: boolean }>;
export function validScope(list: string, item: string) {
  demand(
    typeof list === "string" &&
      validID(list) &&
      list !== "new" &&
      new TextEncoder().encode(list).length <= 768,
    "Invalid list.",
    400,
  );
  demand(
    typeof item === "string" &&
      validID(item) &&
      new TextEncoder().encode(item).length <= 768 &&
      item !== "__proto__",
    "Invalid item.",
    400,
  );
}
async function boundedJSON(response: Response) {
  if (!response.ok || !response.body)
    throw new BetaError("Text validation is unavailable.", 503);
  const reader = response.body.getReader();
  let size = 0;
  const chunks: Uint8Array[] = [];
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > 8192) throw new Error("Text response too large");
      chunks.push(value);
    }
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let at = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, at);
    at += chunk.length;
  }
  return JSON.parse(new TextDecoder().decode(bytes));
}
// Exact public text reads only. Never sends photo bytes, metadata, counters or credentials to Firebase.
// Tests inject a loopback resolver; deployment pins the existing text database and v2 namespace.
export function firebaseTextAuthority(
  fetcher: typeof fetch = fetch,
): TextAuthority {
  const origin = "https://qwiklist.firebaseio.com";
  return async (list, item, signal) => {
    validScope(list, item);
    try {
      const read = async (path: string) =>
        boundedJSON(
          await fetcher(origin + path + ".json", {
            method: "GET",
            cache: "no-store",
            redirect: "error",
            credentials: "omit",
            signal: AbortSignal.any([signal, AbortSignal.timeout(2000)]),
          }),
        );
      const claim = await read("/v2/listClaims/" + encodeURIComponent(list));
      if (claim !== true) return { listExists: false, itemExists: false };
      const value = await read(
        "/v2/lists/" +
          encodeURIComponent(list) +
          "/" +
          encodeURIComponent(item),
      );
      const valid =
        value &&
        typeof value === "object" &&
        !Array.isArray(value) &&
        typeof value.name === "string" &&
        value.name.trim().length > 0 &&
        value.name.length <= 1000 &&
        typeof value.checked === "boolean" &&
        (typeof value.ID === "string" ||
          (typeof value.ID === "number" && Number.isFinite(value.ID))) &&
        Object.keys(value).every((k) => ["ID", "name", "checked"].includes(k));
      return { listExists: true, itemExists: Boolean(valid) };
    } catch {
      throw new BetaError("Text validation is unavailable.", 503);
    }
  };
}
