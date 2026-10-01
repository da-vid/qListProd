import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { JSDOM } from "jsdom";
const tick = () => new Promise((r) => setTimeout(r, 20));
async function ui(url = "https://preview.example/AbC234") {
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
