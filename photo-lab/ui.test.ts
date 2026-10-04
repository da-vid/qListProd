import { applyWithPhotoCleanup } from "../src/photo/text-delete.ts";
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { JSDOM } from "jsdom";
import { type PreparedPhoto } from "../src/photo/adapter.ts";
import { MockPhotoGateway } from "../src/photo/gateway.ts";
import { inspectJpeg } from "../src/photo/jpeg.ts";
import { type NormalizedPhoto } from "../src/photo/normalize.ts";
import { installPhotoUI } from "../src/photo/ui.ts";
const outputs: PreparedPhoto = {
  full: new Blob([
    await readFile(new URL("./fixtures/clean-full.jpg", import.meta.url)),
  ]),
  thumbnail: new Blob([
    await readFile(new URL("./fixtures/clean-thumbnail.jpg", import.meta.url)),
  ]),
};
const photo: NormalizedPhoto = {
  jpeg: new Blob(
    [
      Uint8Array.from(
        inspectJpeg(new Uint8Array(await outputs.full.arrayBuffer())).sanitized,
      ),
    ],
    { type: "image/jpeg" },
  ),
  width: 1280,
  height: 960,
};
class MockPhotos extends MockPhotoGateway {
  constructor() {
    super(async () => outputs);
  }
}
const tick = () => new Promise((r) => setTimeout(r, 20));
function setup(dom: JSDOM) {
  const { window: w } = dom;
  Object.defineProperty(w.crypto, "randomUUID", {
    value: () => crypto.randomUUID(),
  });
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
  const b = buttons.find(
    (b) =>
      (b.getAttribute("aria-label") ?? b.textContent) === label && !b.hidden,
  )!;
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
      dom.window.document.querySelector<HTMLElement>("dialog h2")!.hidden,
      true,
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
  let resolve!: (p: NormalizedPhoto) => void;
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
      assert.equal(
        dom.window.document.querySelector(".photo-cleanup")!.textContent,
        "", // No observed photo revision: never invent an unversioned deletion hint.
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
  await mock.put(
    "a",
    null,
    { operationId: crypto.randomUUID(), jpeg: photo.jpeg },
    new AbortController().signal,
  );
  const ui = installPhotoUI(dom.window.document.querySelector("#app")!, mock, {
    timeout: 30,
  });
  try {
    await tick();
    mock.fault = "offline";
    await applyWithPhotoCleanup(
      dom.window.document.querySelector("#app")!,
      { type: "delete", key: "a" },
      async () => {
        dom.window.document.querySelector(".item")!.remove();
      },
    );
    await tick();
    assert.equal(mock.records.size, 1);
    assert.equal(dom.window.document.querySelector(".item"), null);
    mock.fault = "healthy";
    click(dom, "Retry photo cleanup");
    await tick();
    assert.equal(mock.records.size, 0);
    assert.match(
      dom.window.document.querySelector(".photo-cleanup")!.textContent!,
      /complete/,
    );
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
  const bytes = await photo.jpeg.arrayBuffer();
  const delayed = new Blob([bytes], { type: "image/jpeg" });
  let release!: (bytes: ArrayBuffer) => void;
  Object.defineProperty(delayed, "arrayBuffer", {
    value: () =>
      new Promise<ArrayBuffer>((resolve) => {
        release = resolve;
      }),
  });
  const mock = new MockPhotos();
  const ui = installPhotoUI(dom.window.document.querySelector("#app")!, mock, {
    synthetic: async () => ({ ...photo, jpeg: delayed }),
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

test("lost save response checks operation status and displays the current record without another upload", async () => {
  const dom = new JSDOM(
    '<div id="app"><li class="item" data-key="a"></li></div>',
  );
  setup(dom);
  const mock = new MockPhotos(),
    put = mock.put.bind(mock);
  let saves = 0;
  mock.put = async (...args) => {
    saves++;
    await put(...args);
    throw Error("response lost");
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
    assert.equal(saves, 1);
    assert.equal(mock.records.size, 1);
    assert(dom.window.document.querySelector(".photo-thumbnail"));
    assert.equal(dom.window.document.querySelector("dialog"), null);
  } finally {
    ui.close();
    dom.window.close();
  }
});

test("an initial photo read cannot replace a newly chosen preview or unsupported-file error", async () => {
  const dom = new JSDOM(
    '<div id="app"><li class="item" data-key="a"></li></div>',
  );
  setup(dom);
  const mock = new MockPhotos();
  let resolve!: (record: undefined) => void,
    reads = 0;
  const get = mock.get.bind(mock);
  mock.get = async (key, s) =>
    ++reads === 2 ? new Promise((r) => (resolve = r)) : get(key, s);
  const ui = installPhotoUI(dom.window.document.querySelector("#app")!, mock, {
    synthetic: async () => photo,
    prepare: async () => {
      throw Error("HEIC unsupported; choose JPEG");
    },
  });
  try {
    await tick();
    click(dom, "Add photo");
    await tick();
    const input = dom.window.document.querySelector<HTMLInputElement>(
      'dialog input[type="file"]',
    )!;
    Object.defineProperty(input, "files", {
      value: [
        new dom.window.File(["fake"], "photo.heic", { type: "image/heic" }),
      ],
    });
    input.dispatchEvent(new dom.window.Event("change"));
    await tick();
    resolve(undefined);
    await tick();
    assert.match(
      dom.window.document.querySelector('dialog [role="status"]')!.textContent!,
      /HEIC unsupported/,
    );
  } finally {
    ui.close();
    dom.window.close();
  }
});

test("preparation timeout aborts the normalizer and a new selection can recover", async () => {
  const dom = new JSDOM(
    '<div id="app"><li class="item" data-key="a"></li></div>',
  );
  const live = setup(dom),
    mock = new MockPhotos();
  let calls = 0,
    aborted = false;
  const ui = installPhotoUI(dom.window.document.querySelector("#app")!, mock, {
    timeout: 30,
    synthetic: async (signal) => {
      if (++calls > 1) return photo;
      return new Promise((_, reject) =>
        signal.addEventListener(
          "abort",
          () => {
            aborted = true;
            reject(signal.reason);
          },
          { once: true },
        ),
      );
    },
  });
  try {
    await tick();
    click(dom, "Add photo");
    await tick();
    click(dom, "Try synthetic image");
    await new Promise((r) => setTimeout(r, 60));
    assert(aborted);
    assert.equal(live.size, 0);
    assert.match(
      dom.window.document.querySelector('dialog [role="status"]')!.textContent!,
      /timed out/,
    );
    click(dom, "Try synthetic image");
    await tick();
    click(dom, "Save photo");
    await tick();
    assert.equal(mock.records.size, 1);
  } finally {
    ui.close();
    dom.window.close();
  }
});

test("photo cache reuses loaded bytes, refreshes remote revisions, and releases all URLs", async () => {
  const dom = new JSDOM(
    '<div id="app"><li class="item" data-key="a"></li></div>',
    { url: "http://localhost/CacheList" },
  );
  const live = setup(dom),
    mock = new MockPhotos();
  const first = await mock.put(
    "a",
    null,
    {
      operationId: crypto.randomUUID(),
      jpeg: photo.jpeg,
    },
    new AbortController().signal,
  );
  let reads = 0;
  const get = mock.get.bind(mock);
  mock.get = (...args) => {
    reads++;
    return get(...args);
  };
  const ui = installPhotoUI(dom.window.document.querySelector("#app")!, mock, {
    synthetic: async () => photo,
  });
  try {
    await tick();
    assert.equal(reads, 1);
    for (let i = 0; i < 3; i++) {
      click(dom, "Change photo");
      await tick();
      assert.equal(reads, 1);
      assert.equal(
        dom.window.document.querySelectorAll(".photo-controls button").length,
        1,
      );
      click(dom, "Expand photo");
      assert(dom.window.document.querySelector(".photo-lightbox"));
      const dialog = dom.window.document.querySelector("dialog")!;
      dialog.dispatchEvent(
        new dom.window.Event("cancel", { cancelable: true }),
      );
      await tick();
      assert.equal(dom.window.document.querySelector(".photo-lightbox"), null);
      assert(dialog.isConnected);
      click(dom, "Close");
      assert.equal(live.size, 1);
    }
    const clock = Date.now;
    try {
      Date.now = () => clock() + 61000;
      click(dom, "Change photo");
      await tick();
      assert.equal(reads, 2, "expired cache revalidates on open");
      click(dom, "Close");
    } finally {
      Date.now = clock;
    }
    const previousReads = reads;
    const replacement = await mock.put(
      "a",
      first.version,
      {
        operationId: crypto.randomUUID(),
        jpeg: photo.jpeg,
      },
      new AbortController().signal,
    );
    click(dom, "Change photo");
    click(dom, "Refresh photo");
    await tick();
    assert.equal(reads, previousReads + 1);
    click(dom, "Remove photo");
    await tick();
    assert.equal(
      mock.records.size,
      0,
      `refresh uses revision ${replacement.version}`,
    );
    assert.equal(live.size, 0);
    assert(dom.window.document.querySelector('[aria-label="Add photo"]'));
  } finally {
    ui.close();
    assert.equal(live.size, 0);
    dom.window.close();
  }
});

test("lightbox preserves a selected draft and stale cached writes cannot overwrite remote changes", async () => {
  const dom = new JSDOM(
    '<div id="app"><li class="item" data-key="a"></li></div>',
    { url: "http://localhost/DraftList" },
  );
  const live = setup(dom),
    mock = new MockPhotos();
  const first = await mock.put(
    "a",
    null,
    {
      operationId: crypto.randomUUID(),
      jpeg: photo.jpeg,
    },
    new AbortController().signal,
  );
  const ui = installPhotoUI(dom.window.document.querySelector("#app")!, mock, {
    synthetic: async () => photo,
  });
  try {
    await tick();
    click(dom, "Change photo");
    click(dom, "Try synthetic image");
    await tick();
    const src =
      dom.window.document.querySelector<HTMLImageElement>("dialog img")!.src;
    click(dom, "Expand photo");
    click(dom, "Return to photo controls");
    await tick();
    assert.equal(
      dom.window.document.querySelector<HTMLImageElement>("dialog img")!.src,
      src,
    );
    const remote = await mock.put(
      "a",
      first.version,
      {
        operationId: crypto.randomUUID(),
        jpeg: photo.jpeg,
      },
      new AbortController().signal,
    );
    click(dom, "Save photo");
    await tick();
    assert.equal(mock.records.get("a")!.version, remote.version);
    assert(dom.window.document.querySelector("dialog"));
    click(dom, "Close");
    click(dom, "Change photo");
    await tick();
    click(dom, "Remove photo");
    await tick();
    assert.equal(mock.records.size, 0);
  } finally {
    ui.close();
    assert.equal(live.size, 0);
    dom.window.close();
  }
});

test("late stale-cache revalidation cannot rebase a selected or reselected draft or removal", async () => {
  const dom = new JSDOM(
    '<div id="app"><li class="item" data-key="a"></li></div>',
    { url: "http://localhost/RevalidationRace" },
  );
  const live = setup(dom),
    mock = new MockPhotos(),
    signal = new AbortController().signal;
  const put = mock.put.bind(mock),
    get = mock.get.bind(mock),
    remove = mock.remove.bind(mock);
  const upload = () => ({ operationId: crypto.randomUUID(), jpeg: photo.jpeg });
  const first = await put("a", null, upload(), signal);
  const expectedSaves: (number | null)[] = [],
    expectedRemovals: number[] = [];
  mock.put = (...args) => {
    expectedSaves.push(args[1]);
    return put(...args);
  };
  mock.remove = (...args) => {
    expectedRemovals.push(args[1]);
    return remove(...args);
  };
  let reads = 0,
    release!: (p: typeof first) => void;
  mock.get = (...args) =>
    ++reads === 2
      ? new Promise((r) => {
          release = r;
        })
      : get(...args);
  const ui = installPhotoUI(dom.window.document.querySelector("#app")!, mock, {
    synthetic: async () => photo,
  });
  const clock = Date.now;
  try {
    await tick();
    Date.now = () => clock() + 61000;
    click(dom, "Change photo");
    Date.now = clock;
    assert.equal(reads, 2, "stale open has an outstanding automatic read");
    const remote = await put("a", first.version, upload(), signal);
    click(dom, "Try synthetic image");
    await tick();
    const src =
      dom.window.document.querySelector<HTMLImageElement>("dialog img")!.src;
    release(remote);
    await tick();
    assert.equal(
      dom.window.document.querySelector<HTMLImageElement>("dialog img")!.src,
      src,
    );
    click(dom, "Save photo");
    await tick();
    assert.deepEqual(
      expectedSaves,
      [first.version],
      "draft must retain v1, not silently adopt v2",
    );
    assert.equal(
      mock.records.get("a")!.version,
      remote.version,
      "unseen remote edit survives",
    );
    assert.match(
      dom.window.document.querySelector('dialog [role="status"]')!.textContent!,
      /changed/,
    );
    click(dom, "Try synthetic image");
    await tick();
    click(dom, "Save photo");
    await tick();
    assert.deepEqual(
      expectedSaves,
      [first.version, first.version],
      "reselecting does not rebase the open dialog",
    );
    click(dom, "Remove photo");
    await tick();
    assert.deepEqual(expectedRemovals, [first.version]);
    assert.equal(mock.records.get("a")!.version, remote.version);
    click(dom, "Close");
    assert.equal(live.size, 1);
    click(dom, "Change photo");
    await tick();
    assert.equal(reads, 3, "a conflict expires the row cache before reopening");
    click(dom, "Try synthetic image");
    await tick();
    click(dom, "Save photo");
    await tick();
    assert.deepEqual(expectedSaves, [
      first.version,
      first.version,
      remote.version,
    ]);
    assert(
      mock.records.get("a")!.version > remote.version,
      "explicit reopening permits a new draft based on the displayed remote revision",
    );
  } finally {
    Date.now = clock;
    ui.close();
    assert.equal(live.size, 0);
    dom.window.close();
  }
});

test("closing a stale cached dialog discards its draft and late read before reopening", async () => {
  const dom = new JSDOM(
    '<div id="app"><li class="item" data-key="a"></li></div>',
    { url: "http://localhost/CancelledRevalidation" },
  );
  const live = setup(dom),
    mock = new MockPhotos(),
    signal = new AbortController().signal;
  const put = mock.put.bind(mock),
    get = mock.get.bind(mock);
  const upload = () => ({ operationId: crypto.randomUUID(), jpeg: photo.jpeg });
  const first = await put("a", null, upload(), signal);
  let reads = 0,
    release!: (p: typeof first) => void;
  mock.get = (...args) =>
    ++reads === 2
      ? new Promise((r) => {
          release = r;
        })
      : get(...args);
  const ui = installPhotoUI(dom.window.document.querySelector("#app")!, mock, {
    synthetic: async () => photo,
  });
  const clock = Date.now;
  try {
    await tick();
    Date.now = () => clock() + 61000;
    click(dom, "Change photo");
    const remote = await put("a", first.version, upload(), signal);
    click(dom, "Try synthetic image");
    await tick();
    click(dom, "Close");
    assert.equal(live.size, 1);
    click(dom, "Change photo");
    await tick();
    assert.equal(reads, 3);
    const src =
      dom.window.document.querySelector<HTMLImageElement>("dialog img")!.src;
    release(first);
    await tick();
    assert.equal(
      dom.window.document.querySelector<HTMLImageElement>("dialog img")!.src,
      src,
      "aborted old response cannot replace the reopened preview",
    );
    click(dom, "Remove photo");
    await tick();
    assert.equal(
      mock.records.size,
      0,
      `reopening displayed and removed v${remote.version}`,
    );
  } finally {
    Date.now = clock;
    ui.close();
    assert.equal(live.size, 0);
    dom.window.close();
  }
});

test("background revalidation does not change removal's displayed revision while a mutation is pending", async () => {
  const dom = new JSDOM(
    '<div id="app"><li class="item" data-key="a"></li></div>',
    { url: "http://localhost/RemoveRevalidation" },
  );
  const live = setup(dom),
    mock = new MockPhotos(),
    signal = new AbortController().signal;
  const put = mock.put.bind(mock),
    get = mock.get.bind(mock),
    remove = mock.remove.bind(mock);
  const upload = () => ({ operationId: crypto.randomUUID(), jpeg: photo.jpeg });
  const first = await put("a", null, upload(), signal);
  let reads = 0,
    release!: (p: typeof first) => void,
    rejectRemoval!: (e: Error) => void;
  const expected: number[] = [];
  mock.get = (...args) =>
    ++reads === 2
      ? new Promise((r) => {
          release = r;
        })
      : get(...args);
  mock.remove = (...args) => {
    expected.push(args[1]);
    return expected.length === 1
      ? new Promise((_r, reject) => {
          rejectRemoval = reject;
        })
      : remove(...args);
  };
  const ui = installPhotoUI(dom.window.document.querySelector("#app")!, mock);
  const clock = Date.now;
  try {
    await tick();
    Date.now = () => clock() + 61000;
    click(dom, "Change photo");
    Date.now = clock;
    const src =
      dom.window.document.querySelector<HTMLImageElement>("dialog img")!.src;
    const remote = await put("a", first.version, upload(), signal);
    click(dom, "Remove photo");
    release(remote);
    await tick();
    assert.equal(
      dom.window.document.querySelector<HTMLImageElement>("dialog img")!.src,
      src,
    );
    rejectRemoval(Error("This photo changed. Reopen it before removing."));
    await tick();
    click(dom, "Remove photo");
    await tick();
    assert.deepEqual(expected, [first.version, first.version]);
    assert.equal(mock.records.get("a")!.version, remote.version);
    click(dom, "Close");
    click(dom, "Change photo");
    await tick();
    click(dom, "Remove photo");
    await tick();
    assert.deepEqual(expected, [first.version, first.version, remote.version]);
    assert.equal(mock.records.size, 0);
  } finally {
    Date.now = clock;
    ui.close();
    assert.equal(live.size, 0);
    dom.window.close();
  }
});

test("a failed draft write invalidates an older pending read instead of marking stale bytes fresh", async () => {
  const dom = new JSDOM(
    '<div id="app"><li class="item" data-key="a"></li></div>',
    { url: "http://localhost/InvalidatedRevalidation" },
  );
  const live = setup(dom),
    mock = new MockPhotos(),
    signal = new AbortController().signal;
  const put = mock.put.bind(mock),
    get = mock.get.bind(mock);
  const upload = () => ({ operationId: crypto.randomUUID(), jpeg: photo.jpeg });
  const first = await put("a", null, upload(), signal);
  let reads = 0,
    release!: (p: typeof first) => void;
  mock.get = (...args) =>
    ++reads === 2
      ? new Promise((r) => {
          release = r;
        })
      : get(...args);
  const ui = installPhotoUI(dom.window.document.querySelector("#app")!, mock, {
    synthetic: async () => photo,
  });
  const clock = Date.now;
  try {
    await tick();
    Date.now = () => clock() + 61000;
    click(dom, "Change photo");
    Date.now = clock;
    const remote = await put("a", first.version, upload(), signal);
    click(dom, "Try synthetic image");
    await tick();
    click(dom, "Save photo");
    await tick();
    assert.equal(mock.records.get("a")!.version, remote.version);
    assert.match(
      dom.window.document.querySelector('dialog [role="status"]')!.textContent!,
      /changed/,
    );
    release(first);
    await tick();
    click(dom, "Close");
    click(dom, "Change photo");
    await tick();
    assert.equal(
      reads,
      3,
      "late pre-conflict read must not make the expired cache fresh",
    );
    click(dom, "Remove photo");
    await tick();
    assert.equal(
      mock.records.size,
      0,
      "reopening fetched the actual remote revision",
    );
  } finally {
    Date.now = clock;
    ui.close();
    assert.equal(live.size, 0);
    dom.window.close();
  }
});

test("visible cleanup retry survives reopen, deduplicates attempts and preserves newer photos", async () => {
  const dom = new JSDOM(
    '<div id="app"><li class="item" data-key="a"></li></div>',
  );
  setup(dom);
  const { cleanupJournal } = await import("../src/photo/cleanup-journal.ts");
  const memory = new Map<string, string>();
  const journal = cleanupJournal(
    {
      get length() {
        return memory.size;
      },
      key: (i) => [...memory.keys()][i] ?? null,
      getItem: (k) => memory.get(k) ?? null,
      setItem: (k, v) => {
        memory.set(k, v);
      },
      removeItem: (k) => {
        memory.delete(k);
      },
    },
    "Synthetic",
  );
  const mock = new MockPhotos();
  const signal = new AbortController().signal;
  const first = await mock.put(
    "a",
    null,
    { operationId: crypto.randomUUID(), jpeg: photo.jpeg },
    signal,
  );
  const root = dom.window.document.querySelector<HTMLElement>("#app")!;
  let ui = installPhotoUI(root, mock, {
    cleanupJournal: journal,
    timeout: 500,
  });
  try {
    await tick();
    mock.fault = "offline";
    await applyWithPhotoCleanup(
      root,
      { type: "delete", key: "a" },
      async () => {
        root.querySelector(".item")!.remove();
      },
    );
    await tick();
    assert.deepEqual(journal.load(), [{ key: "a", version: first.version }]);
    ui.close();
    ui = installPhotoUI(root, mock, { cleanupJournal: journal, timeout: 500 });
    assert.match(root.querySelector(".photo-cleanup")!.textContent!, /waiting/);
    mock.fault = "healthy";
    const newer = await mock.put(
      "a",
      first.version,
      { operationId: crypto.randomUUID(), jpeg: photo.jpeg },
      signal,
    );
    const remove = mock.remove.bind(mock);
    let calls = 0,
      release!: () => void;
    mock.remove = async (key, expected, s) => {
      calls++;
      await new Promise<void>((r) => {
        release = r;
      });
      return remove(key, expected, s);
    };
    const retry = click(dom, "Retry photo cleanup");
    retry.click();
    const concurrent = ui.retry();
    await tick();
    assert.equal(calls, 1);
    assert.equal(retry.disabled, true);
    release();
    await concurrent;
    assert.equal(mock.records.get("a")!.version, newer.version);
    assert.deepEqual(journal.load(), [{ key: "a", version: first.version }]);
    assert.equal(retry.disabled, false);
    assert.match(root.querySelector(".photo-cleanup")!.textContent!, /waiting/);
    assert.equal(root.querySelector(".item"), null);
  } finally {
    ui.close();
    dom.window.close();
  }
});

for (const failure of ["load", "add", "remove"] as const) {
  test(`multi-entry cleanup retains unresolved journal ${failure} errors until that operation recovers`, async () => {
    const dom = new JSDOM(
      '<div id="app"><li class="item" data-key="a"></li><li class="item" data-key="b"></li></div>',
    );
    setup(dom);
    const root = dom.window.document.querySelector<HTMLElement>("#app")!;
    const mock = new MockPhotos();
    const signal = new AbortController().signal;
    for (const key of ["a", "b"])
      await mock.put(
        key,
        null,
        { operationId: crypto.randomUUID(), jpeg: photo.jpeg },
        signal,
      );
    const memory = new Map<string, { key: string; version: number }>();
    let failing = true;
    const removalCalls: string[] = [];
    const remove = mock.remove.bind(mock);
    mock.remove = async (key, version, s) => {
      removalCalls.push(key);
      if (failing && failure === "add" && key === "a")
        throw new Error("Synthetic gateway failure");
      return remove(key, version, s);
    };
    const journal = {
      load() {
        if (failing && failure === "load")
          throw new Error("Synthetic journal load failure");
        return [...memory.values()];
      },
      add(intent: { key: string; version: number }) {
        if (failing && failure === "add" && intent.key === "a")
          throw new Error("Synthetic journal add failure");
        memory.set(intent.key, intent);
      },
      remove(intent: { key: string; version: number }) {
        if (failing && failure === "remove" && intent.key === "a")
          throw new Error("Synthetic journal remove failure");
        memory.delete(intent.key);
      },
    };
    const ui = installPhotoUI(root, mock, { cleanupJournal: journal });
    try {
      await tick();
      mock.fault = "offline";
      for (const key of ["a", "b"])
        await applyWithPhotoCleanup(root, { type: "delete", key }, async () => {
          root.querySelector(`[data-key="${key}"]`)!.remove();
        });
      await tick();
      mock.fault = "healthy";
      await ui.retry();
      assert.equal(mock.records.size, failure === "add" ? 1 : 0);
      removalCalls.length = 0;
      const message = root.querySelector(".photo-cleanup")!;
      assert.match(
        message.textContent!,
        /retry data could not be saved or restored/,
      );
      assert.doesNotMatch(message.textContent!, /cleanup complete/);
      const retry = [
        ...root.querySelectorAll<HTMLButtonElement>("button"),
      ].find((b) => b.textContent === "Retry photo cleanup")!;
      assert.equal(retry.hidden, false);
      // Successful work on b must not clear a's failed remove, or the earlier failed load.
      await ui.retry();
      assert.match(
        message.textContent!,
        /retry data could not be saved or restored/,
      );
      assert.doesNotMatch(message.textContent!, /cleanup complete/);
      failing = false;
      await ui.retry();
      assert.equal(memory.size, 0);
      assert.equal(message.textContent, "Photo cleanup complete.");
      assert.equal(retry.hidden, true);
      assert.equal(mock.records.size, 0);
      if (failure === "remove")
        assert.deepEqual(
          removalCalls,
          [],
          "failed local journal removal must not resend completed gateway deletion",
        );
    } finally {
      ui.close();
      dom.window.close();
    }
  });
}
