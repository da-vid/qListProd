// Keep drag auto-scroll relative to the visible list, below the sticky controls.
export function dragScrollSpeed(
  y: number,
  top: number,
  bottom: number,
): number {
  if (bottom <= top || y < 0 || y > bottom) return 0;
  const edge = Math.min(48, (bottom - top) / 3);
  if (y < top + edge) return -600 * Math.min(1, (top + edge - y) / edge);
  if (y > bottom - edge) return 600 * Math.min(1, (y - bottom + edge) / edge);
  return 0;
}
export function installListViewport(sticky: HTMLElement, list: HTMLElement) {
  let active = false,
    pointerY: number | null = null,
    frame = 0,
    previous = 0;
  const bottom = () =>
    window.visualViewport
      ? window.visualViewport.offsetTop + window.visualViewport.height
      : window.innerHeight;
  const top = () => Math.max(0, sticky.getBoundingClientRect().bottom);
  const measure = () => {
    document.documentElement.style.setProperty(
      "--sticky-height",
      `${sticky.getBoundingClientRect().height}px`,
    );
    if (!active && document.activeElement instanceof HTMLElement)
      reveal(document.activeElement);
  };
  if (typeof ResizeObserver !== "undefined")
    new ResizeObserver(measure).observe(sticky);
  window.addEventListener("resize", measure);
  window.visualViewport?.addEventListener("resize", measure);
  measure();
  function reveal(target: HTMLElement) {
    const row = target.closest<HTMLElement>(".item");
    if (!row || !list.contains(row)) return;
    const rect = row.getBoundingClientRect();
    if (!rect.height) return;
    const upper = top() + 8,
      lower = bottom() - 8;
    const delta =
      rect.top < upper
        ? rect.top - upper
        : rect.bottom > lower
          ? rect.bottom - lower
          : 0;
    if (delta) window.scrollBy({ top: delta, behavior: "instant" });
  }
  list.addEventListener("focusin", (event) => {
    if (event.target instanceof HTMLElement) {
      const target = event.target;
      requestAnimationFrame(() => {
        if (!active && document.activeElement === target) reveal(target);
      });
    }
  });
  const track = (event: MouseEvent | TouchEvent) => {
    if (!active) return;
    pointerY =
      "touches" in event
        ? (event.touches[0]?.clientY ?? pointerY)
        : event.clientY;
  };
  // Passive observation only: scrolling/editing outside the drag handle keeps native behavior.
  document.addEventListener("pointermove", track, { passive: true });
  document.addEventListener("mousemove", track, { passive: true });
  document.addEventListener("touchmove", track, { passive: true });
  function step(now: number) {
    if (!active) return;
    const elapsed = previous ? Math.min(now - previous, 32) : 16;
    previous = now;
    const speed =
      pointerY === null ? 0 : dragScrollSpeed(pointerY, top(), bottom());
    if (speed)
      window.scrollBy({ top: (speed * elapsed) / 1000, behavior: "instant" });
    frame = requestAnimationFrame(step);
  }
  return {
    reveal,
    start() {
      active = true;
      pointerY = null;
      previous = 0;
      frame = requestAnimationFrame(step);
    },
    stop() {
      active = false;
      cancelAnimationFrame(frame);
    },
    // Releasing over the toolbar cancels the move instead of dropping behind it.
    canDrop() {
      return pointerY === null || (pointerY >= top() && pointerY <= bottom());
    },
  };
}
