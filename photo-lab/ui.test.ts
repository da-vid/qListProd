import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { JSDOM } from "jsdom";
import { MockPhotos, type PreparedPhoto } from "../src/photo/adapter.ts";
import { installPhotoUI } from "../src/photo/ui.ts";
const photo: PreparedPhoto = {
  full: new Blob([
    await readFile(new URL("./fixtures/clean-full.jpg", import.meta.url)),
  ]),
  thumbnail: new Blob([
    await readFile(new URL("./fixtures/clean-thumbnail.jpg", import.meta.url)),
  ]),
};
const tick = () => new Promise((r) => setTimeout(r, 20));
function setup(dom: JSDOM) {
  const { window: w } = dom;
  let created = 0;
  const live = new Set<string>();
  Object.assign(w.URL, {
    createObjectURL() {
      const url = `blob:synthetic-${++created}`;
      live.add(url);
      return url;
    },
    revokeObjectURL(url: string) {
      live.delete(url);
    },
  });
  Object.assign(w.HTMLDialogElement.prototype, {
    showModal() {
      this.setAttribute("open", "");
    },
    close() {
      this.removeAttribute("open");
    },
  });
  Object.defineProperty(w, "matchMedia", { value: () => ({ matches: false }) });
  return live;
}
function click(dom: JSDOM, label: string) {
  const buttons = [
    ...dom.window.document.querySelectorAll<HTMLButtonElement>("button"),
  ];
  const b = buttons.find((b) => b.textContent === label && !b.hidden)!;
  assert.ok(b, `button ${label} exists`);
  assert.equal(b.disabled, false);
  b.click();
  return b;
}
function change(dom: JSDOM, selector: string, value: string) {
  const el = dom.window.document.querySelector<HTMLInputElement>(selector)!;
  el.value = value;
  el.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
}
test("preview/cancel/save/replace/remove/expand and URL cleanup use separate photo state", async () => {
  const dom = new JSDOM(
    '<div id="app"><ul><li class="item" data-key="a">Synthetic item</li></ul></div>',
    { pretendToBeVisual: true },
  );
  const live = setup(dom),
    mock = new MockPhotos();
  const ui = installPhotoUI(dom.window.document.querySelector("#app")!, mock, {
    synthetic: async () => photo,
    timeout: 30,
  });
  try {
    await tick();
    click(dom, "Add photo");
    await tick();
    click(dom, "Try synthetic image");
    await tick();
    click(dom, "Cancel");
    assert.equal(mock.records.size, 0);
    assert.equal(live.size, 0);
    click(dom, "Add photo");
    await tick();
    click(dom, "Try synthetic image");
    await tick();
    click(dom, "Save photo");
    await tick();
    assert.equal(mock.records.size, 1);
    assert.equal(live.size, 1);
    const old = mock.records.get("a")!;
    dom.window.document
      .querySelector<HTMLButtonElement>(".photo-thumbnail")!
      .click();
    await tick();
    assert.equal(
      dom.window.document.querySelector("dialog h2")!.textContent,
      "Item photo",
    );
    click(dom, "Close");
    click(dom, "Change photo");
    await tick();
    click(dom, "Try synthetic image");
    await tick();
    mock.fault = "quota";
    click(dom, "Save photo");
    await tick();
    assert.equal(mock.records.get("a"), old);
    assert.match(
      dom.window.document.querySelector("dialog [role=status]")!.textContent!,
      /full/,
    );
    mock.fault = "healthy";
    click(dom, "Save photo");
    await tick();
    assert.notEqual(mock.records.get("a")!.version, old.version);
    click(dom, "Change photo");
    await tick();
    click(dom, "Remove photo");
    await tick();
    assert.equal(mock.records.size, 0);
    assert.equal(live.size, 0);
  } finally {
    ui.close();
    dom.window.close();
  }
});
test("late preparation cannot resurrect a cancelled dialog or leak preview URLs", async () => {
  const dom = new JSDOM(
    '<div id="app"><li class="item" data-key="a"></li></div>',
  );
  const live = setup(dom);
  let resolve!: (p: PreparedPhoto) => void;
  const mock = new MockPhotos(),
    ui = installPhotoUI(dom.window.document.querySelector("#app")!, mock, {
      synthetic: () => new Promise((r) => (resolve = r)),
    });
  try {
    await tick();
    click(dom, "Add photo");
    await tick();
    click(dom, "Try synthetic image");
    click(dom, "Cancel");
    resolve(photo);
    await tick();
    assert.equal(live.size, 0);
    assert.equal(mock.records.size, 0);
    assert.equal(dom.window.document.querySelector("dialog"), null);
  } finally {
    ui.close();
    dom.window.close();
  }
});
test("built qList text add/edit/check/delete works through every photo-service fault", async () => {
  const file = (await readdir("dist-photos/assets")).find((x) =>
    x.endsWith(".js"),
  )!;
  const source = await readFile(`dist-photos/assets/${file}`, "utf8");
  assert.doesNotMatch(source, /firebaseio\.com|supabase\.co/);
  for (const fault of [
    "offline",
    "paused",
    "quota",
    "rate",
    "forbidden",
    "server",
    "timeout",
  ]) {
    const dom = new JSDOM('<div id="app"></div>', {
      url: "http://127.0.0.1:4174/photos.html",
      runScripts: "outside-only",
      pretendToBeVisual: true,
    });
    setup(dom);
    try {
      dom.window.eval(source);
      await tick();
      change(dom, '[aria-label="Photo service simulation"]', fault);
      change(dom, ".add input", "Synthetic apples");
      dom.window.document
        .querySelector("form")!
        .dispatchEvent(
          new dom.window.Event("submit", { bubbles: true, cancelable: true }),
        );
      await tick();
      click(dom, "Add photo");
      await tick();
      click(dom, "Cancel");
      change(dom, ".item .name", "Edited while photos fail");
      await tick();
      const checkbox = dom.window.document.querySelector<HTMLInputElement>(
        ".item input[type=checkbox]",
      )!;
      checkbox.checked = true;
      checkbox.dispatchEvent(new dom.window.Event("change"));
      await tick();
      assert.equal(
        dom.window.document.querySelector<HTMLInputElement>(".item .name")!
          .value,
        "Edited while photos fail",
      );
      assert.match(
        dom.window.document.querySelector(".status")!.textContent!,
        /Saved on this device/,
      );
      dom.window.document
        .querySelector<HTMLButtonElement>(".delete-item")!
        .click();
      await tick();
      assert.equal(dom.window.document.querySelectorAll(".item").length, 0);
      assert.match(
        dom.window.document.querySelector(".photo-cleanup")!.textContent!,
        /cleanup is waiting/,
      );
      change(dom, '[aria-label="Photo service simulation"]', "healthy");
      click(dom, "Retry photos");
      await tick();
      assert.equal(
        dom.window.document.querySelector(".photo-cleanup")!.textContent,
        "",
      );
      for (let i = 0; i < dom.window.localStorage.length; i++)
        assert.doesNotMatch(
          dom.window.localStorage.getItem(dom.window.localStorage.key(i)!)!,
          /thumbnail|blob:|image\/jpeg/,
        );
    } finally {
      dom.window.close();
    }
  }
});
test("text deletion survives photo cleanup failure and retry removes the orphan", async () => {
  const dom = new JSDOM(
    '<div id="app"><li class="item" data-key="a"></li></div>',
  );
  setup(dom);
  const mock = new MockPhotos();
  await mock.put("a", null, photo, new AbortController().signal);
  const ui = installPhotoUI(dom.window.document.querySelector("#app")!, mock, {
    timeout: 30,
  });
  try {
    await tick();
    mock.fault = "offline";
    dom.window.document.querySelector(".item")!.remove();
    await tick();
    assert.equal(mock.records.size, 1);
    assert.equal(dom.window.document.querySelector(".item"), null);
    mock.fault = "healthy";
    await ui.retry();
    assert.equal(mock.records.size, 0);
  } finally {
    ui.close();
    dom.window.close();
  }
});

test("deleting a text row during a photo save aborts it without resurrecting either item", async () => {
  const dom = new JSDOM(
    '<div id="app"><li class="item" data-key="a"></li></div>',
  );
  const live = setup(dom);
  const bytes = await photo.full.arrayBuffer();
  const delayed = new Blob([bytes]);
  let release!: (bytes: ArrayBuffer) => void;
  Object.defineProperty(delayed, "arrayBuffer", {
    value: () =>
      new Promise<ArrayBuffer>((resolve) => {
        release = resolve;
      }),
  });
  const mock = new MockPhotos();
  const ui = installPhotoUI(dom.window.document.querySelector("#app")!, mock, {
    synthetic: async () => ({ ...photo, full: delayed }),
    timeout: 100,
  });
  try {
    await tick();
    click(dom, "Add photo");
    await tick();
    click(dom, "Try synthetic image");
    await tick();
    click(dom, "Save photo");
    await tick();
    assert.ok(mock.reserved > 0);
    dom.window.document.querySelector(".item")!.remove();
    await tick();
    release(bytes);
    await tick();
    assert.equal(mock.records.size, 0);
    assert.equal(mock.reserved, 0);
    assert.equal(mock.used, 0);
    assert.equal(live.size, 0);
    assert.equal(dom.window.document.querySelector("dialog"), null);
    assert.equal(dom.window.document.querySelector(".item"), null);
  } finally {
    ui.close();
    dom.window.close();
  }
});

test("a delayed stale refresh cannot remove a newly saved thumbnail", async () => {
  const dom = new JSDOM(
    '<div id="app"><li class="item" data-key="a"></li></div>',
  );
  setup(dom);
  const mock = new MockPhotos();
  let release!: () => void;
  let reads = 0;
  const originalGet = mock.get.bind(mock);
  mock.get = async (key, signal) => {
    if (++reads === 1)
      return new Promise((resolve) => {
        release = () => resolve(undefined);
      });
    return originalGet(key, signal);
  };
  const ui = installPhotoUI(dom.window.document.querySelector("#app")!, mock, {
    synthetic: async () => photo,
  });
  try {
    click(dom, "Add photo");
    await tick();
    click(dom, "Try synthetic image");
    await tick();
    click(dom, "Save photo");
    await tick();
    assert.ok(dom.window.document.querySelector(".photo-thumbnail"));
    release();
    await tick();
    assert.ok(dom.window.document.querySelector(".photo-thumbnail"));
  } finally {
    ui.close();
    dom.window.close();
  }
});
