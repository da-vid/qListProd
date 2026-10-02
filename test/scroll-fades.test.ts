import { test } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { hiddenListEdges, installScrollFades } from "../src/scroll-fades.ts";

test("edge fades distinguish top, middle, bottom, fitting and offscreen lists", () => {
  assert.deepEqual(hiddenListEdges(150, 950, 150, 700, true), {
    above: false,
    below: true,
  });
  assert.deepEqual(hiddenListEdges(-150, 850, 150, 700, true), {
    above: true,
    below: true,
  });
  assert.deepEqual(hiddenListEdges(-150, 700, 150, 700, true), {
    above: true,
    below: false,
  });
  for (const [start, end, populated] of [
    [150, 400, true],
    [150, 150, false],
    [-300, 100, true],
    [800, 900, true],
  ] as const)
    assert.deepEqual(hiddenListEdges(start, end, 150, 700, populated), {
      above: false,
      below: false,
    });
  assert.deepEqual(hiddenListEdges(149.8, 700.2, 150, 700, true), {
    above: false,
    below: false,
  });
});

test("fade positions and visibility refresh after scroll, mutations, sticky resize and visual viewport changes", async () => {
  const dom = new JSDOM('<div id="sticky"></div><ul><li>Fixture</li></ul>', {
    pretendToBeVisual: true,
  });
  const w = dom.window,
    d = w.document;
  const frames = new Map<number, FrameRequestCallback>();
  let frameID = 0,
    resized = () => {};
  const visual = new w.EventTarget();
  Object.assign(visual, { offsetTop: 0, height: 700 });
  Object.defineProperty(w, "visualViewport", { value: visual });
  Object.assign(globalThis, {
    window: w,
    document: d,
    MutationObserver: w.MutationObserver,
    ResizeObserver: class {
      constructor(fn: () => void) {
        resized = fn;
      }
      observe() {}
    },
    requestAnimationFrame: (fn: FrameRequestCallback) => {
      frames.set(++frameID, fn);
      return frameID;
    },
  });
  const flush = () => {
    const pending = [...frames.values()];
    frames.clear();
    pending.forEach((fn) => fn(0));
  };
  const sticky = d.querySelector<HTMLElement>("#sticky")!,
    list = d.querySelector("ul")!;
  let listTop = 150,
    listBottom = 1000,
    stickyBottom = 150;
  list.getBoundingClientRect = () =>
    ({ top: listTop, bottom: listBottom, left: 20, width: 500 }) as DOMRect;
  sticky.getBoundingClientRect = () => ({ bottom: stickyBottom }) as DOMRect;
  try {
    installScrollFades(sticky, list);
    const upper = d.querySelector<HTMLElement>(".edge-top")!,
      lower = d.querySelector<HTMLElement>(".edge-bottom")!;
    flush();
    assert.equal(upper.classList.contains("visible"), false);
    assert.equal(lower.classList.contains("visible"), true);
    assert.equal(lower.style.top, "700px");
    assert.equal(upper.style.left, "20px");
    assert.equal(upper.style.width, "500px");
    assert.equal(upper.getAttribute("aria-hidden"), "true");
    assert.equal(upper.inert, true);
    listTop = -100;
    listBottom = 750;
    d.dispatchEvent(new w.Event("scroll"));
    flush();
    assert.equal(upper.classList.contains("visible"), true);
    stickyBottom = 190;
    resized();
    flush();
    assert.equal(upper.style.top, "190px");
    Object.assign(visual, { offsetTop: 20, height: 480 });
    visual.dispatchEvent(new w.Event("resize"));
    flush();
    assert.equal(lower.style.top, "500px");
    listBottom = 490;
    resized();
    flush();
    assert.equal(lower.classList.contains("visible"), false);
    list.replaceChildren();
    await Promise.resolve();
    flush();
    assert.equal(upper.classList.contains("visible"), false);
    assert.equal(lower.classList.contains("visible"), false);
  } finally {
    dom.window.close();
  }
});
