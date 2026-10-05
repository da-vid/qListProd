import { test } from "node:test";
import assert from "node:assert/strict";
import { build } from "vite";
import { JSDOM } from "jsdom";
import path from "node:path";
// Use the real FirebaseStore with a controllable SDK boundary. No network or credentials.
const result = await build({
  configFile: false,
  logLevel: "silent",
  plugins: [
    {
      name: "synthetic-snapshot-order",
      enforce: "pre",
      resolveId(id) {
        if (id === "firebase/database" || id === "firebase/app")
          return "\0" + id;
      },
      load(id) {
        if (id === "\0firebase/app")
          return "export const initializeApp=()=>({}),deleteApp=()=>Promise.resolve();";
        if (id === "\0firebase/database")
          return `
        export const ref=(_db,path)=>path;
        export function onValue(path,fn,error){window.reads[path]={fn,error};return()=>{window.reads[path].stopped=true;};}
        export const getDatabase=()=>({}),connectDatabaseEmulator=()=>{},get=()=>{},set=()=>{},runTransaction=()=>{},goOffline=()=>{},goOnline=()=>{};
      `;
      },
    },
  ],
  build: {
    write: false,
    lib: {
      entry: path.resolve("src/firebase-store.ts"),
      name: "StoreHarness",
      formats: ["iife"],
    },
  },
});
const bundle = (Array.isArray(result) ? result[0] : result).output.find(
  (x) => x.type === "chunk",
)!;
for (const titleFirst of [true, false])
  test(`initial Firebase snapshot waits for both nodes (${titleFirst ? "title" : "items"} first)`, () => {
    const dom = new JSDOM("", { runScripts: "outside-only" });
    const w = dom.window as any;
    w.reads = {};
    w.eval(bundle.code);
    const states: any[] = [];
    const store = new w.StoreHarness.FirebaseStore({}, "Synthetic");
    const stop = store.subscribe(
      (s: any) => states.push(s),
      () => {},
      () => {},
    );
    const items = w.reads["lists/Synthetic"],
      title = w.reads["listAttrs/Synthetic/listName"];
    const titleSnapshot = { val: () => "Saved title" };
    const itemsSnapshot = {
      forEach: (fn: any) =>
        fn({
          key: "a",
          priority: 1,
          val: () => ({ ID: "a", name: "Saved item", checked: false }),
        }),
    };
    try {
      if (titleFirst) title.fn(titleSnapshot);
      else items.fn(itemsSnapshot);
      assert.equal(
        states.length,
        0,
        "a partial initial list must not be published",
      );
      if (titleFirst) items.fn(itemsSnapshot);
      else title.fn(titleSnapshot);
      assert.equal(states.length, 1);
      assert.equal(states[0].title, "Saved title");
      assert.equal(states[0].items[0].name, "Saved item");
      items.fn({ forEach: () => {} });
      assert.equal(
        states.at(-1).items.length,
        0,
        "confirmed empty lists still publish",
      );
      stop();
      const count = states.length;
      title.fn({ val: () => "Late title" });
      assert.equal(states.length, count);
    } finally {
      stop();
      dom.window.close();
    }
  });
