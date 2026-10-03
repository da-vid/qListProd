import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { installPhotoUI } from "../src/photo/ui.ts";
import { applyWithPhotoCleanup } from "../src/photo/text-delete.ts";
import { SavedMetadataWarning } from "../src/model.ts";
import type { PhotoGateway } from "../src/photo/gateway.ts";
const tick = () => new Promise((r) => setTimeout(r, 5));
async function setup() {
  const dom = new JSDOM(
    '<div id="app"><li class="item" data-key="item"></li></div>',
  );
  const root = dom.window.document.querySelector<HTMLElement>("#app")!;
  const removals: Array<[string, number]> = [];
  let observed = 7;
  const gateway: PhotoGateway = {
    observedVersion: () => observed,
    get: async () => undefined,
    put: async () => {
      throw Error("unused");
    },
    status: async () => undefined,
    remove: async (key, version) => {
      removals.push([key, version]);
    },
    deleteItem: async () => {
      throw Error("Unversioned delete forbidden");
    },
  };
  const ui = installPhotoUI(root, gateway, { minimal: true });
  await tick();
  return {
    dom,
    root,
    ui,
    removals,
    setObserved: (v: number) => {
      observed = v;
    },
    close: () => {
      ui.close();
      dom.window.close();
    },
  };
}
test("DOM disappearance and failed text writes never authorize photo removal", async () => {
  const f = await setup();
  try {
    await assert.rejects(() =>
      applyWithPhotoCleanup(
        f.root,
        { type: "delete", key: "item" },
        async () => {
          throw Error("text failed");
        },
      ),
    );
    f.root.querySelector(".item")!.remove();
    await tick();
    await f.ui.retry();
    assert.deepEqual(f.removals, []);
  } finally {
    f.close();
  }
});
test("confirmed existing text write removes only the captured photo revision; no extra text operation", async () => {
  const f = await setup();
  let calls = 0;
  try {
    await applyWithPhotoCleanup(
      f.root,
      { type: "delete", key: "item" },
      async () => {
        calls++;
        f.setObserved(9);
        f.root.querySelector(".item")!.remove();
        await tick();
      },
    );
    await tick();
    assert.equal(calls, 1);
    assert.deepEqual(f.removals, [["item", 7]]);
  } finally {
    f.close();
  }
});
test("confirmed text deletion with metadata warning still cleans; edits never trigger cleanup", async () => {
  const f = await setup();
  try {
    await applyWithPhotoCleanup(
      f.root,
      { type: "edit", key: "item", name: "New text" },
      async () => {},
    );
    assert.deepEqual(f.removals, []);
    await assert.rejects(() =>
      applyWithPhotoCleanup(
        f.root,
        { type: "delete", key: "item" },
        async () => {
          throw new SavedMetadataWarning();
        },
      ),
    );
    await tick();
    assert.deepEqual(f.removals, [["item", 7]]);
  } finally {
    f.close();
  }
});
