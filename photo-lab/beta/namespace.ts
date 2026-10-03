import { validID } from "../../src/model.ts";
import { demand } from "./ledger.ts";
// Public namespaces, not proof that a Firebase list or item exists.
export function validScope(list: string, item: string) {
  demand(
    typeof list === "string" &&
      validID(list) &&
      list !== "new" &&
      list !== "__proto__" &&
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
