import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { JSDOM } from "jsdom";
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
    (
      d.querySelector('[aria-label="Move Milk up"]') as HTMLButtonElement
    ).click();
    await tick();
    assert.equal(
      (d.querySelector(".item .name") as HTMLInputElement).value,
      "Milk",
    );
    (
      d.querySelector('[aria-label="Delete Milk"]') as HTMLButtonElement
    ).click();
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
    (d.querySelector(".bottom button") as HTMLButtonElement).click();
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
    assert.ok(js.length < 20000);
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
