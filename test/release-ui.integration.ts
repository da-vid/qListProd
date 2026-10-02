import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { build } from "vite";
import { JSDOM } from "jsdom";
import { owner, loadRules, writesEnabled } from "./candidate-harness.ts";
import { digest } from "../scripts/migration-core.mjs";
// Test-only build-time replacement. Production artifacts cannot select this module.
async function harness(entry: string, url: string) {
  const outDir = await mkdtemp(path.join(tmpdir(), "qlist-release-ui-"));
  await build({
    configFile: false,
    logLevel: "silent",
    mode: "release",
    plugins: [
      {
        name: "loopback-only-test-database",
        enforce: "pre",
        load(id) {
          if (id.endsWith("/src/production-store.ts"))
            return `
      import { emulatorDatabase } from '${path.resolve("src/firebase-store.ts")}';
      import { forceWebSockets, onValue, ref, goOffline } from 'firebase/database';
      import { deleteApp, setLogLevel } from 'firebase/app';
      export function productionDatabase(name) { setLogLevel('silent'); forceWebSockets(); const db=emulatorDatabase(name,'127.0.0.1',19000); window.stopTestDatabase=()=>{goOffline(db);return deleteApp(db.app);}; return db; }
      export function watchWrites(db,cb) { return onValue(ref(db,'v2Control/writesEnabled'),s=>cb(s.val()===true),()=>cb(false)); }
    `;
        },
      },
    ],
    build: {
      outDir,
      lib: {
        entry: path.resolve(entry),
        name: "qListTest",
        formats: ["iife"],
        fileName: () => "ui.js",
      },
    },
  });
  const dom = new JSDOM('<div id="app"></div>', {
    url,
    runScripts: "outside-only",
    pretendToBeVisual: true,
  });
  Object.defineProperty(dom.window, "matchMedia", {
    value: () => ({ matches: false }),
  });
  Object.assign(dom.window.HTMLDialogElement.prototype, {
    showModal() {
      this.setAttribute("open", "");
    },
    close() {
      this.removeAttribute("open");
    },
  });
  dom.window.eval(await readFile(path.join(outDir, "ui.js"), "utf8"));
  return dom;
}
async function until(fn: () => boolean) {
  for (let i = 0; i < 200; i++) {
    if (fn()) return;
    await new Promise((r) => setTimeout(r, 20));
  }
  assert.fail("UI condition timed out");
}
async function close(dom: JSDOM) {
  await (
    dom.window as unknown as { stopTestDatabase?: () => Promise<void> }
  ).stopTestDatabase?.();
  dom.window.close();
}
test(
  "production UI maintenance transitions and read-only recovery use the same schema (DOM simulator)",
  { timeout: 30000 },
  async () => {
    await loadRules("database.rules.json");
    await owner("", "PUT", {
      v2Control: { writesEnabled: false },
      v2: {
        lists: {
          Synthetic: {
            "3": {
              ID: 99,
              name: "Latest saved item",
              checked: true,
              ".priority": 7,
            },
          },
        },
        listAttrs: { Synthetic: { listName: "Saved title" } },
        listClaims: { Synthetic: true },
      },
    });
    const recovery = await harness(
      "src/recovery.ts",
      "https://www.qlist.cc/Synthetic",
    );
    try {
      await until(
        () =>
          recovery.window.document
            .querySelector("li")
            ?.textContent?.includes("Latest saved item") === true,
      );
      assert.equal(
        recovery.window.document.querySelectorAll("input,form").length,
        0,
      );
      assert.match(
        recovery.window.document.body.textContent ?? "",
        /reading mode/,
      );
    } finally {
      await close(recovery);
    }
    const before = digest(await owner("v2"));
    const modern = await harness(
      "src/main.ts",
      "https://www.qlist.cc/CustomDuringFreeze",
    );
    try {
      const d = modern.window.document;
      await until(
        () =>
          d
            .querySelector(".status")
            ?.textContent?.includes("editing paused") === true,
      );
      assert.equal(
        (d.querySelector(".add button") as HTMLButtonElement).disabled,
        true,
      );
      assert.equal(digest(await owner("v2")), before);
      await writesEnabled(true);
      await until(
        () => !(d.querySelector(".add button") as HTMLButtonElement).disabled,
      );
      assert.equal(await owner("v2/listClaims/CustomDuringFreeze"), true);
      (d.querySelector(".add input") as HTMLInputElement).value =
        "Modern test item";
      d.querySelector("form")!.dispatchEvent(
        new modern.window.Event("submit", { bubbles: true, cancelable: true }),
      );
      await until(
        () =>
          d.querySelectorAll(".item").length === 1 &&
          d.querySelector(".status")?.textContent === "All changes saved",
      );
      const rules = JSON.parse(
        await readFile("candidate/database.rules.json", "utf8"),
      );
      rules.rules.v2.listAttrs.$list.lastMod[".write"] = false;
      await owner(".settings/rules", "PUT", rules);
      const name = d.querySelector(".item .name") as HTMLInputElement;
      name.value = "Edit saved but timestamp denied";
      name.dispatchEvent(new modern.window.Event("change", { bubbles: true }));
      await until(
        () =>
          d
            .querySelector(".error")
            ?.textContent?.includes("Your change was saved") === true,
      );
      assert.equal(
        (d.querySelector(".error .btn") as HTMLButtonElement).hidden,
        true,
      );
      assert.equal(
        d.querySelector(".status")?.textContent,
        "All changes saved",
      );
      await loadRules("database.rules.json");
      await writesEnabled(false);
      await until(
        () => (d.querySelector(".item .name") as HTMLInputElement).disabled,
      );
      assert.equal(
        (d.querySelector(".item .drag-handle") as HTMLButtonElement).disabled,
        true,
      );
    } finally {
      await close(modern);
    }
  },
);
