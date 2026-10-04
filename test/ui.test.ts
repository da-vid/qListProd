import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { JSDOM } from "jsdom";
import { legacyFixtures } from "./fixtures/legacy-lists.ts";
const tick = () => new Promise((r) => setTimeout(r, 20));
async function ui(
  url = "https://preview.example/AbC234",
  saved: [string, string][] = [],
) {
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
  Object.defineProperty(dom.window.navigator, "clipboard", {
    value: { writeText: async () => {} },
  });
  for (const [key, value] of saved) dom.window.localStorage.setItem(key, value);
  const file = (await readdir("dist/assets")).find((x) => x.endsWith(".js"))!;
  dom.window.eval(await readFile(`dist/assets/${file}`, "utf8"));
  await tick();
  return dom;
}
function change(dom: JSDOM, selector: string, value: string) {
  const input = dom.window.document.querySelector(selector) as HTMLInputElement;
  input.value = value;
  input.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
}
function submit(dom: JSDOM, name: string) {
  (dom.window.document.querySelector(".add input") as HTMLInputElement).value =
    name;
  dom.window.document
    .querySelector("form")!
    .dispatchEvent(
      new dom.window.Event("submit", { bubbles: true, cancelable: true }),
    );
}
test("built UI adds, edits, checks, orders, deletes and preserves focus", async () => {
  const dom = await ui();
  try {
    const d = dom.window.document;
    submit(dom, "Apples");
    submit(dom, "Milk");
    await tick();
    assert.equal(d.querySelectorAll(".item").length, 2);
    change(dom, ".title", "Shopping");
    change(dom, ".item .name", "Green apples");
    const name = d.querySelector(".item .name") as HTMLInputElement;
    name.focus();
    const check = d.querySelector(
      ".item input[type=checkbox]",
    ) as HTMLInputElement;
    check.checked = true;
    check.dispatchEvent(new dom.window.Event("change"));
    await tick();
    assert.equal(d.activeElement, name);
    assert.ok(d.querySelector(".item.done"));
    const handle = d.querySelector(
      '[aria-label="Reorder Milk"]',
    ) as HTMLButtonElement;
    handle.focus();
    handle.dispatchEvent(
      new dom.window.KeyboardEvent("keydown", {
        key: "ArrowUp",
        bubbles: true,
      }),
    );
    await tick();
    assert.equal(
      (d.querySelector(".item .name") as HTMLInputElement).value,
      "Milk",
    );
    assert.equal(d.activeElement, handle);
    const remove = d.querySelector(
      '[aria-label="Delete Milk"]',
    ) as HTMLButtonElement;
    assert.equal(remove.hidden, true);
    assert.equal(remove.disabled, true);
    remove.click();
    await tick();
    assert.equal(d.querySelectorAll(".item").length, 2);
    const milkCheck = d.querySelector(
      '[aria-label="Complete Milk"]',
    ) as HTMLInputElement;
    milkCheck.checked = true;
    milkCheck.dispatchEvent(new dom.window.Event("change"));
    await tick();
    assert.equal(remove.hidden, false);
    assert.equal(remove.disabled, false);
    remove.click();
    await tick();
    assert.equal(d.querySelectorAll(".item").length, 1);
    assert.match(d.title, /Shopping/);
    assert.equal(
      d.querySelector(".status")!.textContent,
      "Saved on this device",
    );
  } finally {
    dom.window.close();
  }
});
test("share explains preview limits and completed removal requires confirmation", async () => {
  const dom = await ui();
  try {
    const d = dom.window.document;
    submit(dom, "One");
    await tick();
    const check = d.querySelector("[type=checkbox]") as HTMLInputElement;
    check.checked = true;
    check.dispatchEvent(new dom.window.Event("change"));
    await tick();
    (d.querySelector(".clear-slot button") as HTMLButtonElement).click();
    assert.ok(d.querySelector("dialog[open]"));
    assert.equal(d.querySelectorAll(".item").length, 1);
    (d.querySelector("dialog .primary") as HTMLButtonElement).click();
    await tick();
    assert.equal(d.querySelectorAll(".item").length, 0);
    (d.querySelector("nav .primary") as HTMLButtonElement).click();
    assert.match(d.querySelector("dialog")!.textContent!, /will not share/);
    assert.equal(
      (d.querySelector("dialog input") as HTMLInputElement).value,
      "https://preview.example/AbC234",
    );
  } finally {
    dom.window.close();
  }
});
test("production origin refuses persistence and hosted bundle excludes Firebase endpoints", async () => {
  const dom = await ui("https://www.qlist.cc/AbC234");
  try {
    assert.match(
      dom.window.document.querySelector(".error")!.textContent!,
      /cannot run/,
    );
    assert.equal(
      (dom.window.document.querySelector(".add button") as HTMLButtonElement)
        .disabled,
      true,
    );
    const file = (await readdir("dist/assets")).find((x) => x.endsWith(".js"))!;
    const js = await readFile(`dist/assets/${file}`, "utf8");
    assert.doesNotMatch(js, /firebaseio|qwiklist|google-analytics|AngularJS/);
    assert.ok(js.length < 65000);
  } finally {
    dom.window.close();
  }
});

test("pasted title and item values save on input/blur and survive reopening", async () => {
  const dom = await ui();
  try {
    submit(dom, "Original item");
    change(dom, ".title", "Keyboard title");
    await tick();
    const title = dom.window.document.querySelector(
      ".title",
    ) as HTMLInputElement;
    title.focus();
    title.value = "Pasted QA title";
    title.dispatchEvent(
      new dom.window.InputEvent("input", {
        bubbles: true,
        inputType: "insertFromPaste",
        data: "Pasted QA title",
      }),
    );
    assert.equal(
      dom.window.document.querySelector(".status")!.textContent,
      "Editing…",
    );
    title.blur();
    const item = dom.window.document.querySelector(
      ".item .name",
    ) as HTMLInputElement;
    item.focus();
    item.value = "Alpha pasted update";
    // Also covers clipboard/autofill implementations with no input/change event.
    item.blur();
    await tick();
    assert.match(dom.window.document.title, /Pasted QA title/);
    assert.ok(
      dom.window.document.querySelector(
        '[aria-label="Edit Alpha pasted update"]',
      ),
    );
    const storage = dom.window.localStorage;
    const saved = Array.from({ length: storage.length }, (_, i) => {
      const key = storage.key(i)!;
      return [key, storage.getItem(key)!] as [string, string];
    });
    const reopened = await ui(undefined, saved);
    try {
      assert.equal(
        (reopened.window.document.querySelector(".title") as HTMLInputElement)
          .value,
        "Pasted QA title",
      );
      assert.equal(
        (
          reopened.window.document.querySelector(
            ".item .name",
          ) as HTMLInputElement
        ).value,
        "Alpha pasted update",
      );
    } finally {
      reopened.window.close();
    }
  } finally {
    dom.window.close();
  }
});

test("dialogs have accessible names and copy confirmation stays inside the dialog", async () => {
  const dom = await ui();
  try {
    const d = dom.window.document;
    (d.querySelector("nav .primary") as HTMLButtonElement).click();
    const dialog = d.querySelector("dialog")!;
    assert.equal(dialog.getAttribute("aria-labelledby"), "dialog-title");
    assert.equal(
      d.getElementById("dialog-title")!.textContent,
      "share your list",
    );
    assert.equal(dialog.getAttribute("aria-describedby"), "dialog-description");
    (dialog.querySelector(".primary") as HTMLButtonElement).click();
    await tick();
    assert.equal(
      dialog.querySelector('[role="status"]')!.textContent,
      "Link copied",
    );
  } finally {
    dom.window.close();
  }
});

test("discarding an invalid item edit restores the persisted visible value", async () => {
  const dom = await ui();
  try {
    const d = dom.window.document;
    submit(dom, "Keep this item");
    await tick();
    const input = d.querySelector(".item .name") as HTMLInputElement;
    input.focus();
    input.value = "";
    input.dispatchEvent(
      new dom.window.InputEvent("input", {
        bubbles: true,
        inputType: "deleteContentBackward",
      }),
    );
    input.blur();
    await tick();
    assert.equal((d.querySelector(".error") as HTMLElement).hidden, false);
    (d.querySelector(".error .text-button") as HTMLButtonElement).click();
    assert.equal(input.value, "Keep this item");
    assert.equal((d.querySelector(".error") as HTMLElement).hidden, true);
    assert.equal(
      d.querySelector(".status")!.textContent,
      "Saved on this device",
    );
    await new Promise((r) => setTimeout(r, 350));
    assert.equal(input.value, "Keep this item");
  } finally {
    dom.window.close();
  }
});

test("unknown custom URL opens an empty independent list and persists on edit", async () => {
  const dom = await ui(
    "https://preview.example/Family%20notes?ignored=query#not-an-id",
  );
  try {
    assert.equal(dom.window.location.pathname, "/Family%20notes");
    assert.equal(dom.window.location.search, "");
    assert.equal(dom.window.location.hash, "");
    assert.equal(dom.window.document.querySelectorAll(".item").length, 0);
    submit(dom, "New custom item");
    await tick();
    const storage = dom.window.localStorage;
    const saved = Array.from({ length: storage.length }, (_, i) => {
      const key = storage.key(i)!;
      return [key, storage.getItem(key)!] as [string, string];
    });
    const reopened = await ui("https://preview.example/Family%20notes", saved);
    try {
      assert.equal(
        (
          reopened.window.document.querySelector(
            ".item .name",
          ) as HTMLInputElement
        ).value,
        "New custom item",
      );
    } finally {
      reopened.window.close();
    }
  } finally {
    dom.window.close();
  }
});

test("keyboard Home/End ordering persists and unchecking hides deletion again", async () => {
  const dom = await ui();
  try {
    const d = dom.window.document;
    for (const name of ["First", "Middle", "Last"]) {
      submit(dom, name);
      await tick();
    }
    const handle = d.querySelector(
      '[aria-label="Reorder Last"]',
    ) as HTMLButtonElement;
    handle.dispatchEvent(
      new dom.window.KeyboardEvent("keydown", { key: "Home", bubbles: true }),
    );
    await tick();
    const names = () =>
      [...d.querySelectorAll<HTMLInputElement>(".item .name")].map(
        (x) => x.value,
      );
    assert.deepEqual(names(), ["Last", "First", "Middle"]);
    assert.match(d.querySelector("#reorder-help")!.textContent!, /arrow keys/);
    handle.dispatchEvent(
      new dom.window.KeyboardEvent("keydown", { key: "End", bubbles: true }),
    );
    await tick();
    assert.deepEqual(names(), ["First", "Middle", "Last"]);
    const check = d.querySelector(
      '[aria-label="Complete Last"]',
    ) as HTMLInputElement;
    const remove = d.querySelector(
      '[aria-label="Delete Last"]',
    ) as HTMLButtonElement;
    for (const checked of [true, false]) {
      check.checked = checked;
      check.dispatchEvent(new dom.window.Event("change"));
      await tick();
      assert.equal(remove.hidden, !checked);
      assert.equal(remove.disabled, !checked);
    }
    // Persist a non-original order to distinguish restoration from original insertion order.
    handle.dispatchEvent(
      new dom.window.KeyboardEvent("keydown", { key: "Home", bubbles: true }),
    );
    await tick();
    const storage = dom.window.localStorage;
    const saved = Array.from({ length: storage.length }, (_, i) => {
      const key = storage.key(i)!;
      return [key, storage.getItem(key)!] as [string, string];
    });
    const reopened = await ui(undefined, saved);
    try {
      assert.deepEqual(
        [
          ...reopened.window.document.querySelectorAll<HTMLInputElement>(
            ".item .name",
          ),
        ].map((x) => x.value),
        ["Last", "First", "Middle"],
      );
    } finally {
      reopened.window.close();
    }
  } finally {
    dom.window.close();
  }
});

test("sticky clear action follows current checks, sits below input, and returns hidden focus safely", async () => {
  const dom = await ui();
  try {
    const d = dom.window.document;
    const sticky = d.querySelector(".sticky-top")!;
    const controls = sticky.querySelector(".list-controls")!;
    const slot = controls.querySelector<HTMLElement>(".clear-slot")!;
    const clear = slot.querySelector("button")!;
    assert.ok(sticky.querySelector("header nav"));
    assert.ok(controls.querySelector(".title"));
    assert.equal(controls.querySelector(".add")!.nextElementSibling, slot);
    assert.equal(clear.textContent, "Clear all checked");
    assert.equal(clear.disabled, true);
    assert.equal(slot.getAttribute("aria-hidden"), "true");
    assert.equal(slot.inert, true);
    assert.equal(d.querySelector(".bottom button"), null);
    submit(dom, "Keep until checked");
    await tick();
    const check = d.querySelector<HTMLInputElement>("[type=checkbox]")!;
    check.checked = true;
    check.dispatchEvent(new dom.window.Event("change"));
    await tick();
    assert.equal(slot.classList.contains("available"), true);
    assert.equal(clear.disabled, false);
    assert.equal(slot.inert, false);
    clear.focus();
    // Simulate the current item becoming unchecked without moving focus first.
    check.checked = false;
    check.dispatchEvent(new dom.window.Event("change"));
    await tick();
    assert.equal(slot.classList.contains("available"), false);
    assert.equal(slot.inert, true);
    assert.equal(clear.disabled, true);
    assert.equal(d.activeElement, d.querySelector(".add input"));
    assert.equal(d.querySelectorAll(".item").length, 1);
  } finally {
    dom.window.close();
  }
});

test("clear confirmation uses singular and plural checked-item counts", async () => {
  const dom = await ui();
  try {
    const d = dom.window.document;
    for (const count of [1, 2]) {
      submit(dom, `Item ${count}`);
      await tick();
      const check = d.querySelector(
        `[aria-label="Complete Item ${count}"]`,
      ) as HTMLInputElement;
      check.checked = true;
      check.dispatchEvent(new dom.window.Event("change"));
      await tick();
      (d.querySelector(".clear-slot button") as HTMLButtonElement).click();
      assert.equal(
        d.querySelector("#dialog-description")!.textContent,
        count === 1
          ? "1 checked item will be removed."
          : "2 checked items will be removed.",
      );
      (d.querySelector("dialog .btn") as HTMLButtonElement).click();
    }
  } finally {
    dom.window.close();
  }
});

test("built UI displays legacy priority fixtures exactly and appends below string priorities", async () => {
  for (const fixture of legacyFixtures) {
    const saved = fixture.items.map((item, i) => {
      const stamp = String(i).padStart(16, "0") + "-fixture";
      return [
        `qlist:modern:v1:AbC234:${stamp}`,
        JSON.stringify({ stamp, change: { type: "add", item } }),
      ] as [string, string];
    });
    const dom = await ui(undefined, saved);
    try {
      const d = dom.window.document;
      const keys = () =>
        [...d.querySelectorAll<HTMLElement>(".list .item")].map(
          (x) => x.dataset.key,
        );
      assert.deepEqual(keys(), fixture.expected, fixture.name);
      submit(dom, "Appended after legacy items");
      await tick();
      assert.deepEqual(keys().slice(0, -1), fixture.expected, fixture.name);
      assert.equal(
        d.querySelector<HTMLInputElement>(".list .item:last-child .name")!
          .value,
        "Appended after legacy items",
      );
    } finally {
      dom.window.close();
    }
  }
});

test("About & Privacy is optional, dismissible and returns focus without recording acceptance", async () => {
  const dom = await ui();
  try {
    const d = dom.window.document;
    const link = d.querySelector<HTMLAnchorElement>("footer .about-link")!;
    const notice = d.querySelector<HTMLDialogElement>(".about-dialog")!;
    assert(link);
    assert.equal(notice.open, false);
    const stored = JSON.stringify(dom.window.localStorage);
    const cookie = d.cookie;
    link.focus();
    link.click();
    assert.equal(notice.open, true);
    assert.equal(notice.getAttribute("aria-labelledby"), "about-heading");
    assert.equal(d.activeElement, d.getElementById("about-heading"));
    assert.equal(notice.querySelectorAll("input,form").length, 0);
    assert.deepEqual(
      [...notice.querySelectorAll("button")].map((b) => b.textContent),
      ["Close"],
    );
    assert.match(notice.textContent!, /Effective October 3, 2026/);
    assert.match(notice.textContent!, /Older copies may remain in backups\./);
    assert.match(notice.textContent!, /Do Not Track or Global Privacy Control/);
    notice.querySelector<HTMLButtonElement>("button")!.click();
    assert.equal(notice.open, false);
    assert.equal(d.activeElement, link);
    link.click();
    // Native dialogs dispatch cancel when Escape is pressed; JSDOM needs the event.
    notice.dispatchEvent(new dom.window.Event("cancel", { cancelable: true }));
    assert.equal(notice.open, false);
    assert.equal(d.activeElement, link);
    assert.equal(JSON.stringify(dom.window.localStorage), stored);
    assert.equal(d.cookie, cookie);
    assert.equal(
      (d.querySelector(".add button") as HTMLButtonElement).disabled,
      false,
    );
  } finally {
    dom.window.close();
  }
});

test("new-item drafts have honest feedback, navigation protection and composition-safe submission", async () => {
  const dom = await ui();
  try {
    const d = dom.window.document;
    const input = d.querySelector<HTMLInputElement>('[aria-label="New item"]')!;
    const unload = () => {
      const e = new dom.window.Event("beforeunload", { cancelable: true });
      dom.window.dispatchEvent(e);
      return e.defaultPrevented;
    };
    const type = (text: string) => {
      input.value = text;
      input.dispatchEvent(
        new dom.window.InputEvent("input", {
          bubbles: true,
          inputType: "insertFromPaste",
        }),
      );
    };
    type("   ");
    assert.equal(unload(), false);
    type("Synthetic draft 🍎");
    assert.match(
      d.querySelector(".status")!.textContent!,
      /Draft item.*Enter or Add/,
    );
    assert.equal(unload(), true);
    (d.querySelector("nav button") as HTMLButtonElement).click();
    assert.match(
      d.querySelector("dialog[open]")!.textContent!,
      /hasn.t been added/,
    );
    assert.match(
      d.querySelector("dialog[open]")!.textContent!,
      /Discard draft and create/,
    );
    const stay = [
      ...d.querySelectorAll<HTMLButtonElement>("dialog button"),
    ].find((b) => b.textContent === "Stay")!;
    stay.click();
    assert.equal(input.value, "Synthetic draft 🍎");
    assert.equal(d.querySelectorAll(".item").length, 0);
    input.dispatchEvent(new dom.window.CompositionEvent("compositionstart"));
    submit(dom, "Synthetic draft 🍎");
    assert.equal(d.querySelectorAll(".item").length, 0);
    assert.equal(input.value, "Synthetic draft 🍎");
    input.dispatchEvent(new dom.window.CompositionEvent("compositionend"));
    d.querySelector("form")!.dispatchEvent(
      new dom.window.Event("submit", { cancelable: true }),
    );
    d.querySelector("form")!.dispatchEvent(
      new dom.window.Event("submit", { cancelable: true }),
    );
    await tick();
    assert.equal(d.querySelectorAll(".item").length, 1);
    assert.equal(input.value, "");
    assert.equal(d.activeElement, input);
    assert.equal(unload(), false);
  } finally {
    dom.window.close();
  }
});

test("failed new-item save retains exact retry content and blocks new-list navigation", async () => {
  const dom = await ui();
  try {
    const d = dom.window.document;
    const original = dom.window.Storage.prototype.setItem;
    dom.window.Storage.prototype.setItem = () => {
      throw new Error("Synthetic storage failure");
    };
    submit(dom, "Retained synthetic item");
    await tick();
    assert.match(
      d.querySelector(".status")!.textContent!,
      /Changes need attention/,
    );
    (d.querySelector("nav button") as HTMLButtonElement).click();
    assert.match(
      d.querySelector("dialog[open]")!.textContent!,
      /haven.t saved/,
    );
    assert.equal(
      [...d.querySelectorAll("dialog button")].some((b) =>
        /Create list|Discard/.test(b.textContent!),
      ),
      false,
    );
    (d.querySelector("dialog button") as HTMLButtonElement).click();
    dom.window.Storage.prototype.setItem = original;
    (d.querySelector(".error button") as HTMLButtonElement).click();
    await tick();
    assert.equal(d.querySelectorAll(".item").length, 1);
    assert.equal(
      d.querySelector<HTMLTextAreaElement>(".item .name")!.value,
      "Retained synthetic item",
    );
  } finally {
    dom.window.close();
  }
});
