import { test } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { dragScrollSpeed, installListViewport } from "../src/list-viewport.ts";

test("drag scroll zones follow the visible list below the sticky controls", () => {
  assert.equal(dragScrollSpeed(350, 160, 700), 0);
  assert.equal(dragScrollSpeed(160, 160, 700), -600);
  assert.equal(dragScrollSpeed(184, 160, 700), -300);
  assert.equal(dragScrollSpeed(676, 160, 700), 300);
  assert.equal(dragScrollSpeed(700, 160, 700), 600);
  assert.equal(dragScrollSpeed(-1, 160, 700), 0);
  assert.equal(dragScrollSpeed(701, 160, 700), 0);
  // Very short viewports still have a neutral middle, without overlapping zones.
  assert.equal(dragScrollSpeed(180, 160, 200), 0);
});

test("sticky geometry keeps focused rows visible and cancels covered drop targets", () => {
  const dom = new JSDOM(
    '<div id="top"></div><ul><li class="item"><button>Handle</button></li></ul>',
    { pretendToBeVisual: true },
  );
  const w = dom.window,
    d = w.document;
  let tick: FrameRequestCallback = () => {},
    cancelled = false;
  const scrolls: number[] = [];
  Object.assign(globalThis, {
    window: w,
    document: d,
    HTMLElement: w.HTMLElement,
    requestAnimationFrame: (fn: FrameRequestCallback) => {
      tick = fn;
      return 1;
    },
    cancelAnimationFrame: () => {
      cancelled = true;
    },
  });
  w.scrollBy = ((options: ScrollToOptions) =>
    scrolls.push(options.top!)) as typeof w.scrollBy;
  const sticky = d.querySelector<HTMLElement>("#top")!,
    list = d.querySelector("ul")!,
    row = d.querySelector("li")!,
    handle = d.querySelector("button")!;
  sticky.getBoundingClientRect = () =>
    ({ top: 0, bottom: 160, height: 160 }) as DOMRect;
  row.getBoundingClientRect = () =>
    ({ top: 120, bottom: 164, height: 44 }) as DOMRect;
  try {
    const viewport = installListViewport(sticky, list);
    assert.equal(
      d.documentElement.style.getPropertyValue("--sticky-height"),
      "160px",
    );
    viewport.reveal(handle);
    assert.equal(scrolls.pop(), -48);
    viewport.start();
    d.dispatchEvent(new w.MouseEvent("mousemove", { clientY: 180 }));
    assert.equal(viewport.canDrop(), true);
    tick(16);
    assert.ok(scrolls.pop()! < 0);
    d.dispatchEvent(new w.MouseEvent("mousemove", { clientY: 140 }));
    assert.equal(viewport.canDrop(), false);
    d.dispatchEvent(new w.MouseEvent("mousemove", { clientY: 400 }));
    assert.equal(viewport.canDrop(), true);
    viewport.stop();
    assert.equal(cancelled, true);
  } finally {
    dom.window.close();
  }
});
