import { test } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { installModalDismissal } from "../src/modal.ts";
test("modal outside gestures dismiss only when both ends are outside; Escape and × restore focus", () => {
  const dom = new JSDOM(
    '<button id="origin">Open</button><dialog><p>Inside</p></dialog>',
  );
  const d = dom.window.document,
    dialog = d.querySelector("dialog")!,
    origin = d.querySelector<HTMLButtonElement>("#origin")!;
  dialog.showModal = () => dialog.setAttribute("open", "");
  dialog.close = () => dialog.removeAttribute("open");
  dialog.getBoundingClientRect = () =>
    ({ left: 20, right: 200, top: 20, bottom: 200 }) as DOMRect;
  const modal = installModalDismissal(dialog);
  function event(name: string, x: number, target: Element = dialog) {
    const e = new dom.window.MouseEvent(name, {
      clientX: x,
      clientY: x,
      bubbles: true,
      button: 0,
    });
    Object.defineProperty(e, "pointerId", { value: 1 });
    target.dispatchEvent(e);
  }
  try {
    for (let i = 0; i < 3; i++) {
      origin.focus();
      modal.show();
      event("pointerdown", 40, dialog.querySelector("p")!);
      event("pointerup", 5);
      event("click", 5);
      assert.equal(dialog.open, true);
      event("pointerdown", 5);
      event("pointercancel", 5);
      event("click", 5);
      assert.equal(dialog.open, true);
      event("pointerdown", 5);
      event("pointerup", 5);
      event("click", 5);
      assert.equal(dialog.open, false);
      assert.equal(d.activeElement, origin);
      modal.show();
      dialog.dispatchEvent(
        new dom.window.Event("cancel", { cancelable: true }),
      );
      assert.equal(dialog.open, false);
      modal.show();
      modal.closeButton.click();
      assert.equal(dialog.open, false);
      assert.equal(d.activeElement, origin);
    }
  } finally {
    dom.window.close();
  }
});
