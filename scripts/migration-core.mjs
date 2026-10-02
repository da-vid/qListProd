import { createHash } from "node:crypto";
import { validID } from "../src/model.ts";
export const sha = (value) => createHash("sha256").update(value).digest("hex");
export function insist(value, code) {
  if (!value) throw new Error(code);
}
// Parse with duplicate-key detection. Errors never include source text or paths.
export function parseJSON(text) {
  let i = 0;
  const space = () => {
    while (/\s/.test(text[i] ?? "") && i < text.length) i++;
  };
  const string = () => {
    const start = i++;
    while (i < text.length) {
      if (text[i] === "\\") i += 2;
      else if (text[i++] === '"') return JSON.parse(text.slice(start, i));
    }
    throw new Error("invalid-json");
  };
  function value() {
    space();
    if (text[i] === '"') return string();
    if (text[i] === "{") {
      i++;
      space();
      const output = Object.create(null),
        seen = new Set();
      if (text[i] === "}") {
        i++;
        return output;
      }
      for (;;) {
        insist(text[i] === '"', "invalid-json");
        const key = string();
        insist(!seen.has(key), "duplicate-json-key");
        seen.add(key);
        space();
        insist(text[i++] === ":", "invalid-json");
        output[key] = value();
        space();
        if (text[i] === "}") {
          i++;
          return output;
        }
        insist(text[i++] === ",", "invalid-json");
        space();
      }
    }
    if (text[i] === "[") {
      i++;
      space();
      const output = [];
      if (text[i] === "]") {
        i++;
        return output;
      }
      for (;;) {
        output.push(value());
        space();
        if (text[i] === "]") {
          i++;
          return output;
        }
        insist(text[i++] === ",", "invalid-json");
      }
    }
    const match =
      /^(?:true|false|null|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)/.exec(
        text.slice(i),
      );
    insist(match, "invalid-json");
    i += match[0].length;
    const result = JSON.parse(match[0]);
    insist(
      typeof result !== "number" ||
        (Number.isFinite(result) &&
          (!Number.isInteger(result) || Number.isSafeInteger(result))),
      "unsafe-json-number",
    );
    return result;
  }
  const result = value();
  space();
  insist(i === text.length, "invalid-json");
  return result;
}
// Rules exports may contain JSON comments. Strip only outside quoted strings;
// data exports always use strict JSON and never pass through this function.
export function parseRules(text) {
  let output = "",
    i = 0;
  while (i < text.length) {
    if (text[i] === '"') {
      output += text[i++];
      while (i < text.length) {
        const c = text[i++];
        output += c;
        if (c === "\\") output += text[i++];
        else if (c === '"') break;
      }
    } else if (text.slice(i, i + 2) === "//") {
      while (i < text.length && text[i] !== "\n") {
        output += " ";
        i++;
      }
    } else if (text.slice(i, i + 2) === "/*") {
      const end = text.indexOf("*/", i + 2);
      insist(end >= 0, "unterminated-rule-comment");
      output += text.slice(i, end + 2).replace(/[^\n]/g, " ");
      i = end + 2;
    } else output += text[i++];
  }
  return parseJSON(output);
}
// Firebase serializes integer-key maps as arrays, and omits null/empty nodes.
// Only those representation differences are normalized; leaf values/types/priorities stay exact.
export function canonical(value) {
  if (value === null || typeof value !== "object") return value;
  insist(!Object.hasOwn(value, ".sv"), "server-value-directive-forbidden");
  const priority = value[".priority"];
  insist(
    priority == null ||
      typeof priority === "string" ||
      (typeof priority === "number" && Number.isFinite(priority)),
    "invalid-priority",
  );
  if (Object.hasOwn(value, ".value")) {
    insist(
      Object.keys(value).every((k) => k === ".value" || k === ".priority"),
      "invalid-value-wrapper",
    );
    const inner = canonical(value[".value"]);
    return inner === null
      ? null
      : priority == null
        ? inner
        : { ".priority": priority, ".value": inner };
  }
  const entries = Object.keys(value)
    .filter((k) => k !== ".priority")
    .sort()
    .flatMap((k) => {
      const child = canonical(value[k]);
      return child === null ? [] : [[k, child]];
    });
  if (!entries.length) return null;
  return Object.fromEntries([
    ...entries,
    ...(priority == null ? [] : [[".priority", priority]]),
  ]);
}
export const digest = (value) => sha(JSON.stringify(canonical(value)));
export function legacyTree(root) {
  insist(
    root && typeof root === "object" && !Array.isArray(root),
    "invalid-root",
  );
  insist(
    Object.keys(root).every((k) =>
      ["lists", "listAttrs", ".priority", "v2", "v2Control"].includes(k),
    ),
    "unexpected-root-node",
  );
  return Object.fromEntries(
    Object.entries(root).filter(([key]) =>
      ["lists", "listAttrs", ".priority"].includes(key),
    ),
  );
}
export function prepare(root) {
  insist(
    !Object.hasOwn(root, "v2") && !Object.hasOwn(root, "v2Control"),
    "export-is-not-a-legacy-snapshot",
  );
  const original = legacyTree(root),
    normalized = canonical(original) ?? {};
  const keys = (object) =>
    Object.keys(object ?? {}).filter((k) => k !== ".priority");
  const ids = [
    ...new Set([...keys(normalized.lists), ...keys(normalized.listAttrs)]),
  ];
  let items = 0,
    mismatches = 0,
    titleOnly = 0;
  for (const id of ids) {
    insist(validID(id) && id !== "new", "unsupported-list-id");
    const list = normalized.lists?.[id],
      attrs = normalized.listAttrs?.[id];
    if (!list) titleOnly++;
    insist(
      !list || (typeof list === "object" && !Object.hasOwn(list, ".value")),
      "invalid-list",
    );
    for (const key of keys(list)) {
      insist(validID(key), "invalid-item-key");
      const item = list[key];
      insist(
        item &&
          typeof item === "object" &&
          Object.keys(item).every((k) =>
            ["ID", "name", "checked", ".priority"].includes(k),
          ),
        "invalid-item-shape",
      );
      insist(["number", "string"].includes(typeof item.ID), "invalid-item-id");
      insist(
        typeof item.name === "string" &&
          item.name.length > 0 &&
          item.name.length <= 1000 &&
          /^.*[^ ].*$/.test(item.name),
        "unsupported-item-name",
      );
      insist(typeof item.checked === "boolean", "invalid-checked-value");
      items++;
      if (String(item.ID) !== key) mismatches++;
    }
    if (attrs) {
      insist(
        typeof attrs === "object" &&
          Object.keys(attrs).every((k) =>
            ["listName", "lastMod", ".priority"].includes(k),
          ),
        "unsupported-attributes",
      );
      if (Object.hasOwn(attrs, "listName"))
        insist(
          typeof attrs.listName === "string" && attrs.listName.length <= 160,
          "unsupported-title",
        );
      if (Object.hasOwn(attrs, "lastMod"))
        insist(
          typeof attrs.lastMod === "number" && attrs.lastMod >= 0,
          "unsupported-last-modified",
        );
    }
  }
  return {
    payload: {
      ...original,
      listClaims: Object.fromEntries(ids.map((id) => [id, true])),
    },
    summary: {
      lists: ids.length,
      items,
      titleOnly,
      historicalIDMismatches: mismatches,
    },
    sourceDigest: digest(original),
  };
}
export function verifyCopy(actual, expected) {
  insist(
    digest(actual) === digest(expected),
    "namespace-verification-mismatch",
  );
}
